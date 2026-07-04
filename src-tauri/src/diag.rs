//! Diagnostics / logging (1.11.3).
//!
//! A lightweight, always-on file logger so failures that only reproduce on
//! *other people's machines* are self-reporting. The trigger for this was a
//! transcode bug ("at least one of its streams received no packets") that
//! hit some testers and never the dev machine — because the app only
//! surfaced the LAST line of ffmpeg's stderr and threw away everything
//! else, including which stream was empty and what the input actually was.
//!
//! What we capture:
//!   - Every sidecar command line we run (ffmpeg/yt-dlp) + exit code.
//!   - On failure: the FULL stderr, plus an `ffmpeg -i <input>` probe so we
//!     can see the input's real streams/codecs.
//!   - Sidecar + OS versions (so we know exactly which ffmpeg nightly a
//!     tester has — the whole class of "works here, not there" bugs).
//!
//! Log lives at `app_log_dir/media-hub.log`, rotates once past a cap, and
//! is one click away in Settings → Diagnostics.

use std::io::Write;
use tauri::{AppHandle, Manager};

const CAP_BYTES: u64 = 4 * 1024 * 1024; // rotate to .1 past 4 MB

/// Directory that holds the log file (created on demand).
pub fn log_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

/// Absolute path to `media-hub.log`.
pub fn log_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(log_dir(app)?.join("media-hub.log"))
}

/// Append one timestamped, tagged line. Best-effort — never fails the
/// caller — and mirrors to stderr so `tauri dev` shows it live.
pub fn log(app: &AppHandle, tag: &str, msg: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    eprintln!("[{tag}] {msg}");
    let Some(path) = log_file(app) else { return };
    // Rotate once when the file gets large so it can't grow unbounded.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > CAP_BYTES {
            let _ = std::fs::rename(&path, path.with_file_name("media-hub.log.1"));
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[{ts}] [{tag}] {msg}");
    }
}

/// Run `ffmpeg -hide_banner -i <path>` and return its stderr — ffmpeg
/// prints the container/stream/codec summary there (and exits non-zero
/// because no output was requested, which is expected). Used to log what
/// an input file *actually* is when a transcode of it fails.
pub async fn probe_media(app: &AppHandle, path: &str) -> String {
    let Ok(cmd) = crate::tools::ffmpeg_command(app) else {
        return "(probe: ffmpeg not installed)".into();
    };
    match cmd.args(["-hide_banner", "-i", path]).output().await {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stderr);
            // Keep the Input/Stream lines; drop the trailing "At least one
            // output file must be specified" noise.
            s.lines()
                .filter(|l| {
                    let l = l.trim();
                    !l.is_empty() && !l.contains("At least one output file")
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        Err(e) => format!("(probe failed: {e})"),
    }
}

/// Sidecar + environment snapshot, for the Settings panel and the log
/// header. `binaries_version` already resolves ffmpeg/yt-dlp/deno versions;
/// we just add the OS + app version here.
#[derive(serde::Serialize, Clone)]
pub struct DiagInfo {
    pub app_version: String,
    pub os: String,
    pub log_path: String,
}

pub fn info(app: &AppHandle) -> DiagInfo {
    DiagInfo {
        app_version: app.package_info().version.to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        log_path: log_file(app)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}
