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

/// A downloadable tool: where to get it per-OS, what files to pull out of
/// the archive, and what to call them once installed.
struct ToolSpec {
    /// Stable id used in events + the on-disk filename stem.
    id: &'static str,
    /// URL of the archive to download for this platform.
    url: &'static str,
    /// Files to pull out of the archive, as (name INSIDE the archive,
    /// installed name). Found recursively, so archive layout is free.
    /// 1.14.0 — was a single `member`. The RTX worker ships as a bundle
    /// (exe + weights blob + the two NVIDIA runtime DLLs) that only makes
    /// sense installed together.
    members: &'static [(&'static str, &'static str)],
    /// The PRIMARY installed filename — what `tool_path` and the status
    /// commands check for. Must be one of `members`' output names.
    out_name: &'static str,
    /// 1.14.0 — when set, the install becomes version-aware: the string is
    /// written to `<bin>/.<id>.version` after a successful install, and a
    /// mismatch (or a missing marker) reinstalls EVEN IF the binary is
    /// already there.
    ///
    /// Without this, `ensure` only ever asked "does the file exist?", so a
    /// newer build published at the same URL never reached anyone who had
    /// the old one — they would have kept a worker that silently ignores
    /// the CodecClean filter. Left `None` for ffmpeg/deno, whose URLs
    /// already point at a moving "latest" and whose behaviour we don't
    /// want to change.
    version: Option<&'static str>,
    /// Optional SHA-256 (lowercase hex) of the DOWNLOADED ARCHIVE. When
    /// set, a mismatch aborts the install before anything is extracted —
    /// until now a downloaded executable was trusted on the strength of an
    /// HTTP 200 alone.
    sha256: Option<&'static str>,
    /// Size of the archive in bytes, when known. Purely informational: the
    /// UI shows it BEFORE the user commits to a download, which for the RTX
    /// bundle is the difference between "Install" and "Install (28 MB)".
    /// Lives here so it is updated in the same edit as `url` and `sha256`.
    bytes: Option<u64>,
}

#[cfg(windows)]
fn ffmpeg_spec() -> ToolSpec {
    ToolSpec {
        id: "ffmpeg",
        // Stable release branch (n7.1) — NOT master-latest. See
        // scripts/fetch-sidecars.ps1 for why master churn is a hazard.
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip",
        members: &[("ffmpeg.exe", "ffmpeg.exe")],
        out_name: "ffmpeg.exe",
        version: None,
        sha256: None,
        bytes: None,
    }
}
#[cfg(not(windows))]
fn ffmpeg_spec() -> ToolSpec {
    ToolSpec {
        id: "ffmpeg",
        url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
        members: &[("ffmpeg", "ffmpeg")],
        out_name: "ffmpeg",
        version: None,
        sha256: None,
        bytes: None,
    }
}

#[cfg(windows)]
fn deno_spec() -> ToolSpec {
    ToolSpec {
        id: "deno",
        url: "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip",
        members: &[("deno.exe", "deno.exe")],
        out_name: "deno.exe",
        version: None,
        sha256: None,
        bytes: None,
    }
}
#[cfg(not(windows))]
fn deno_spec() -> ToolSpec {
    ToolSpec {
        id: "deno",
        url: "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip",
        members: &[("deno", "deno")],
        out_name: "deno",
        version: None,
        sha256: None,
        bytes: None,
    }
}

