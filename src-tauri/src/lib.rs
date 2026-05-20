// Media Hub — Rust backend entry.
//
// Milestone 0.1: `binaries_version` smoke test (proves sidecar pipeline).
// Milestone 0.2 in progress: `yt_fetch_metadata` (paste URL → metadata card).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

// =====================================================================
// 0.1 — Sidecar smoke test
// =====================================================================

#[derive(Serialize)]
pub struct SidecarVersion {
    pub name: String,
    pub version: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Run a sidecar with the given args and return the first non-empty stdout line.
async fn run_version(app: &AppHandle, sidecar: &str, args: &[&str]) -> SidecarVersion {
    let shell = app.shell();
    let cmd = match shell.sidecar(sidecar) {
        Ok(c) => c,
        Err(e) => {
            return SidecarVersion {
                name: sidecar.to_string(),
                version: String::new(),
                ok: false,
                error: Some(format!("sidecar resolve failed: {e}")),
            };
        }
    };

    match cmd.args(args).output().await {
        Ok(out) => {
            let text = if !out.stdout.is_empty() {
                String::from_utf8_lossy(&out.stdout).to_string()
            } else {
                String::from_utf8_lossy(&out.stderr).to_string()
            };
            let first_line = text
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("(no output)")
                .trim()
                .to_string();
            SidecarVersion {
                name: sidecar.to_string(),
                version: first_line,
                ok: out.status.success(),
                error: if out.status.success() {
                    None
                } else {
                    Some(format!("exit {:?}", out.status.code()))
                },
            }
        }
        Err(e) => SidecarVersion {
            name: sidecar.to_string(),
            version: String::new(),
            ok: false,
            error: Some(format!("spawn failed: {e}")),
        },
    }
}

#[tauri::command]
async fn binaries_version(app: AppHandle) -> Result<Vec<SidecarVersion>, String> {
    let ytdlp = run_version(&app, "yt-dlp", &["--version"]).await;
    let ffmpeg = run_version(&app, "ffmpeg", &["-version"]).await;
    Ok(vec![ytdlp, ffmpeg])
}

// =====================================================================
// 0.2 — Single-URL metadata fetch
// =====================================================================
//
// yt-dlp -j is "dump-json without download" — returns a fat JSON object
// per video. We only project the fields the UI actually renders. Anything
// the UI doesn't show stays out of the wire to keep IPC payloads small.

/// What we actually need on the UI side. yt-dlp returns ~200 fields; we
/// project to ~10 the user cares about, plus a filtered format list.
#[derive(Serialize)]
pub struct VideoMetadata {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    pub upload_date: Option<String>, // yt-dlp gives YYYYMMDD
    pub webpage_url: String,
    pub view_count: Option<u64>,
    pub formats: Vec<FormatOption>,
}

#[derive(Serialize)]
pub struct FormatOption {
    pub id: String,
    pub ext: String,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub filesize_bytes: Option<u64>,
    pub note: Option<String>, // yt-dlp format_note ("1080p", "tiny", etc.)
    pub has_video: bool,
    pub has_audio: bool,
}

/// Raw yt-dlp -j shape, deserialized partially. We only declare fields we
/// read; serde_json ignores the rest.
#[derive(Deserialize)]
struct RawYtDlp {
    id: String,
    title: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    upload_date: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    #[serde(default)]
    view_count: Option<u64>,
    #[serde(default)]
    formats: Vec<RawFormat>,
}

#[derive(Deserialize)]
struct RawFormat {
    format_id: String,
    #[serde(default)]
    ext: Option<String>,
    #[serde(default)]
    vcodec: Option<String>,
    #[serde(default)]
    acodec: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    filesize: Option<u64>,
    #[serde(default)]
    filesize_approx: Option<u64>,
    #[serde(default)]
    format_note: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
}

fn project_format(f: RawFormat) -> Option<FormatOption> {
    // Skip storyboard / mhtml previews — not real media.
    if matches!(f.protocol.as_deref(), Some("mhtml")) {
        return None;
    }
    let has_video = f.vcodec.as_deref().map_or(false, |v| v != "none");
    let has_audio = f.acodec.as_deref().map_or(false, |a| a != "none");
    // Drop pure-storyboard formats (no audio + no video usually means "thumbnails").
    if !has_video && !has_audio {
        return None;
    }
    Some(FormatOption {
        id: f.format_id,
        ext: f.ext.unwrap_or_default(),
        vcodec: f.vcodec,
        acodec: f.acodec,
        width: f.width,
        height: f.height,
        fps: f.fps,
        filesize_bytes: f.filesize.or(f.filesize_approx),
        note: f.format_note,
        has_video,
        has_audio,
    })
}

#[tauri::command]
async fn yt_fetch_metadata(app: AppHandle, url: String) -> Result<VideoMetadata, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    let shell = app.shell();
    let cmd = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?;

    let out = cmd
        .args([
            "-j",                  // dump single JSON object, no download
            "--no-playlist",       // never expand playlists at this stage
            "--no-warnings",       // keep stderr clean
            "--no-call-home",      // be polite, skip telemetry
            "--socket-timeout", "15",
            "--",                  // end of options, URL is positional
            trimmed,
        ])
        .output()
        .await
        .map_err(|e| format!("spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr
            .lines()
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("(no stderr)")
            .to_string();
        return Err(format!("yt-dlp failed: {tail}"));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let raw: RawYtDlp = serde_json::from_str(&stdout)
        .map_err(|e| format!("JSON parse failed: {e}"))?;

    let formats: Vec<FormatOption> = raw.formats.into_iter().filter_map(project_format).collect();

    Ok(VideoMetadata {
        id: raw.id,
        title: raw.title,
        channel: raw.channel.or(raw.uploader).unwrap_or_else(|| "(unknown)".into()),
        duration_sec: raw.duration,
        thumbnail: raw.thumbnail,
        upload_date: raw.upload_date,
        webpage_url: raw.webpage_url.unwrap_or(trimmed.to_string()),
        view_count: raw.view_count,
        formats,
    })
}

// =====================================================================
// Tauri bootstrap
// =====================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            binaries_version,
            yt_fetch_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
