//! Preview proxy + frame-exact windows (exp/preview-proxy) — extracted from
//! lib.rs (1.12.1 monolith split). Downloads a small local proxy of a source
//! for buttery scrubbing, cuts all-intra windows around pause points for
//! frame-exact stepping, and manages the on-disk preview cache (2 GB LRU).

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{settings, tools};
use crate::{js_runtime_args, resolve_cookie_args, yt_dlp_capture};

/// EXPERIMENT (exp/preview-proxy) — local proxy for buttery scrubbing.
///
/// Downloads a small (~360p, muxed) copy of the source into the app
/// cache and returns its local path. The Scrubber plays the remote
/// stream immediately (Tier 0), then swaps to this local file when it
/// lands — local seeks have no network round-trip, so jogging/cutting
/// feels far smoother. Cached per video id, so re-opening is instant.
///
/// This whole feature lives behind the experiment branch; if scrapped,
/// delete this fn + its handler registration + the Scrubber proxy code.
#[derive(Serialize, Clone)]
pub struct PreviewProxy {
    path: String,
    cached: bool,
}

/// Cap for the preview-proxy cache. Oldest files are evicted after each
/// new proxy is written so the cache can't grow without bound. 2 GB ≈ a
/// dozen 720p proxies of typical B-roll length.
const PREVIEW_CACHE_CAP_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Evict oldest files in `dir` until the total is under `cap_bytes`.
/// Best-effort: IO errors are ignored (a stuck file just isn't reclaimed
/// this pass). Never touches anything outside `dir`.
fn prune_preview_cache(dir: &std::path::Path, cap_bytes: u64) {
    let mut files: Vec<(std::path::PathBuf, u64, std::time::SystemTime)> =
        match std::fs::read_dir(dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let m = e.metadata().ok()?;
                    if !m.is_file() {
                        return None;
                    }
                    Some((e.path(), m.len(), m.modified().ok()?))
                })
                .collect(),
            Err(_) => return,
        };
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= cap_bytes {
        return;
    }
    files.sort_by_key(|f| f.2); // oldest first
    for (path, len, _) in files {
        if total <= cap_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

#[tauri::command]
pub async fn preview_proxy(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
    video_id: String,
    max_height: u32,
    // 1.13.4 — which item of a multi-item post to proxy (yt-dlp's
    // 1-based playlist index). A carousel exposes every slide under one
    // URL, so without this the proxy always downloaded slide 1 — and
    // cached it under the SELECTED slide's video_id, i.e. the right key
    // holding the wrong video. The scrubber then previewed item 1 no
    // matter which item you picked.
    media_items: Option<String>,
) -> Result<PreviewProxy, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }
    // Clamp the requested proxy height (frontend decides it from the
    // preview-quality setting + video length).
    let h = max_height.clamp(144, 1080);
    // Sanitize the id into a safe filename (no path traversal). Cache key
    // includes the height so switching quality re-fetches cleanly.
    let id: String = video_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    let id = if id.is_empty() { "preview".to_string() } else { id };

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("preview");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create preview dir: {e}"))?;
    let out = dir.join(format!("{id}-{h}.mp4"));
    if out.is_file() {
        return Ok(PreviewProxy {
            path: out.to_string_lossy().to_string(),
            cached: true,
        });
    }

    let tmpl = dir.join(format!("{id}-{h}.dl.%(ext)s"));
    let tmpl_str = tmpl.to_string_lossy().to_string();
    let cookies = resolve_cookie_args(&app, &settings, trimmed);
    // ≤360p uses muxed format 18 (no ffmpeg merge); higher needs a
    // video+audio merge (YouTube has no muxed format above 360p) → point
    // yt-dlp at the bundled ffmpeg.
    let ffmpeg_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|dir| {
            if cfg!(windows) {
                dir.join("ffmpeg.exe")
            } else {
                dir.join("ffmpeg")
            }
        })
        .filter(|p| p.exists());
    // Always use DASH (separate video+audio, merged) rather than the
    // progressive muxed format 18: progressive is a single HTTP stream
    // that YouTube throttles to ~playback rate, so an 800 MB file can
    // take ~10 min. DASH + --concurrent-fragments uses many connections
    // and bypasses the per-connection throttle (same trick the main
    // downloader uses). Prefer H.264 (fastest hardware decode for smooth
    // scrub) + m4a audio; fall back to any merge at the height, then 18.
    let format_spec = format!(
        "bestvideo[height<={h}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[ext=mp4][height<={h}]/18"
    );
    let mut opts: Vec<String> = vec![
        "-f".into(),
        format_spec,
        // Parallel fragments — the speed fix for throttled progressive
        // downloads (see comment above).
        "--concurrent-fragments".into(),
        "16".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "-o".into(),
        tmpl_str,
    ];
    if let Some(spec) = media_items.as_deref().and_then(crate::sanitize_playlist_items) {
        opts.push("--playlist-items".into());
        opts.push(spec);
    }
    if let Some(ff) = ffmpeg_path.as_ref() {
        opts.push("--ffmpeg-location".into());
        opts.push(ff.to_string_lossy().to_string());
    }
    opts.extend(settings::youtube_extractor_args());
    opts.extend(js_runtime_args(&app));

    let output = yt_dlp_capture(&app, &opts, &cookies, trimmed).await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.lines().last().unwrap_or("(no stderr)").trim();
        return Err(settings::translate_ytdlp_error(tail));
    }

    // Locate the produced file and promote it to `{id}.mp4`. After a
    // merge the result is `{id}.dl.mp4`; prefer that, else scan for any
    // leftover `{id}.dl.<ext>` (e.g. a non-merge fallback path).
    let exact = dir.join(format!("{id}-{h}.dl.mp4"));
    let produced = if exact.is_file() {
        exact
    } else {
        let prefix = format!("{id}-{h}.dl.");
        std::fs::read_dir(&dir)
            .ok()
            .and_then(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .find(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with(&prefix))
                            .unwrap_or(false)
                    })
            })
            .ok_or("preview output not found")?
    };
    std::fs::rename(&produced, &out).map_err(|e| format!("finalize preview: {e}"))?;
    // Keep the cache bounded — evict oldest proxies past the cap.
    prune_preview_cache(&dir, PREVIEW_CACHE_CAP_BYTES);
    Ok(PreviewProxy {
        path: out.to_string_lossy().to_string(),
        cached: false,
    })
}