/// 1.14.0 — the RTX enhance worker, as a BUNDLE.
///
/// Four files that only make sense together: the worker, the CodecClean
/// weights it refuses to start without when the filter is on, and the two
/// NVIDIA RTX Video SDK runtimes it links against. Windows-only — there is
/// no static build of the SDK runtimes for macOS.
///
/// `version` is the worker's own `git describe`, so the marker on disk
/// names the exact commit that produced the binary. It is NOT read back
/// from the executable: `BUILD_VERSION` used to be stamped at cmake
/// CONFIGURE time and could report a build five hours older than the link,
/// and a file the installer writes itself cannot drift from what it did.
///
/// Distribution note: the SDK license permits shipping these runtimes
/// incorporated into an application, and forbids shipping them as a
/// stand-alone product — hence one bundle published as a Media Hub
/// component, never a DLL-only archive, and never in git.
#[cfg(windows)]
fn rtx_worker_spec() -> ToolSpec {
    ToolSpec {
        id: "rtx-worker",
        url: "https://github.com/guilhermebarony-coder/media-hub/releases/download/rtx-worker-v0.2.0-15/rtx-worker-win64.zip",
        // 1.15.0 — MIT files ONLY. The two NVIDIA DLLs used to be extracted
        // from here; `nvngx_vsr.dll` now ships inside the Media Hub installer
        // (see RTX_RUNTIME_DLLS) and `nvngx_truehdr.dll` is gone entirely.
        // Listing fewer members than the archive contains is fine — members
        // are looked up by name, the rest is discarded with the extract dir.
        members: &[
            ("RTXVideoProcessor.exe", "RTXVideoProcessor.exe"),
            ("cc_32x4.blob", "cc_32x4.blob"),
        ],
        out_name: "RTXVideoProcessor.exe",
        version: Some("v0.2.0-15-g8ef4b82"),
        sha256: Some("bb862505e283e085e524af5ce6838ec01dae07b5e0ee4c1176d2551bd2e832db"),
        bytes: Some(29_382_853),
    }
}

/// NVIDIA's proprietary runtime — NOT in the download.
///
/// Two facts forced this shape:
///
///  1. The archive is a public GitHub release asset. NVIDIA's grant covers
///     redistribution *incorporated into an application*; a binary sitting at
///     a URL anyone can curl is the standalone case. Shipping it inside our
///     own installer is the co-distribution model NVIDIA's NGX guide actually
///     describes ("installs in the app's folder … remove on uninstall").
///
///  2. It has to end up BESIDE `RTXVideoProcessor.exe`, not merely reachable.
///     The worker statically links NGX's loader, and that loader resolves
///     feature DLLs from the executable's own directory only. Measured
///     2026-08-20 against the shipped worker: DLL on `PATH` → "RTX API create
///     failed"; DLL in the working directory → same failure; DLL next to the
///     exe → clean run. So we copy, we do not point at it.
#[cfg(windows)]
const RTX_RUNTIME_DLLS: &[&str] = &["nvngx_vsr.dll"];

/// Files older bundles put in `bin` that we do not ship any more. Deleted on
/// every RTX install so dropping a feature actually shrinks what is on the
/// user's disk — leaving a proprietary DLL behind after removing the feature
/// it served is the one outcome that gets the legal surface wrong twice.
#[cfg(windows)]
const RTX_OBSOLETE: &[&str] = &["nvngx_truehdr.dll"];

/// Copy the bundled NVIDIA runtime next to the worker, and sweep away
/// anything a previous bundle left behind.
#[cfg(windows)]
fn place_rtx_runtime(app: &AppHandle) -> Result<(), String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    let dir = crate::aria2::managed_bin_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create bin dir: {e}"))?;

    for name in RTX_RUNTIME_DLLS {
        let src = app
            .path()
            .resolve(format!("resources/{name}"), BaseDirectory::Resource)
            .map_err(|e| format!("resolve bundled {name}: {e}"))?;
        if !src.is_file() {
            // A build without the SDK drop-in. Say so plainly instead of
            // installing a worker that cannot start.
            return Err(format!(
                "{name} is missing from this build of Media Hub — the RTX                  enhancer cannot be installed. See src-tauri/resources/README.md.",
            ));
        }
        let dst = dir.join(name);
        install_file(&src, &dst).map_err(|e| format!("place {name}: {e}"))?;
    }

    sweep_rtx_obsolete(app);
    sweep_replaced(&dir);
    Ok(())
}

/// Delete RTX files we no longer ship, wherever a previous version put them.
///
/// Called at startup, NOT only from the install path. Everyone who already
/// had the old bundle also has a matching version marker, so they report
/// "up to date" and would never trigger an install — the exact users holding
/// the obsolete DLL are the ones an install-time-only cleanup cannot reach.
/// Best-effort by design: a file held open just waits for the next launch.
#[cfg(windows)]
pub fn sweep_rtx_obsolete(app: &AppHandle) {
    let Ok(dir) = crate::aria2::managed_bin_dir(app) else {
        return;
    };
    for name in RTX_OBSOLETE {
        let path = dir.join(name);
        if path.is_file() && std::fs::remove_file(&path).is_ok() {
            crate::diag::log(app, "tools", &format!("removed obsolete {name}"));
        }
    }
}

