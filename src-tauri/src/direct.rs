//! Direct HTTP download (1.3.x) — the fallback path for when yt-dlp's
//! extractor can't enumerate formats but we already have a known direct
//! media URL.
//!
//! Trigger cases:
//!   - User pastes a raw CDN URL (e.g. `https://v1.pinimg.com/.../foo_720w.mp4`)
//!     that yt-dlp's generic extractor can't read formats from.
//!   - Extension sniffer caught a stream URL and the user wants to grab
//!     it directly.
//!   - Any future scenario where the URL is "obviously the media" but
//!     yt-dlp's extractor is broken for that site.
//!
//! Design:
//!   - reqwest streams the body to disk so memory stays flat.
//!   - Progress events use the same `download:progress` channel + shape
//!     as `yt_download`, so the existing single-URL + queue UI light
//!     up without any frontend churn.
//!   - Site-specific Referer headers (Pinterest CDN specifically) so
//!     anti-hotlink CDNs don't 403 us.
//!
//! Out of scope (intentionally):
//!   - Segment trims (the scrubber path) — no real point for a direct
//!     CDN file since we'd just be downloading then ffmpeg-trimming.
//!     If needed later, mirror the trim block in `yt_download` since
//!     ffmpeg already lives as a sidecar.
//!   - Cancellation. yt-dlp downloads can take minutes; a direct file
//!     is usually under a minute. Keeping the simpler API. If we ever
//!     need cancel, wire it through JobRegistry the same way yt_download
//!     does.

use std::path::PathBuf;
use std::time::Instant;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::library;
use crate::settings;
use crate::{DownloadResult, ProgressEvent};

/// Map a URL into a sanitized filename. Takes the last path segment
/// (the one with the extension), strips query strings, and prepends a
/// short timestamp suffix so multiple downloads of the same URL don't
/// collide.
fn filename_for_url(url: &str) -> String {
    let no_query = url.split(['?', '#']).next().unwrap_or(url);
    let last = no_query
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("download");
    // Sanitize: collapse anything Windows hates to underscores.
    let clean: String = last
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Stamp with a unix-ts-ish suffix to keep names unique across redo's.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Some(dot) = clean.rfind('.') {
        let (base, ext) = clean.split_at(dot);
        format!("{base}__{stamp}{ext}")
    } else {
        format!("{clean}__{stamp}")
    }
}

/// Some CDNs 403 naked requests because the platform expects a Referer
/// for hot-link protection. Map host → Referer header so we don't have
/// to lean on the user to know this.
fn referer_for_host(host: &str) -> Option<&'static str> {
    let h = host.to_ascii_lowercase();
    if h.ends_with("pinimg.com") {
        // Pinterest CDN. The exact origin doesn't matter — Pinterest
        // CDN just wants something on pinterest.com.
        return Some("https://www.pinterest.com/");
    }
    if h.ends_with("redditmedia.com") || h.ends_with("redd.it") {
        return Some("https://www.reddit.com/");
    }
    if h.ends_with("twimg.com") {
        return Some("https://x.com/");
    }
    if h.ends_with("cdninstagram.com") || h.ends_with("fbcdn.net") {
        return Some("https://www.instagram.com/");
    }
    None
}

#[tauri::command]
pub async fn media_direct_download(
    app: AppHandle,
    state: tauri::State<'_, library::LibraryState>,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
    job_id: Option<String>,
    project_id: Option<String>,
) -> Result<DownloadResult, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    // Validate the URL shape early so we get a useful error instead of
    // reqwest's generic "builder error".
    let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!(
            "only http/https URLs supported (got {})",
            parsed.scheme()
        ));
    }
    let host = parsed.host_str().unwrap_or("").to_string();

    // Same destination resolution as yt_download — respect active
    // project / custom root / library-root override.
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let content_root = settings::content_root(&settings, &home);
    let dest_dir = library::resolve_download_dir(&state, &content_root, project_id.as_deref())
        .await
        .map_err(|e| format!("resolve dest dir: {e}"))?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("create dest dir: {e}"))?;

    let filename = filename_for_url(trimmed);
    let target: PathBuf = dest_dir.join(&filename);

    // Build the request with platform-aware Referer.
    let client = reqwest::Client::builder()
        .user_agent("MediaHub/1.3 (direct-download)")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let mut req = client.get(parsed.clone());
    if let Some(ref_) = referer_for_host(&host) {
        req = req.header(reqwest::header::REFERER, ref_);
    }
    let res = req.send().await.map_err(|e| format!("request: {e}"))?;
    if !res.status().is_success() {
        return Err(format!(
            "HTTP {} from {host} — server refused (likely needs auth or hot-link protection)",
            res.status()
        ));
    }
    let total = res.content_length();

    // Stream to disk. Emit a progress event ~every 250ms — same cadence
    // as yt_download's stdout-parsed events so the UI bar moves
    // smoothly without spamming Tauri's event bus.
    let mut file = tokio::fs::File::create(&target)
        .await
        .map_err(|e| format!("create dest file: {e}"))?;
    let mut downloaded: u64 = 0;
    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut stream = res.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream chunk: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write chunk: {e}"))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 250 {
            last_emit = Instant::now();
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed = (downloaded as f64 / elapsed) as u64;
            let percent = total.map(|t| (downloaded as f64 / t as f64) * 100.0);
            let eta = total.and_then(|t| {
                if speed > 0 {
                    Some((t.saturating_sub(downloaded)) / speed)
                } else {
                    None
                }
            });
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
                    job_id: job_id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    percent,
                    speed_bps: Some(speed),
                    eta_sec: eta,
                },
            );
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("flush dest file: {e}"))?;

    // Final "100%" event so the UI doesn't sit at 98% if the last chunk
    // arrived right after our 250ms tick.
    let _ = app.emit(
        "download:progress",
        ProgressEvent {
            job_id: job_id.clone(),
            downloaded_bytes: downloaded,
            total_bytes: Some(downloaded),
            percent: Some(100.0),
            speed_bps: None,
            eta_sec: Some(0),
        },
    );

    Ok(DownloadResult {
        path: target.to_string_lossy().to_string(),
        bytes: Some(downloaded),
    })
}