/// EXPERIMENT (exp/preview-proxy, Tier 3) — frame-exact trim window.
///
/// Re-encodes a SHORT window of the already-downloaded proxy as
/// all-intra (`-g 1`, every frame a keyframe) so the scrubber can show
/// the exact frame at any time within it — without re-encoding the whole
/// (possibly multi-hour) proxy. Generated on demand when the user pauses
/// on a point; the coarse proxy stays the source for everything else.
#[derive(Serialize, Clone)]
pub struct IntraWindow {
    path: String,
    start_sec: f64,
    dur_sec: f64,
}

#[tauri::command]
pub async fn preview_intra_window(
    app: AppHandle,
    video_id: String,
    max_height: u32,
    center_sec: f64,
    radius_sec: f64,
) -> Result<IntraWindow, String> {
    let h = max_height.clamp(144, 1080);
    let id: String = video_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    let id = if id.is_empty() { "preview".to_string() } else { id };
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("preview");
    let proxy = dir.join(format!("{id}-{h}.mp4"));
    if !proxy.is_file() {
        return Err("proxy not ready".into());
    }
    let r = radius_sec.clamp(1.0, 15.0);
    let start = (center_sec - r).max(0.0).floor();
    let dur = r * 2.0;
    // Cache the window by start-second so nearby pauses reuse it.
    let out = dir.join(format!("{id}-{h}-w{}.mp4", start as u64));
    if out.is_file() {
        return Ok(IntraWindow {
            path: out.to_string_lossy().to_string(),
            start_sec: start,
            dur_sec: dur,
        });
    }
    let start_s = format!("{start}");
    let dur_s = format!("{dur}");
    let out_s = out.to_string_lossy().to_string();
    let proxy_s = proxy.to_string_lossy().to_string();
    let ff = tools::ffmpeg_command(&app)?;
    // -ss before -i = fast seek; all-intra + ultrafast for a quick cut.
    let output = ff
        .args([
            "-ss", start_s.as_str(),
            "-i", proxy_s.as_str(),
            "-t", dur_s.as_str(),
            "-an",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-g", "1",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-y", out_s.as_str(),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg window: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg window failed: {}",
            err.lines().last().unwrap_or("(no stderr)")
        ));
    }
    prune_preview_cache(&dir, PREVIEW_CACHE_CAP_BYTES);
    Ok(IntraWindow {
        path: out_s,
        start_sec: start,
        dur_sec: dur,
    })
}

/// Total bytes + on-disk path of the preview cache, for the Settings
/// readout ("Cache: 420 MB" + a reveal-in-folder button).
#[derive(Serialize, Clone)]
pub struct PreviewCacheInfo {
    bytes: u64,
    path: String,
}

#[tauri::command]
pub fn preview_cache_info(app: AppHandle) -> Result<PreviewCacheInfo, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("preview");
    let mut bytes = 0u64;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.filter_map(|e| e.ok()) {
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(PreviewCacheInfo {
        bytes,
        path: dir.to_string_lossy().to_string(),
    })
}

/// Delete every cached preview proxy. Returns the number of bytes freed
/// so the UI can show "freed N MB". Best-effort per file.
#[tauri::command]
pub fn preview_cache_clear(app: AppHandle) -> Result<u64, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("preview");
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut freed: u64 = 0;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.filter_map(|e| e.ok()) {
            let p = entry.path();
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&p).is_ok() {
                freed += len;
            }
        }
    }
    Ok(freed)
}