#[cfg(not(windows))]
pub fn sweep_rtx_obsolete(_app: &AppHandle) {}

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

/// Should `ensure` (re)install?
///
/// `present` — the primary file is on disk. `have` — the version marker's
/// contents. `want` — the spec's version, `None` for tools that aren't
/// version-tracked.
///
/// The rule that matters: a version-tracked tool whose marker doesn't match
/// is reinstalled EVEN THOUGH the binary is present. Before 1.14.0 this
/// decision was effectively `!present`, so a tool installed once could
/// never be updated — every existing user would have kept an RTX worker
/// that ignores the CodecClean filter without saying so.
fn needs_install(present: bool, have: Option<&str>, want: Option<&str>) -> bool {
    if !present {
        return true;
    }
    match want {
        None => false,              // not version-tracked: presence is enough
        Some(w) => have != Some(w), // missing or stale marker => reinstall
    }
}

/// Version string recorded by the last successful install of `id`, if any.
fn installed_version(app: &AppHandle, id: &str) -> Option<String> {
    let dir = crate::aria2::managed_bin_dir(app).ok()?;
    std::fs::read_to_string(dir.join(format!(".{id}.version")))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// SHA-256 of a file, lowercase hex. Chunked — these archives run to tens
/// of megabytes and must not be held in memory.
fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| format!("open for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("read for hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Copy `src` over `dst`, surviving the case where `dst` is RUNNING.
///
/// Windows refuses to overwrite a loaded executable or DLL (os error 32,
/// ERROR_SHARING_VIOLATION) — which is exactly what a tool update hits
/// when a job is in flight. A running image can't be written, but it CAN
/// be renamed: the old file keeps serving the live process under its new
/// name and the new one takes the real path. The leftovers are swept on
/// the next install, once nothing has them open.
fn install_file(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    match std::fs::copy(src, dst) {
        Ok(_) => Ok(()),
        Err(e) if dst.exists() => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let parked = dst.with_extension(format!(
                "{}.old-{stamp}",
                dst.extension().and_then(|e| e.to_str()).unwrap_or("bin")
            ));
            std::fs::rename(dst, &parked).map_err(|_| e)?;
            std::fs::copy(src, dst).map(|_| ())
        }
        Err(e) => Err(e),
    }
}

/// Delete files parked by a previous `install_file` retry. Best-effort:
/// anything still held open simply stays for the next sweep.
fn sweep_replaced(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        if name.contains(".old-") {
            let _ = std::fs::remove_file(e.path());
        }
    }
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
    // Installed AND (unversioned, or the marker matches) => nothing to do.
    // The version check is what lets a new build replace an old one; an
    // existence-only guard meant a tool installed once was frozen forever.
    if let Some(p) = tool_path(app, spec.out_name).filter(|p| p.is_file()) {
        let have = installed_version(app, spec.id);
        if !needs_install(true, have.as_deref(), spec.version) {
            emit(app, ToolProgress { tool: spec.id, phase: "done", received: 0, total: None, percent: Some(100.0) });
            return Ok(p);
        }
        crate::diag::log(
            app,
            "tools",
            &format!(
                "{} is stale (have {:?}, want {:?}) — reinstalling",
                spec.id,
                installed_version(app, spec.id),
                spec.version
            ),
        );
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

    // 1b) Integrity. An HTTP 200 says the bytes arrived, not that they're
    // the bytes we meant to run — and one of these archives carries an
    // executable. Checked BEFORE anything is extracted.
    if let Some(want) = spec.sha256 {
        let got = sha256_file(&zip_path)?;
        if !got.eq_ignore_ascii_case(want) {
            let _ = std::fs::remove_file(&zip_path);
            return Err(format!(
                "{} download is corrupt or tampered with (sha256 {got}, expected {want})",
                spec.id
            ));
        }
    }

    // 2) Extract, then install every member.
    emit(app, ToolProgress { tool: spec.id, phase: "extract", received, total, percent: Some(100.0) });
    let extract_dir = dir.join(format!("{}.extract", spec.id));
    let _ = std::fs::remove_dir_all(&extract_dir);
    let unzip = crate::aria2::extract_zip(&zip_path, &extract_dir);
    let _ = std::fs::remove_file(&zip_path);
    if let Err(e) = unzip {
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(e);
    }

    let mut installed: Vec<std::path::PathBuf> = Vec::new();
    for (member, out_name) in spec.members {
        let found = crate::aria2::find_file(&extract_dir, member);
        let src = match found {
            Some(s) => s,
            None => {
                let _ = std::fs::remove_dir_all(&extract_dir);
                return Err(format!("{member} not found in {} archive", spec.id));
            }
        };
        let final_path = dir.join(out_name);
        if let Err(e) = install_file(&src, &final_path) {
            let _ = std::fs::remove_dir_all(&extract_dir);
            return Err(format!("install {}/{member}: {e}", spec.id));
        }
        installed.push(final_path);
    }
    let _ = std::fs::remove_dir_all(&extract_dir);

    // 3) Stamp the version only once EVERY member landed, so a partial
    // install can never masquerade as an up-to-date one.
    if let Some(v) = spec.version {
        let marker = dir.join(format!(".{}.version", spec.id));
        std::fs::write(&marker, v).map_err(|e| format!("write version marker: {e}"))?;
    }
    sweep_replaced(&dir);

    let final_path = dir.join(spec.out_name);

    #[cfg(unix)]
    for p in &installed {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(p) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(p, perms);
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


/// 1.14.0 — install/update the RTX worker bundle on demand.
///
/// Deliberately NOT part of `tools_ensure`: that runs on first launch for
/// every user, and this is a ~29 MB download only RTX users need. The
/// enhance UI calls it when the user asks to enhance.
///
/// Safe to call when already installed — `ensure` returns immediately
/// unless the version marker disagrees with the spec, which is exactly
/// how an out-of-date worker gets replaced.
#[tauri::command]
pub async fn rtx_worker_ensure(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure(&app, &rtx_worker_spec()).await?;
        // The download is only half the install — the NVIDIA runtime comes
        // from our own installer. Unconditional: `ensure` short-circuits when
        // the version marker already matches, and an app update that changes
        // only the bundled DLL still has to land it.
        place_rtx_runtime(&app)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("the RTX worker is Windows-only".into())
    }
}

/// Download size of the RTX worker bundle, for the install prompt.
pub fn rtx_worker_download_bytes() -> u64 {
    rtx_worker_spec().bytes.unwrap_or(0)
}

/// Whether the installed RTX worker bundle is present AND current.
/// `None` means "not installed at all".
#[cfg(windows)]
pub fn rtx_worker_freshness(app: &AppHandle) -> Option<bool> {
    let spec = rtx_worker_spec();
    // "Present" spans both halves of the install: the downloaded members AND
    // the runtime we copy in ourselves. A worker with no `nvngx_vsr.dll`
    // beside it starts and then fails at RTX init, which is the worst of the
    // three possible states to report as installed.
    let present = tool_path(app, spec.out_name).is_some_and(|p| p.is_file())
        && spec
            .members
            .iter()
            .all(|(_, out)| tool_path(app, out).is_some_and(|p| p.is_file()))
        && RTX_RUNTIME_DLLS
            .iter()
            .all(|n| tool_path(app, n).is_some_and(|p| p.is_file()));
    if !present {
        return None;
    }
    Some(!needs_install(true, installed_version(app, spec.id).as_deref(), spec.version))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1.15.0 — the RTX bundle is now the ONLY way the enhancer reaches a
    /// machine: it is not in the installer, and the whole RTX UI stays
    /// hidden until this download lands. So every fact the install path
    /// depends on has to be present, and `out_name` has to be a file the
    /// extraction actually produces — otherwise `tool_path` looks for a
    /// name nothing writes and the app installs successfully forever
    /// while reporting "not installed".
    #[cfg(windows)]
    #[test]
    fn the_rtx_bundle_can_actually_install_itself() {
        let spec = rtx_worker_spec();
        assert!(spec.url.starts_with("https://"), "url must be https");
        assert!(spec.version.is_some(), "the bundle is version-tracked");
        assert!(spec.sha256.is_some(), "the archive is verified before extraction");
        assert_eq!(
            spec.sha256.unwrap().len(),
            64,
            "sha256 must be 64 lowercase hex chars",
        );
        assert!(
            spec.bytes.is_some_and(|b| b > 0),
            "the install prompt quotes this size before the user agrees to it",
        );
        assert!(
            spec.members.iter().any(|(_, out)| *out == spec.out_name),
            "out_name ({}) is not produced by any member",
            spec.out_name,
        );
        for needed in ["RTXVideoProcessor.exe", "cc_32x4.blob"] {
            assert!(
                spec.members.iter().any(|(_, out)| *out == needed),
                "bundle is missing {needed}",
            );
        }
        // The whole point of 1.15.0's split: nothing proprietary is pulled
        // from the public archive. If someone re-adds a DLL to `members` to
        // "fix" an install, this fails and sends them to SHIPPING_LEGAL.md.
        for forbidden in RTX_RUNTIME_DLLS.iter().chain(RTX_OBSOLETE.iter()) {
            assert!(
                !spec.members.iter().any(|(m, out)| m == forbidden || out == forbidden),
                "{forbidden} must NOT come from the public archive — see                  docs/SHIPPING_LEGAL.md",
            );
        }
        assert!(
            !RTX_RUNTIME_DLLS.is_empty(),
            "the worker needs NVIDIA's runtime beside it; an empty list means              nothing is ever placed and every enhance fails at RTX init",
        );
    }

    /// 1.14.0 — the predicate behind the stale-binary fix. The RTX worker
    /// staged on this machine was from 2026-07-05 and silently ignored the
    /// filter; under the old existence-only rule no update could ever have
    /// reached it.
    #[test]
    fn stale_version_forces_a_reinstall() {
        // Not installed: always install, tracked or not.
        assert!(needs_install(false, None, None));
        assert!(needs_install(false, None, Some("v2")));

        // Untracked tools (ffmpeg, deno) keep the old behaviour exactly:
        // presence is enough, marker irrelevant.
        assert!(!needs_install(true, None, None));
        assert!(!needs_install(true, Some("anything"), None));

        // Tracked: the marker decides.
        assert!(!needs_install(true, Some("v2"), Some("v2")), "match => keep");
        assert!(needs_install(true, Some("v1"), Some("v2")), "stale => reinstall");
        assert!(
            needs_install(true, None, Some("v2")),
            "installed before versioning existed => reinstall"
        );
    }

    #[test]
    fn sha256_matches_known_vector() {
        let dir = std::env::temp_dir().join("mh-tools-test-sha");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("abc.bin");
        std::fs::write(&f, b"abc").unwrap();
        assert_eq!(
            sha256_file(&f).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A replaced-but-locked file is parked as `*.old-*`; the sweep clears
    /// those and leaves everything else alone.
    #[test]
    fn sweep_only_removes_parked_files() {
        let dir = std::env::temp_dir().join("mh-tools-test-sweep");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("worker.exe"), b"live").unwrap();
        std::fs::write(dir.join("worker.exe.old-1700000000"), b"parked").unwrap();
        std::fs::write(dir.join(".rtx-worker.version"), b"v1").unwrap();

        sweep_replaced(&dir);

        assert!(dir.join("worker.exe").exists(), "live binary must survive");
        assert!(dir.join(".rtx-worker.version").exists(), "marker must survive");
        assert!(!dir.join("worker.exe.old-1700000000").exists(), "parked must go");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_file_replaces_destination() {
        let dir = std::env::temp_dir().join("mh-tools-test-install");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("new.bin");
        let dst = dir.join("installed.bin");
        std::fs::write(&src, b"new-bytes").unwrap();
        std::fs::write(&dst, b"old").unwrap();

        install_file(&src, &dst).unwrap();
        assert_eq!(std::fs::read(&dst).unwrap(), b"new-bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }
}