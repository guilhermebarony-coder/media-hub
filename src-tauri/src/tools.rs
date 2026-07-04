//! Lazy media tools (1.12.0) — ffmpeg + deno are downloaded on first run
//! instead of bundled, so the installer/auto-update artifact drops from
//! ~322 MB of sidecars to a small one (only the tiny yt-dlp stays bundled).
//!
//! Both live in `<app_data>/bin/` alongside the managed yt-dlp + aria2c, and
//! are executed via `shell.command(<path>)` — the same mechanism the managed
//! yt-dlp already uses, so no new shell-scope permission is needed.
//!
//! ffmpeg is REQUIRED (transcode, trims, thumbnails, DASH merge). deno is
//! OPTIONAL — it only speeds up YouTube's JS-challenge solving; if it's
//! missing yt-dlp falls back to its built-in solver (see js_runtime_args).
//! The one-time setup screen ensures both before the app is usable.

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::Command;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;

/// A downloadable tool: where to get it per-OS, what file to pull out of
/// the archive, and what to call it once installed.
struct ToolSpec {
    /// Stable id used in events + the on-disk filename stem.
    id: &'static str,
    /// URL of the archive to download for this platform.
    url: &'static str,
    /// The binary's name INSIDE the archive (found recursively).
    member: &'static str,
    /// The installed filename in `<app_data>/bin`.
    out_name: &'static str,
}

#[cfg(windows)]
fn ffmpeg_spec() -> ToolSpec {
    ToolSpec {
        id: "ffmpeg",
        // Stable release branch (n7.1) — NOT master-latest. See
        // scripts/fetch-sidecars.ps1 for why master churn is a hazard.
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip",
        member: "ffmpeg.exe",
        out_name: "ffmpeg.exe",
    }
}
#[cfg(not(windows))]
fn ffmpeg_spec() -> ToolSpec {
    ToolSpec {
        id: "ffmpeg",
        url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
        member: "ffmpeg",
        out_name: "ffmpeg",
    }
}

#[cfg(windows)]
fn deno_spec() -> ToolSpec {
    ToolSpec {
        id: "deno",
        url: "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip",
        member: "deno.exe",
        out_name: "deno.exe",
    }
}
#[cfg(not(windows))]
fn deno_spec() -> ToolSpec {
    ToolSpec {
        id: "deno",
        url: "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip",
        member: "deno",
        out_name: "deno",
    }
}

/// Installed path of a tool (may not exist yet).
fn tool_path(app: &AppHandle, out_name: &str) -> Option<std::path::PathBuf> {
    crate::aria2::managed_bin_dir(app).ok().map(|d| d.join(out_name))
}

pub fn ffmpeg_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    tool_path(app, ffmpeg_spec().out_name).filter(|p| p.is_file())
}

pub fn deno_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    tool_path(app, deno_spec().out_name).filter(|p| p.is_file())
}

/// Build an ffmpeg `Command` for the managed binary. Errors clearly if it
/// isn't installed yet (shouldn't happen post-setup, but the message points
/// the user at the fix instead of a cryptic sidecar error).
pub fn ffmpeg_command(app: &AppHandle) -> Result<Command, String> {
    let path = ffmpeg_path(app)
        .ok_or("ffmpeg isn't installed yet — open Settings → Diagnostics and re-run tool setup")?;
    Ok(app.shell().command(path.to_string_lossy().to_string()))
}

#[derive(Serialize, Clone)]
struct ToolProgress {
    tool: &'static str,
    phase: &'static str, // "download" | "extract" | "done"
    received: u64,
    total: Option<u64>,
    percent: Option<f64>,
}

fn emit(app: &AppHandle, p: ToolProgress) {
    let _ = app.emit("tools:progress", p);
}

