// 1.2.16 — yt-dlp engine auto-updater.
//
// WHY THIS EXISTS
// ---------------
// Our entire reason-for-being depends on yt-dlp keeping up with YouTube
// (and every other site) breaking things. yt-dlp ships fixes constantly,
// but its *stable* channel can sit for months between releases — on
// 2026-05-28 a tester hit a runaway 1440p-HDR download and our bundled
// `2026.03.17` was already the newest STABLE, yet two months behind on
// the nightly channel where the YouTube fixes actually land.
//
// So: bake a fallback binary into the installer (always present), and on
// every launch quietly check the nightly channel and pull a newer one
// into a writable app-data folder. The download flow prefers that managed
// copy. No installer rebuild required when YouTube changes the rules.
//
// WHY APP-DATA, NOT IN-PLACE
// --------------------------
// We ship BOTH an NSIS (per-user, writable) and an MSI (Program Files,
// admin-only) installer. yt-dlp's own `-U` self-update and any "overwrite
// the bundled sidecar" scheme would silently fail for the MSI cohort.
// `%APPDATA%\com.guilherme.mediahub\bin\` is always writable, so the
// updater is install-location-agnostic.
//
// WHY shell.command() WORKS WITHOUT A SCOPE ENTRY
// -----------------------------------------------
// tauri-plugin-shell only enforces its allow-list scope on the IPC
// boundary (Command.create from JS). Our Rust `#[command]` functions call
// `app.shell().command(path)` directly, which is trusted and unscoped —
// and it returns the SAME `Command` type as `.sidecar()`, so the streaming
// CommandEvent + cancellation pipeline in `yt_download` is untouched.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::Command;
use tauri_plugin_shell::ShellExt;

/// How long to wait between background checks. Frequent app restarts
/// shouldn't hammer GitHub's unauthenticated API (60 req/hr/IP).
const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// GitHub API endpoint for the latest nightly release metadata.
const NIGHTLY_API: &str =
    "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";

/// Per-platform release asset name + the local managed filename.
#[cfg(target_os = "windows")]
const ASSET_NAME: &str = "yt-dlp.exe";
#[cfg(target_os = "windows")]
const MANAGED_NAME: &str = "yt-dlp.exe";

#[cfg(target_os = "macos")]
const ASSET_NAME: &str = "yt-dlp_macos";
#[cfg(target_os = "macos")]
const MANAGED_NAME: &str = "yt-dlp";

#[cfg(all(unix, not(target_os = "macos")))]
const ASSET_NAME: &str = "yt-dlp_linux";
#[cfg(all(unix, not(target_os = "macos")))]
const MANAGED_NAME: &str = "yt-dlp";

fn download_url() -> String {
    format!(
        "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/{}",
        ASSET_NAME
    )
}

/// `<app_data>/bin` — the writable home for the managed yt-dlp.
fn managed_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data dir: {e}"))?
        .join("bin");
    Ok(dir)
}

/// Absolute path the managed binary lives at (may not exist yet).
fn managed_yt_dlp_path(app: &AppHandle) -> Option<PathBuf> {
    managed_bin_dir(app).ok().map(|d| d.join(MANAGED_NAME))
}

/// Build a yt-dlp command, preferring the managed (auto-updated) binary
/// in app-data and falling back to the installer-bundled sidecar.
///
/// This is THE single resolution point — every yt-dlp invocation in the
/// app routes through here so the managed copy is used everywhere or
/// nowhere, consistently.
pub fn resolve_yt_dlp(app: &AppHandle) -> Result<Command, String> {
    let shell = app.shell();
    if let Some(p) = managed_yt_dlp_path(app) {
        if p.is_file() {
            return Ok(shell.command(p.to_string_lossy().to_string()));
        }
    }
    shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar resolve: {e}"))
}

