// Media Hub — aria2c external-downloader integration (1.10.0).
//
// aria2c opens many parallel connections per file (-x/-s), which is the
// single biggest real-world speedup yt-dlp can use for large or HLS/DASH
// pulls. It's an opt-in power-user toggle (Settings → Downloads), OFF by
// default.
//
// Why lazy-download instead of bundling as a Tauri sidecar:
//   - There's no official static macOS arm64 aria2c build, so it can't
//     go in `externalBin` (the mac CI build would fail on the missing
//     file). Lazy-download sidesteps that entirely.
//   - It keeps the installer + every auto-update artifact ~3 MB lighter
//     for the majority of users who never enable it (the bundle-bloat
//     problem the improvement audit flagged as #1 on weight).
//
// The binary lives next to the auto-updated yt-dlp in `<app_data>/bin/`.
// When it isn't present (not yet downloaded, download failed, or an
// unsupported OS), `downloader_args` returns empty and yt_download
// silently falls back to yt-dlp's native downloader — the feature can
// never break a download, only fail to accelerate it.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Pinned aria2 release. Bump both when updating. aria2 tags its GitHub
// releases `release-<version>`; the win-64 asset is the only prebuilt
// binary we consume (Linux uses a different community static build, mac
// has none — see `archive_url`).
const ARIA2_VERSION: &str = "1.37.0";

/// File name of the aria2c binary on this platform.
fn binary_name() -> &'static str {
    if cfg!(windows) {
        "aria2c.exe"
    } else {
        "aria2c"
    }
}

/// `<app_data>/bin` — shared with the managed yt-dlp (updater.rs). The
/// dir is created on demand by `ensure`.
fn managed_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data dir: {e}"))?
        .join("bin"))
}

/// Absolute path the aria2c binary lives at (may not exist yet).
fn aria2_path(app: &AppHandle) -> Option<PathBuf> {
    managed_bin_dir(app).ok().map(|d| d.join(binary_name()))
}

/// True when the aria2c binary is present and ready to use.
pub fn is_installed(app: &AppHandle) -> bool {
    aria2_path(app).map(|p| p.is_file()).unwrap_or(false)
}

/// yt-dlp argv extras that route downloads through aria2c, or empty when
/// the binary isn't available (caller falls back to native). The setting
/// gate (`use_aria2c`) is checked by the caller before this is consulted.
///
/// aria2 tuning: 16 connections/16 splits, 1 MiB min split. `--file-
/// allocation=none` skips up-front allocation so the file starts growing
/// immediately (our progress poll keys off the growing file). The quiet
/// flags keep aria2's chatter out of yt-dlp's captured stderr.
pub fn downloader_args(app: &AppHandle) -> Vec<String> {
    let Some(path) = aria2_path(app).filter(|p| p.is_file()) else {
        return Vec::new();
    };
    vec![
        "--downloader".to_string(),
        path.to_string_lossy().to_string(),
        // The console readout (`[#hash 12345B/67890B(27%) ... DL:999B]`)
        // is what yt_download parses for the progress bar — yt-dlp emits
        // no progress of its own for an external downloader. These flags
        // mirror yt-dlp's own aria2c-progress PR (#16753):
        //   --human-readable=false        → exact raw bytes, not "187MiB"
        //   --show-console-readout=true   → keep the readout on
        //   --truncate-console-readout=false → don't clip the line
        //   --summary-interval=0          → no multi-line summary block
        //   --console-log-level=notice    → don't suppress the readout
        //   --file-allocation=none        → file grows immediately
        "--downloader-args".to_string(),
        "aria2c:-x16 -s16 -k1M --file-allocation=none --summary-interval=0 \
         --human-readable=false --truncate-console-readout=false \
         --show-console-readout=true --console-log-level=notice"
            .to_string(),
    ]
}

/// The platform-specific archive URL + the path of aria2c inside it.
/// Returns Err on platforms with no prebuilt binary we trust.
#[cfg(windows)]
fn archive_url() -> Result<String, String> {
    Ok(format!(
        "https://github.com/aria2/aria2/releases/download/release-{v}/aria2-{v}-win-64bit-build1.zip",
        v = ARIA2_VERSION
    ))
}

#[cfg(not(windows))]
fn archive_url() -> Result<String, String> {
    // No official static macOS build exists, and the app only ships for
    // Windows + macOS. Be honest rather than ship a broken binary.
    Err("aria2c isn't available on this platform yet — \
         Media Hub will keep using its built-in downloader."
        .to_string())
}