/// Download + install one tool into `<app_data>/bin` if it isn't already
/// there. Streams to disk (flat memory) and emits `tools:progress` events.
/// Idempotent.
async fn ensure(app: &AppHandle, spec: &ToolSpec) -> Result<std::path::PathBuf, String> {
    if let Some(p) = tool_path(app, spec.out_name).filter(|p| p.is_file()) {
        emit(app, ToolProgress { tool: spec.id, phase: "done", received: 0, total: None, percent: Some(100.0) });
        return Ok(p);
    }
    let dir = crate::aria2::managed_bin_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create bin dir: {e}"))?;
    let zip_path = dir.join(format!("{}.download.zip", spec.id));

    // 1) Stream download with progress.
    let client = reqwest::Client::builder()
        .user_agent("media-hub")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let res = client
        .get(spec.url)
        .send()
        .await
        .map_err(|e| format!("download {}: {e}", spec.id))?
        .error_for_status()
        .map_err(|e| format!("download {} status: {e}", spec.id))?;
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&zip_path)
        .await
        .map_err(|e| format!("create archive file: {e}"))?;
    let mut received: u64 = 0;
    let mut last = std::time::Instant::now();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream {}: {e}", spec.id))?;
        file.write_all(&chunk).await.map_err(|e| format!("write archive: {e}"))?;
        received += chunk.len() as u64;
        if last.elapsed().as_millis() >= 200 {
            last = std::time::Instant::now();
            emit(app, ToolProgress {
                tool: spec.id,
                phase: "download",
                received,
                total,
                percent: total.map(|t| received as f64 / t as f64 * 100.0),
            });
        }
    }
    file.flush().await.map_err(|e| format!("flush archive: {e}"))?;
    drop(file);

    // 2) Extract, find the binary, move it into place.
    emit(app, ToolProgress { tool: spec.id, phase: "extract", received, total, percent: Some(100.0) });
    let extract_dir = dir.join(format!("{}.extract", spec.id));
    let _ = std::fs::remove_dir_all(&extract_dir);
    let extracted = crate::aria2::extract_zip(&zip_path, &extract_dir).and_then(|()| {
        crate::aria2::find_file(&extract_dir, spec.member)
            .ok_or_else(|| format!("{} not found in archive", spec.member))
    });
    let _ = std::fs::remove_file(&zip_path);
    let src = match extracted {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&extract_dir);
            return Err(e);
        }
    };
    let final_path = dir.join(spec.out_name);
    let copy = std::fs::copy(&src, &final_path).map_err(|e| format!("install {}: {e}", spec.id));
    let _ = std::fs::remove_dir_all(&extract_dir);
    copy?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&final_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&final_path, perms);
        }
    }

    emit(app, ToolProgress { tool: spec.id, phase: "done", received, total, percent: Some(100.0) });
    crate::diag::log(app, "tools", &format!("installed {} -> {}", spec.id, final_path.display()));
    Ok(final_path)
}

// =====================================================================
// Commands
// =====================================================================

#[derive(Serialize)]
pub struct ToolsStatus {
    /// ffmpeg is required; deno is optional (yt-dlp degrades without it).
    ffmpeg: bool,
    deno: bool,
    /// True when everything REQUIRED for the app to function is present.
    ready: bool,
}

/// Which tools are installed. The first-run setup screen polls this to
/// decide whether to show itself.
#[tauri::command]
pub fn tools_status(app: AppHandle) -> ToolsStatus {
    let ffmpeg = ffmpeg_path(&app).is_some();
    let deno = deno_path(&app).is_some();
    ToolsStatus { ffmpeg, deno, ready: ffmpeg }
}

/// Download + install any missing tools. Called by the setup screen.
/// ffmpeg is required (its failure is returned as Err so the screen can
/// show a Retry); deno is best-effort (a failure is logged, not fatal).
#[tauri::command]
pub async fn tools_ensure(app: AppHandle) -> Result<(), String> {
    ensure(&app, &ffmpeg_spec()).await?; // required
    if let Err(e) = ensure(&app, &deno_spec()).await {
        // Non-fatal: yt-dlp falls back to its built-in JS solver.
        crate::diag::log(&app, "tools", &format!("deno install failed (non-fatal): {e}"));
    }
    Ok(())
}