/// Run `<binary> --version` and return the first non-empty line.
async fn version_of(cmd: Command) -> Result<String, String> {
    let out = cmd
        .args(["--version"])
        .output()
        .await
        .map_err(|e| format!("run --version: {e}"))?;
    if !out.status.success() {
        return Err(format!("--version exit {:?}", out.status.code()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "no version output".to_string())
}

/// Version of whatever binary `resolve_yt_dlp` currently picks.
pub async fn current_version(app: &AppHandle) -> Option<String> {
    let cmd = resolve_yt_dlp(app).ok()?;
    version_of(cmd).await.ok()
}

/// Compare two yt-dlp version strings. Both stable (`2026.03.17`) and
/// nightly (`2026.05.25.234532`) are dotted decimal and sort
/// chronologically by numeric component. Returns true when `candidate`
/// is strictly newer than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.split('.').map(|p| p.trim().parse().unwrap_or(0)).collect()
    }
    let (a, b) = (parts(candidate), current);
    let b = parts(b);
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// Fetch the latest nightly tag (e.g. "2026.05.25.234532") from GitHub.
async fn latest_nightly_tag() -> Result<String, String> {
    // GitHub rejects API requests without a User-Agent.
    let client = reqwest::Client::builder()
        .user_agent("media-hub-updater")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let body = client
        .get(NIGHTLY_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("github request: {e}"))?
        .error_for_status()
        .map_err(|e| format!("github status: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read github body: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("parse github json: {e}"))?;
    json.get("tag_name")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .ok_or_else(|| "no tag_name in github response".to_string())
}

/// Download the nightly binary to app-data, verify it runs, and swap it
/// in atomically. Returns the version string of the installed binary.
async fn perform_update(app: &AppHandle) -> Result<String, String> {
    let dir = managed_bin_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create bin dir: {e}"))?;
    let tmp = dir.join("yt-dlp.download");
    let final_path = dir.join(MANAGED_NAME);

    // 1) Download to a temp file in the same dir (so the final rename is
    //    a cheap same-volume move).
    let client = reqwest::Client::builder()
        .user_agent("media-hub-updater")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let bytes = client
        .get(download_url())
        .send()
        .await
        .map_err(|e| format!("download request: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download status: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("read download body: {e}"))?;
    if bytes.len() < 1_000_000 {
        // A real yt-dlp build is ~18 MB. Anything tiny is an error page
        // or a truncated transfer — refuse to install it.
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("download too small ({} bytes)", bytes.len()));
    }
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write temp binary: {e}"))?;

    // 2) On Unix the downloaded file needs the executable bit.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp)
            .map_err(|e| format!("stat temp binary: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp, perms)
            .map_err(|e| format!("chmod temp binary: {e}"))?;
    }

    // 3) Verify the downloaded binary actually runs before trusting it.
    let shell = app.shell();
    let verify_cmd = shell.command(tmp.to_string_lossy().to_string());
    let new_version = match version_of(verify_cmd).await {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("downloaded binary failed verification: {e}"));
        }
    };

    // 4) Swap in. Windows `rename` won't clobber an existing file, so
    //    remove the old managed copy first. If it's locked (a download is
    //    mid-flight using it), bail gracefully and try again next launch.
    if final_path.exists() {
        if let Err(e) = std::fs::remove_file(&final_path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("replace existing binary (in use?): {e}"));
        }
    }
    std::fs::rename(&tmp, &final_path).map_err(|e| format!("install binary: {e}"))?;
    Ok(new_version)
}

fn marker_path(app: &AppHandle) -> Option<PathBuf> {
    managed_bin_dir(app)
        .ok()
        .map(|d| d.join(".last_update_check"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// True when we checked within CHECK_INTERVAL_SECS.
fn checked_recently(app: &AppHandle) -> bool {
    let Some(p) = marker_path(app) else {
        return false;
    };
    let Ok(contents) = std::fs::read_to_string(&p) else {
        return false;
    };
    let Ok(last) = contents.trim().parse::<u64>() else {
        return false;
    };
    now_secs().saturating_sub(last) < CHECK_INTERVAL_SECS
}

fn touch_marker(app: &AppHandle) {
    if let Some(p) = marker_path(app) {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, now_secs().to_string());
    }
}

/// Compare current vs. latest nightly and update if newer. When `force`
/// is false the 24h throttle applies and a no-op returns Ok(None).
/// Returns Some(new_version) when an update was installed.
pub async fn check_and_update(app: &AppHandle, force: bool) -> Result<Option<String>, String> {
    if !force && checked_recently(app) {
        return Ok(None);
    }
    // Record the attempt up front so a flaky network doesn't make every
    // launch re-hit GitHub within the throttle window.
    touch_marker(app);

    let latest = latest_nightly_tag().await?;
    let current = current_version(app).await;
    let should = match &current {
        Some(c) => is_newer(&latest, c),
        None => true, // no working binary at all — definitely install
    };
    if !should {
        return Ok(None);
    }
    let installed = perform_update(app).await?;
    eprintln!(
        "[updater] yt-dlp updated {} -> {}",
        current.as_deref().unwrap_or("(none)"),
        installed
    );
    let _ = app.emit("yt-dlp:updated", installed.clone());
    Ok(Some(installed))
}

/// Fire-and-forget background check on app startup. Non-blocking; all
/// failures are logged, never fatal — a stale engine still works.
pub fn spawn_startup_check(app: AppHandle) {
    // `tauri::async_runtime::spawn`, NOT tokio::spawn: setup() has no
    // tokio reactor in scope (same lesson as the bridge server).
    tauri::async_runtime::spawn(async move {
        match check_and_update(&app, false).await {
            Ok(Some(v)) => eprintln!("[updater] engine now at {v}"),
            Ok(None) => {}
            Err(e) => eprintln!("[updater] background check failed: {e}"),
        }
    });
}

/// Manual "update now" — bypasses the throttle. Returns a human-readable
/// status string for the UI (Settings button / About panel).
#[tauri::command]
pub async fn yt_dlp_update_now(app: AppHandle) -> Result<String, String> {
    match check_and_update(&app, true).await? {
        Some(v) => Ok(format!("Updated to {v}")),
        None => {
            let cur = current_version(&app)
                .await
                .unwrap_or_else(|| "unknown".to_string());
            Ok(format!("Already up to date ({cur})"))
        }
    }
}

/// Report the active engine version + whether it's the managed copy.
#[tauri::command]
pub async fn yt_dlp_engine_info(app: AppHandle) -> EngineInfo {
    let managed = managed_yt_dlp_path(&app)
        .map(|p| p.is_file())
        .unwrap_or(false);
    EngineInfo {
        version: current_version(&app).await,
        managed,
    }
}

#[derive(serde::Serialize)]
pub struct EngineInfo {
    pub version: Option<String>,
    pub managed: bool,
}

// =====================================================================
// 1.3.0 — App auto-updater (distinct from the yt-dlp engine updater above).
// =====================================================================
//
// The yt-dlp updater above keeps the *download engine* fresh. This second
// updater keeps the *Media Hub app itself* fresh — so when we ship a bug
// fix, testers don't need to walk through a manual reinstall.
//
// How it works at runtime:
//   1. App calls `check_for_app_update`. tauri-plugin-updater hits the
//      endpoint in tauri.conf.json (a GitHub Releases-hosted
//      `latest.json` manifest), compares its `version` field to the
//      bundled app version.
//   2. If newer, plugin downloads the signed installer, verifies the
//      minisign signature against the public key baked into the binary
//      (also in tauri.conf.json), then asks Windows to run it. The
//      `installMode: "passive"` config shows a silent progress dialog
//      and relaunches automatically.
//
// What you (the human) do per release:
//   - Build the installer with the matching private key in your env
//     (TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/media-hub.key).
//   - Publish a GitHub Release with the .exe + a signed `latest.json`
//     attached. See docs/NOTES.md "App auto-update release process"
//     for the exact recipe.
//
// LOSING THE PRIVATE KEY = every existing install can never auto-update
// again (they verify against a public key they won't match). Back it up.

use tauri_plugin_updater::UpdaterExt;

/// Status returned from `check_for_app_update`. Keeps the IPC surface
/// JSON-friendly even though the plugin's own `Update` type isn't.
#[derive(serde::Serialize)]
pub struct AppUpdateStatus {
    /// True when the server reports a newer version than the installed one.
    pub available: bool,
    /// Version string from the manifest. Always populated.
    pub remote_version: String,
    /// Currently installed app version (matches Cargo.toml / tauri.conf).
    pub current_version: String,
    /// Optional release notes body from the manifest.
    pub notes: Option<String>,
}

/// One-shot "is there a newer build?" check. Cheap (single HTTP GET).
/// Returns even when no update — caller can show "you're up to date."
#[tauri::command]
pub async fn check_for_app_update(app: AppHandle) -> Result<AppUpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app
        .updater()
        .map_err(|e| format!("init updater: {e}"))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(AppUpdateStatus {
            available: true,
            remote_version: update.version.clone(),
            current_version,
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(AppUpdateStatus {
            available: false,
            remote_version: current_version.clone(),
            current_version,
            notes: None,
        }),
        Err(e) => Err(format!("update check failed: {e}")),
    }
}

/// Download + install the latest update. After a successful run on
/// Windows the installer relaunches the app automatically (we set
/// `installMode: "passive"` in tauri.conf.json so the user sees a
/// progress UI but doesn't have to click through wizard pages).
///
/// Returns the version that was installed so the UI can show a final
/// "Updated to X — relaunching" message, though in practice the app
/// is usually gone by the time JS would render that.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<String, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("init updater: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update check: {e}"))?
        .ok_or_else(|| "no update available".to_string())?;
    let version = update.version.clone();
    // download_and_install handles signature verification + Windows
    // launch internally. The two callbacks are for progress reporting;
    // we ignore them for now (the plugin's own UI is enough at this
    // stage; can wire a Tauri event later if we want a custom bar).
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| format!("download/install failed: {e}"))?;
    Ok(version)
}