/// Recursively search `dir` for a file named exactly `name`.
fn find_file(dir: &std::path::Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
    }
    None
}

/// Extract `zip` into `dest_dir` without pulling in a Rust zip crate for
/// a single opt-in path.
///
/// On Windows we must NOT call a bare `tar`: bsdtar (which handles .zip)
/// lives at System32\tar.exe, but if the user has Git for Windows on PATH
/// ahead of System32, `tar` resolves to GNU tar — which can't read a zip
/// and fails. So we call System32\tar.exe by absolute path, and fall back
/// to PowerShell's Expand-Archive if that's somehow missing (pre-1803).
fn extract_zip(zip: &std::path::Path, dest_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("create extract dir: {e}"))?;

    #[cfg(windows)]
    {
        let tar = std::env::var("SystemRoot")
            .map(|r| format!("{r}\\System32\\tar.exe"))
            .unwrap_or_else(|_| "C:\\Windows\\System32\\tar.exe".to_string());
        if std::path::Path::new(&tar).is_file() {
            let status = std::process::Command::new(&tar)
                .arg("-xf")
                .arg(zip)
                .arg("-C")
                .arg(dest_dir)
                .status()
                .map_err(|e| format!("run tar: {e}"))?;
            if status.success() {
                return Ok(());
            }
        }
        // Fallback: PowerShell Expand-Archive (always present on Windows).
        let ps = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip.display(),
            dest_dir.display()
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .status()
            .map_err(|e| format!("run powershell expand: {e}"))?;
        if !status.success() {
            return Err(format!("Expand-Archive exited with {:?}", status.code()));
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let status = std::process::Command::new("tar")
            .arg("-xf")
            .arg(zip)
            .arg("-C")
            .arg(dest_dir)
            .status()
            .map_err(|e| format!("run tar: {e}"))?;
        if !status.success() {
            return Err(format!("tar exited with {:?}", status.code()));
        }
        Ok(())
    }
}

/// Download + install aria2c into `<app_data>/bin` if not already present.
/// Returns the absolute path of the ready-to-use binary. Idempotent: a
/// second call when already installed is a cheap path check.
pub async fn ensure(app: &AppHandle) -> Result<String, String> {
    if let Some(p) = aria2_path(app).filter(|p| p.is_file()) {
        return Ok(p.to_string_lossy().to_string());
    }
    let url = archive_url()?;
    let dir = managed_bin_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create bin dir: {e}"))?;
    let final_path = dir.join(binary_name());

    // 1) Download the archive into a temp file in the same dir.
    let client = reqwest::Client::builder()
        .user_agent("media-hub")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download aria2c: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download aria2c status: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("read aria2c body: {e}"))?;
    let zip_path = dir.join("aria2c.download.zip");
    std::fs::write(&zip_path, &bytes).map_err(|e| format!("write aria2c archive: {e}"))?;

    // 2) Extract to a temp subdir, locate the binary, move it into place.
    let extract_dir = dir.join("aria2c.extract");
    if extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&extract_dir);
    }
    let extract_result = extract_zip(&zip_path, &extract_dir).and_then(|()| {
        find_file(&extract_dir, binary_name())
            .ok_or_else(|| format!("{} not found in archive", binary_name()))
    });
    // 3) Always clean the downloaded archive; clean the extract dir after
    //    we've copied the binary out (or on failure).
    let _ = std::fs::remove_file(&zip_path);
    let src = match extract_result {
        Ok(src) => src,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&extract_dir);
            return Err(e);
        }
    };
    let copy_result = std::fs::copy(&src, &final_path).map_err(|e| format!("install aria2c: {e}"));
    let _ = std::fs::remove_dir_all(&extract_dir);
    copy_result?;

    // 4) Make it executable on unix (no-op on Windows).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&final_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&final_path, perms);
        }
    }

    Ok(final_path.to_string_lossy().to_string())
}

// =====================================================================
// Tauri commands
// =====================================================================

/// Whether aria2c is installed and ready. The Settings UI uses this to
/// render the toggle's current state on load.
#[tauri::command]
pub fn aria2_status(app: AppHandle) -> bool {
    is_installed(&app)
}

/// Download + install aria2c on demand. Called by the Settings toggle
/// when the user turns the feature on; on Err the UI reverts the toggle
/// and shows the message.
#[tauri::command]
pub async fn aria2_ensure(app: AppHandle) -> Result<String, String> {
    ensure(&app).await
}
