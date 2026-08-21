// Media Hub — NVIDIA RTX Video enhance: capability detection + progress
// parsing (Phase 1 scaffolding). See docs/RTX_UPSCALE_PLAN.md.
//
// The optional "Upscale this clip → NVIDIA RTX Video" feature runs RTX Video
// Super Resolution (VSR, quality Ultra) on a clip. The heavy lifting is a
// separate, reusable worker (the MIT `RTXVideoProcessor` CLI + NVIDIA's
// `nvngx_vsr.dll`) driven as a lazy-downloaded sidecar — kept app-agnostic so
// the same unit can drop into other apps (e.g. Chiral Network); the only
// Media-Hub-specific glue is the #[tauri::command] wrapper at the bottom.
//
// This module is the front gate (is it even possible on this machine?) plus
// the stderr progress parser the enhance command will feed a real % bar from.
// VSR + our worker are Windows-only for now, so the detection/parse internals
// are Windows-gated; `detect()` returns a clean "unsupported" elsewhere.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

use crate::diag;
use crate::library::{AssetInput, LibraryState};

/// Result of probing the machine for RTX Video enhance support.
#[derive(Debug, Clone, Serialize)]
pub struct RtxCapability {
    /// True only when everything needed to run VSR is present.
    pub supported: bool,
    /// GPU model as reported by the driver (empty if none found).
    pub gpu_name: String,
    /// Driver version string, e.g. "610.47" (empty if unknown).
    pub driver_version: String,
    /// Human-readable reason when `supported` is false (None when supported).
    pub reason: Option<String>,
}

impl RtxCapability {
    fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            gpu_name: String::new(),
            driver_version: String::new(),
            reason: Some(reason.into()),
        }
    }
}

/// Probe the machine for RTX Video enhance support.
pub fn detect() -> RtxCapability {
    #[cfg(not(windows))]
    {
        RtxCapability::unsupported("RTX upscale is Windows-only for now.")
    }
    #[cfg(windows)]
    {
        match query_nvidia_smi() {
            Some(line) => capability_from_smi(&line),
            None => RtxCapability::unsupported(
                "No NVIDIA GPU or driver detected (nvidia-smi not found).",
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Windows-only detection internals (VSR runtime is Windows-only).
// ---------------------------------------------------------------------------

/// Minimum NVIDIA driver for the RTX Video SDK VSR runtime (r550.58).
#[cfg(windows)]
const MIN_DRIVER_MAJOR: u32 = 550;
#[cfg(windows)]
const MIN_DRIVER_MINOR: u32 = 58;

/// Run `nvidia-smi` and return its first non-empty CSV line, or None if the
/// tool is absent (⇒ no NVIDIA driver) or errors.
#[cfg(windows)]
fn query_nvidia_smi() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let out = Command::new("nvidia-smi")
        .args(["--query-gpu=name,driver_version", "--format=csv,noheader"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW — no cmd flash
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .find(|l| !l.is_empty())
}

/// Split nvidia-smi's `name, driver` CSV line into its two fields.
#[cfg(windows)]
fn parse_smi_line(line: &str) -> Option<(String, String)> {
    let mut it = line.splitn(2, ',');
    let name = it.next()?.trim().to_string();
    let driver = it.next()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    Some((name, driver))
}

/// True when a "major.minor" driver string is ≥ the required minimum.
#[cfg(windows)]
fn driver_meets_min(driver: &str) -> bool {
    let mut it = driver.split('.');
    let major = it.next().and_then(|s| s.trim().parse::<u32>().ok());
    let minor = it.next().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0);
    match major {
        Some(maj) => (maj, minor) >= (MIN_DRIVER_MAJOR, MIN_DRIVER_MINOR),
        None => false,
    }
}

/// Decide support from a raw nvidia-smi line (pure; unit-tested).
#[cfg(windows)]
fn capability_from_smi(line: &str) -> RtxCapability {
    let Some((name, driver)) = parse_smi_line(line) else {
        return RtxCapability::unsupported("Could not read GPU info from nvidia-smi.");
    };
    // VSR needs tensor cores → RTX (Turing RTX 20-series or newer). GTX/MX
    // cards report no "RTX" in their name and are correctly excluded.
    if !name.to_uppercase().contains("RTX") {
        return RtxCapability {
            supported: false,
            reason: Some(format!(
                "{name} has no RTX tensor cores — RTX upscale needs an NVIDIA RTX GPU."
            )),
            gpu_name: name,
            driver_version: driver,
        };
    }
    if !driver_meets_min(&driver) {
        return RtxCapability {
            supported: false,
            reason: Some(format!(
                "NVIDIA driver {driver} is below the required r{MIN_DRIVER_MAJOR}.{MIN_DRIVER_MINOR} — please update your GPU driver."
            )),
            gpu_name: name,
            driver_version: driver,
        };
    }
    RtxCapability {
        supported: true,
        gpu_name: name,
        driver_version: driver,
        reason: None,
    }
}

// ---------------------------------------------------------------------------
// Worker progress parsing (Windows-only worker). The CLI prints a live bar to
// stderr, carriage-return updated per frame, e.g.
//   `  75.3% [55/73] 31.9 fps ETA: 00:00`
// (often prefixed with ANSI `\x1b[2K` clear-line noise). The enhance command
// splits the stderr stream on '\r' and feeds each segment here.
// ---------------------------------------------------------------------------

/// A single parsed progress update from the worker's stderr bar.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RtxProgress {
    pub percent: f32,
    pub frame: u32,
    pub total: u32,
    pub fps: f32,
    pub eta: String,
}

/// Parse one worker progress segment. Tolerant of leading ANSI/`\r` noise and
/// zero-padded numbers (`043.8%`). Returns None for non-progress lines (the
/// `[VERBOSE]/[INFO]` chatter), so callers can just try every segment.
pub fn parse_progress(seg: &str) -> Option<RtxProgress> {
    // percent: the number immediately before '%'.
    let pct_idx = seg.find('%')?;
    let percent = seg[..pct_idx]
        .rsplit(|c: char| c.is_whitespace() || c == ']' || c == '[')
        .find(|t| !t.is_empty())?
        .parse::<f32>()
        .ok()?;
    // frames: the `[current/total]` pair. Anchor on the single '/' so a
    // leading ANSI `\x1b[2K` bracket can't be mistaken for the frame bracket.
    let slash = seg.find('/')?;
    let lb = seg[..slash].rfind('[')?;
    let rb = seg[slash..].find(']')? + slash;
    let frame = seg[lb + 1..slash].trim().parse::<u32>().ok()?;
    let total = seg[slash + 1..rb].trim().parse::<u32>().ok()?;
    // fps: the number just before "fps" (optional).
    let fps = seg
        .find("fps")
        .and_then(|i| {
            seg[..i]
                .rsplit(char::is_whitespace)
                .find(|t| !t.is_empty())?
                .parse::<f32>()
                .ok()
        })
        .unwrap_or(0.0);
    // eta: the token after "ETA:" (optional).
    let eta = seg
        .find("ETA:")
        .map(|i| {
            seg[i + 4..]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();
    Some(RtxProgress {
        percent,
        frame,
        total,
        fps,
        eta,
    })
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// Whether this machine can run RTX Video enhance. The Library UI calls this
/// to show/hide/disable the "Upscale this clip" action.
#[tauri::command]
pub fn rtx_capability() -> RtxCapability {
    detect()
}

// ---------------------------------------------------------------------------
// Enhance command — wraps the lazy-downloaded worker (RTXVideoProcessor.exe +
// nvngx_vsr.dll), lives in `<app_data>/bin` next to ffmpeg/yt-dlp. The reusable
// core is spawn+parse; the sibling registration below is the Media-Hub glue.
// ---------------------------------------------------------------------------

/// Worker executable name in the managed bin dir.
const WORKER_EXE: &str = "RTXVideoProcessor.exe";

/// Path to the worker if it's installed (present in `<app_data>/bin`).
fn worker_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    crate::aria2::managed_bin_dir(app)
        .ok()
        .map(|d| d.join(WORKER_EXE))
        .filter(|p| p.is_file())
}

/// CodecClean weights, installed beside the worker by the same bundle.
/// Resolved HERE and never accepted from the frontend — it becomes a path
/// argument to a child process.
const CC_BLOB: &str = "cc_32x4.blob";

fn cc_blob_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    crate::aria2::managed_bin_dir(app)
        .ok()
        .map(|d| d.join(CC_BLOB))
        .filter(|p| p.is_file())
}

/// State of the installed RTX worker bundle.
///
/// 1.14.0 — was a bare `bool`, which could not express the state this
/// machine was actually in: a worker present since July that silently
/// ignores the CodecClean filter. "Installed" and "current" are different
/// questions and the UI has to ask both.
#[derive(Serialize)]
pub struct RtxWorkerStatus {
    /// The worker executable is on disk.
    pub installed: bool,
    /// Every file of the bundle is present AND the version marker matches
    /// the build this app expects. False when an older bundle is staged.
    pub up_to_date: bool,
    /// Size of the download, so the install prompt can say what it costs
    /// before the user agrees to it. 0 when unknown / not applicable.
    pub download_bytes: u64,
}

/// Whether the RTX worker is present and current. The UI uses this to
/// decide between "Enhance", "update the enhancer" and "install it".
#[tauri::command]
pub fn rtx_worker_status(app: AppHandle) -> RtxWorkerStatus {
    // 1.15.0 — the worker executable alone is not an install: without the
    // NVIDIA runtime beside it, every enhance dies at RTX init. `freshness`
    // answers both questions in one probe — None = not there at all, Some(b) =
    // there, and b says whether it is the build we expect. Probed once so the
    // two answers cannot disagree.
    #[cfg(windows)]
    let (installed, up_to_date) = match crate::tools::rtx_worker_freshness(&app) {
        Some(fresh) => (true, fresh),
        None => (false, false),
    };
    #[cfg(not(windows))]
    let (installed, up_to_date) = (worker_path(&app).is_some(), false);
    #[cfg(windows)]
    let download_bytes = crate::tools::rtx_worker_download_bytes();
    #[cfg(not(windows))]
    let download_bytes = 0;
    RtxWorkerStatus {
        installed,
        up_to_date,
        download_bytes,
    }
}

/// Per-frame progress, emitted as `rtx:progress`. `asset_id` is the ORIGINAL
/// clip being enhanced, so the UI can key the bar to the right card.
#[derive(Serialize, Clone)]
struct EnhanceEvent {
    asset_id: String,
    percent: f32,
    frame: u32,
    total: u32,
    fps: f32,
    eta: String,
}

/// Emitted once as `rtx:done` when the enhanced sibling is in the library.
#[derive(Serialize, Clone)]
struct EnhanceDone {
    asset_id: String,
    new_id: String,
}

/// The original asset's fields we need to spawn the worker and clone into the
/// enhanced sibling.
#[derive(sqlx::FromRow)]
struct OrigAsset {
    source_url: String,
    platform: String,
    video_id: Option<String>,
    channel: Option<String>,
    title: String,
    duration_sec: Option<f64>,
    file_path: String,
    project_id: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    fps: Option<f64>,
    thumbnail_url: Option<String>,
    kind: Option<String>,
}

/// Delete preview snippets older than 2h (best-effort) so the temp dir can't
/// grow without bound — including leftovers from crashed/prior sessions.
fn purge_old_previews(dir: &std::path::Path) {
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 3600);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let too_old = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if too_old {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Best-effort `(width, height)` of a video, read from ffmpeg's `-i` stderr
/// banner. Used for the ≥1440p guard and sibling dimensions when we don't
/// already have them from the library row (e.g. an externally dropped file).
async fn probe_dimensions(app: &AppHandle, path: &str) -> Option<(i64, i64)> {
    let cmd = crate::tools::ffmpeg_command(app).ok()?;
    let out = cmd.args(["-hide_banner", "-i", path]).output().await.ok()?;
    let s = String::from_utf8_lossy(&out.stderr);
    for line in s.lines() {
        if line.contains("Video:") {
            if let Some(dims) = parse_wxh(line) {
                return Some(dims);
            }
        }
    }
    None
}

/// Pixel format of the first video stream, as ffmpeg names it
/// ("yuv420p", "yuv420p10le", "p010le"...). Read from the same `-i` probe
/// `probe_dimensions` uses.
async fn probe_pix_fmt(app: &AppHandle, path: &str) -> Option<String> {
    let cmd = crate::tools::ffmpeg_command(app).ok()?;
    let out = cmd.args(["-hide_banner", "-i", path]).output().await.ok()?;
    let s = String::from_utf8_lossy(&out.stderr);
    s.lines().find(|l| l.contains("Video:")).and_then(parse_pix_fmt)
}

/// Pick the pixel-format token out of an ffmpeg `Video:` line.
///
/// The line reads like
/// `Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 720x960, …`
/// so we walk the comma-separated fields AFTER the codec one and take the
/// first that looks like a pixel format. The trailing `(tv, bt709…)` is
/// dropped — it's colour metadata, not part of the name.
fn parse_pix_fmt(line: &str) -> Option<String> {
    let after = line.split("Video:").nth(1)?;
    for field in after.split(',').skip(1) {
        let tok = field.trim().split_whitespace().next()?;
        let name = tok.split('(').next()?.trim();
        if name.len() >= 3
            && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && ["yuv", "yuvj", "gbr", "rgb", "bgr", "gray", "nv1", "nv2", "p01", "p21"]
                .iter()
                .any(|f| name.starts_with(f))
        {
            return Some(name.to_string());
        }
    }
    None
}

/// Does this pixel format carry more than 8 bits per component?
///
/// The CodecClean filter is 8-bit; the worker REFUSES a 10-bit input rather
/// than quietly bypassing, so we check before spending a download's worth
/// of decode on a job that will die.
fn pix_fmt_is_high_bit(pix: &str) -> bool {
    ["10le", "10be", "12le", "12be", "14le", "16le", "16be", "p010", "p012", "p016"]
        .iter()
        .any(|m| pix.contains(m))
}

/// Pull the first plausible `<w>x<h>` token (e.g. "1920x1080") out of a line.
/// Guards against the codec-tag noise (`0x31637661`) with a 16px floor.
fn parse_wxh(line: &str) -> Option<(i64, i64)> {
    for tok in line.split(|c: char| c == ' ' || c == ',' || c == '[' || c == ']') {
        if let Some((a, b)) = tok.split_once('x') {
            if let (Ok(w), Ok(h)) = (a.parse::<i64>(), b.parse::<i64>()) {
                if w >= 16 && h >= 16 {
                    return Some((w, h));
                }
            }
        }
    }
    None
}

/// Optional ffmpeg pre-clean pass run BEFORE the worker — a deblock/deband
/// filter chain to knock down macroblocking/banding on heavily-compressed
/// (e.g. YouTube) footage before VSR amplifies it. This is a tuning rig: every
/// value is exposed so presets can be dialed in on real clips. A non-empty
/// `raw` overrides the generated chain entirely (any ffmpeg `-vf` string).
///
/// The intermediate is re-encoded to H.264 (NVDEC, which the worker decodes
/// on, can't read lossless FFV1) at a near-visually-lossless CRF, so the only
/// added generation loss is that single high-quality encode.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrecleanOpts {
    pub enabled: bool,
    #[serde(default)]
    pub deblock: bool,
    #[serde(default = "default_deblock_filter")]
    pub deblock_filter: String,
    #[serde(default = "default_block")]
    pub block: u32,
    #[serde(default)]
    pub alpha: f32,
    #[serde(default)]
    pub beta: f32,
    #[serde(default)]
    pub gamma: f32,
    #[serde(default)]
    pub delta: f32,
    #[serde(default)]
    pub deband: bool,
    #[serde(default)]
    pub deband_thr: f32,
    #[serde(default = "default_deband_range")]
    pub deband_range: u32,
    #[serde(default)]
    pub deband_blur: bool,
    #[serde(default)]
    pub deband_coupling: bool,
    // Strong DCT deblock (spp) — far stronger than the weak `deblock` filter.
    #[serde(default)]
    pub spp: bool,
    #[serde(default = "default_spp")]
    pub spp_strength: u32,
    // Ultra-strong DCT deblock (uspp) — re-encodes at multiple offsets and
    // averages; kills heavy blocking spp leaves, but is much slower.
    #[serde(default)]
    pub uspp: bool,
    #[serde(default = "default_uspp")]
    pub uspp_strength: u32,
    // libplacebo GPU deband + dither (the research-winning post-clean).
    #[serde(default)]
    pub libplacebo: bool,
    #[serde(default = "default_lp_iterations")]
    pub lp_iterations: u32,
    #[serde(default = "default_lp_threshold")]
    pub lp_threshold: f32,
    #[serde(default = "default_lp_radius")]
    pub lp_radius: u32,
    #[serde(default = "default_lp_grain")]
    pub lp_grain: f32,
    // CAS contrast-adaptive sharpen (applied last).
    #[serde(default)]
    pub cas: bool,
    #[serde(default = "default_cas")]
    pub cas_strength: f32,
    // Edge-preserving GPU denoise (Vulkan nlmeans) — removes mosquito/ringing
    // around lines without smearing edges. Fast (GPU); helps VSR on noisy
    // lineart. `denoise_strength` is nlmeans_vulkan's `s` (0–100 scale).
    #[serde(default)]
    pub denoise: bool,
    #[serde(default = "default_denoise")]
    pub denoise_strength: f32,
    // Tiny gaussian pre-smooth (gblur) — softens 1px staircase edges into ramps
    // VSR can re-sharpen cleanly. Meant as the LAST pre-clean step before VSR.
    #[serde(default)]
    pub presmooth: bool,
    #[serde(default = "default_presmooth")]
    pub presmooth_sigma: f32,
    #[serde(default)]
    pub raw: Option<String>,
}

fn default_deblock_filter() -> String {
    "weak".into()
}
fn default_block() -> u32 {
    8
}
fn default_deband_range() -> u32 {
    16
}
fn default_spp() -> u32 {
    4
}
fn default_uspp() -> u32 {
    3
}
fn default_lp_iterations() -> u32 {
    3
}
fn default_lp_threshold() -> f32 {
    6.0
}
fn default_lp_radius() -> u32 {
    24
}
fn default_lp_grain() -> f32 {
    6.0
}
fn default_cas() -> f32 {
    0.4
}
fn default_denoise() -> f32 {
    3.0
}
fn default_presmooth() -> f32 {
    0.6
}

/// Build the ffmpeg `-vf` chain from preclean options, or None if nothing is
/// active. A non-empty `raw` short-circuits and is used verbatim.
fn build_preclean_vf(o: &PrecleanOpts) -> Option<String> {
    if let Some(raw) = o.raw.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return Some(raw.to_string());
    }
    let mut parts: Vec<String> = Vec::new();
    // Deblock stage: ultra DCT (uspp, strongest+slowest), strong DCT (spp),
    // and/or the weak `deblock` filter. Heaviest first.
    if o.uspp {
        parts.push(format!("uspp={}", o.uspp_strength.clamp(0, 8)));
    }
    if o.spp {
        parts.push(format!("spp={}", o.spp_strength.clamp(0, 6)));
    }
    if o.deblock {
        let filt = if o.deblock_filter == "strong" { "strong" } else { "weak" };
        parts.push(format!(
            "deblock=filter={filt}:block={}:alpha={:.4}:beta={:.4}:gamma={:.4}:delta={:.4}",
            o.block.clamp(4, 32),
            o.alpha,
            o.beta,
            o.gamma,
            o.delta,
        ));
    }
    // Edge-preserving GPU denoise (Vulkan nlmeans), after deblock — cleans
    // mosquito around lines. Self-contained hwupload/hwdownload island so it
    // slots between the software filters; far faster than CPU nlmeans.
    if o.denoise {
        parts.push(format!(
            "format=yuv420p,hwupload,nlmeans_vulkan=s={:.2},hwdownload,format=yuv420p",
            o.denoise_strength.max(0.0)
        ));
    }
    // Deband stage: ffmpeg `deband` and/or GPU `libplacebo` deband+dither.
    if o.deband {
        let t = o.deband_thr;
        let blur = if o.deband_blur { "true" } else { "false" };
        let coup = if o.deband_coupling { "true" } else { "false" };
        parts.push(format!(
            "deband=1thr={t:.4}:2thr={t:.4}:3thr={t:.4}:range={}:blur={blur}:coupling={coup}",
            o.deband_range.clamp(1, 64),
        ));
    }
    if o.libplacebo {
        parts.push(format!(
            "libplacebo=deband=1:deband_iterations={}:deband_threshold={:.2}:deband_radius={}:deband_grain={:.2}",
            o.lp_iterations.clamp(1, 8),
            o.lp_threshold,
            o.lp_radius.clamp(1, 64),
            o.lp_grain,
        ));
    }
    // Sharpen (aesthetic finish for post-clean).
    if o.cas {
        parts.push(format!("cas={:.3}", o.cas_strength.clamp(0.0, 1.0)));
    }
    // Pre-smooth truly last — a tiny gaussian so VSR sees ramps, not staircases.
    if o.presmooth {
        parts.push(format!("gblur=sigma={:.2}", o.presmooth_sigma.max(0.0)));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(","))
    }
}

/// libplacebo and nlmeans_vulkan are Vulkan filters, so any ffmpeg invocation
/// whose chain uses one must init a Vulkan device first. Insert
/// `-init_hw_device vulkan` before the first `-i` when the args reference
/// `libplacebo` or any `*_vulkan` filter (or the `hwupload` around them).
fn add_vulkan_if_needed(args: &mut Vec<String>) {
    if args.iter().any(|a| a.contains("libplacebo") || a.contains("vulkan")) {
        if let Some(i) = args.iter().position(|a| a == "-i") {
            args.insert(i, "vulkan".into());
            args.insert(i, "-init_hw_device".into());
        }
    }
}

/// Re-encode `input` → `output` applying an ffmpeg `-vf` chain. HEVC for final
/// deliverables (matches the worker's output codec); H.264 (fast) for preview
/// slices. Audio is dropped.
async fn filter_encode(
    app: &AppHandle,
    input: &str,
    output: &str,
    vf: &str,
    hevc: bool,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-i".into(), input.into(),
        "-vf".into(), vf.into(),
    ];
    if hevc {
        args.extend(["-c:v", "libx265", "-crf", "18", "-preset", "medium", "-tag:v", "hvc1"].map(String::from));
    } else {
        args.extend(["-c:v", "libx264", "-crf", "12", "-preset", "veryfast"].map(String::from));
    }
    args.extend(["-pix_fmt", "yuv420p", "-an"].map(String::from));
    args.push(output.into());
    add_vulkan_if_needed(&mut args);
    let res = crate::tools::ffmpeg_command(app)?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("filter encode spawn: {e}"))?;
    if !res.status.success() {
        return Err(format!(
            "filter pass failed: {}",
            String::from_utf8_lossy(&res.stderr)
        ));
    }
    Ok(())
}

/// Mux the audio track from `audio_src` into the (audio-less) `video` file, in
/// place. The NVDEC worker and every ffmpeg filter pass are video-only (`-an`),
/// so final deliverables get the original soundtrack copied back here. Uses an
/// optional audio map (`1:a:0?`) so silent sources still succeed, and
/// `-shortest` to absorb the 1–2 tail frames the pipeline can drop.
async fn mux_audio(
    app: &AppHandle,
    video: &std::path::Path,
    audio_src: &str,
) -> Result<(), String> {
    let video_str = video.to_str().ok_or("video path not UTF-8")?.to_string();
    let tmp = video.with_extension("mux.mp4");
    let tmp_str = tmp.to_str().ok_or("mux path not UTF-8")?.to_string();
    let args: Vec<String> = vec![
        "-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-i".into(), video_str,
        "-i".into(), audio_src.to_string(),
        "-map".into(), "0:v:0".into(),
        "-map".into(), "1:a:0?".into(),
        "-c:v".into(), "copy".into(),
        "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(),
        "-shortest".into(),
        tmp_str,
    ];
    let res = crate::tools::ffmpeg_command(app)?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("audio mux spawn: {e}"))?;
    if !res.status.success() || !tmp.is_file() {
        return Err(format!(
            "audio mux failed: {}",
            String::from_utf8_lossy(&res.stderr)
        ));
    }
    std::fs::remove_file(video).map_err(|e| format!("mux replace (rm): {e}"))?;
    std::fs::rename(&tmp, video).map_err(|e| format!("mux replace (rename): {e}"))?;
    Ok(())
}

/// Shared worker driver: spawn RTXVideoProcessor on `input`, stream its
/// stderr bar as `rtx:progress` (keyed on `event_key`), and land an enhanced
/// file at `out`. Our forked worker takes `--vsr-scale` natively: 1 = decompress
/// only (same resolution, pure VSR artifact cleanup), 2 = 2×, 4 = 4×. An optional
/// `preclean` pass runs an ffmpeg deblock/deband chain into a temp H.264
/// intermediate first (see `PrecleanOpts`). When `keep_audio` is set, the
/// original `input`'s soundtrack is muxed back into the final output (previews
/// pass false — they're silent throwaways). Returns `Err("__rtx_canceled__")`
/// if the user cancels mid-run (partial cleaned up).
#[allow(clippy::too_many_arguments)]
async fn run_worker(
    app: &AppHandle,
    registry: &State<'_, crate::JobRegistry>,
    worker: &std::path::Path,
    input: &str,
    out: &std::path::Path,
    hdr: bool,
    quality: u8,
    scale: u8,
    // 1.14.0 — run the VSR network at all. False sends `--no-vsr`, which
    // leaves the frame at its input resolution and does no upscaling: the
    // only way to see what the CodecClean filter does BY ITSELF, since the
    // filter lives inside this same worker and skipping the worker skips
    // the filter too.
    vsr: bool,
    // CodecClean strength, `None` = filter off. `Some(0.0)` is a valid
    // request meaning "exact bypass" and is NOT the same as off: the user
    // asked for the filter, so the blob must still load.
    cc: Option<f32>,
    // Output quality preset (`--quality`).
    enc_preset: EncPreset,
    preclean: Option<PrecleanOpts>,
    postclean: Option<PrecleanOpts>,
    keep_audio: bool,
    event_key: &str,
    job_id: &str,
) -> Result<(), String> {
    let q = quality.clamp(1, 4);
    let s = scale.clamp(1, 4);
    // Our forked worker writes the final output directly at any scale via
    // --vsr-scale (1 = decompress only / same res, 2 = 2×, 4 = 4×). No temp
    // file or ffmpeg downscale pass needed anymore.
    let worker_out = out.to_path_buf();
    let worker_out_str = worker_out
        .to_str()
        .ok_or("output path is not valid UTF-8")?
        .to_string();

    // Optional pre-clean: run the deblock/deband chain into a temp H.264 file
    // and feed THAT to the worker instead of the original. Audio is dropped
    // (the intermediate only feeds the GPU decoder). The temp is deleted once
    // the worker has consumed it, below.
    let mut worker_input = input.to_string();
    let mut preclean_tmp: Option<std::path::PathBuf> = None;
    if let Some(pc) = preclean.as_ref().filter(|p| p.enabled) {
        if let Some(vf) = build_preclean_vf(pc) {
            let dir = std::env::temp_dir().join("mh-rtx-preclean");
            std::fs::create_dir_all(&dir).map_err(|e| format!("create preclean dir: {e}"))?;
            purge_old_previews(&dir);
            let tmp = dir.join(format!("{job_id}_preclean.mp4"));
            let tmp_str = tmp.to_str().ok_or("preclean path not UTF-8")?.to_string();
            diag::log(app, "rtx", &format!("preclean key={event_key} vf=[{vf}] -> {tmp_str}"));
            let mut ff_args: Vec<String> = vec![
                "-y".into(),
                "-hide_banner".into(),
                "-loglevel".into(),
                "error".into(),
                "-i".into(),
                input.to_string(),
                "-vf".into(),
                vf,
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "12".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-an".into(),
                tmp_str.clone(),
            ];
            add_vulkan_if_needed(&mut ff_args);
            let fcmd = crate::tools::ffmpeg_command(app)?;
            let res = fcmd
                .args(ff_args)
                .output()
                .await
                .map_err(|e| format!("preclean spawn: {e}"))?;
            if !res.status.success() || !tmp.is_file() {
                let tail = String::from_utf8_lossy(&res.stderr);
                return Err(format!("Pre-clean pass failed: {tail}"));
            }
            worker_input = tmp_str;
            preclean_tmp = Some(tmp);
        }
    }

    // ---- CodecClean pre-flight -------------------------------------
    // Everything knowable before spawning is checked here, so a doomed job
    // dies with a sentence instead of a worker abort.
    let mut cc_blob: Option<String> = None;
    let mut cc_k: Option<f32> = None;
    let mut in_pix: Option<String> = None;
    if let Some(k) = cc {
        // `atof` in the worker never fails — a malformed strength silently
        // becomes 0.0, an exact bypass. Clamping here means the number the
        // user sees is the number applied.
        cc_k = Some(k.clamp(0.0, 1.0));
        let blob = cc_blob_path(app).ok_or(
            "The compression filter needs its weights file, which isn't installed.              Open Settings and update the enhancer.",
        )?;
        cc_blob = Some(blob.to_string_lossy().to_string());

        // The filter is 8-bit and the worker refuses 10-bit rather than
        // bypassing. Checked against the file the worker will ACTUALLY
        // open: when pre-clean ran, that's its intermediate, already
        // yuv420p — so a 10-bit source must not be blocked there.
        let pix = probe_pix_fmt(app, &worker_input).await;
        if let Some(px) = pix.as_deref() {
            if pix_fmt_is_high_bit(px) {
                return Err(format!(
                    "The compression filter is 8-bit, and this clip is {px} (10-bit).                      Turn the filter off, or enable pre-clean — it converts to 8-bit first."
                ));
            }
        }
        in_pix = pix;
    }

    let mut args: Vec<String> = vec![worker_input.clone(), worker_out_str.clone(), "-v".into()];
    args.push("--vsr-quality".into());
    args.push(q.to_string());
    if vsr {
        args.push("--vsr-scale".into());
        args.push(s.to_string());
    } else {
        // Scale is meaningless without the network, and passing both
        // invites the worker to disagree with itself.
        args.push("--no-vsr".into());
    }
    // 1.15.0 — TrueHDR is off, always, and this is the single line that
    // enforces it. Not a quality call: `nvngx_truehdr.dll` is a second piece
    // of NVIDIA's proprietary runtime, and dropping the feature drops the DLL
    // (verified 2026-08-20 — the worker runs fine with `--no-thdr` and no
    // truehdr DLL on disk). The `hdr` plumbing is deliberately left intact so
    // this stays a one-line decision, but bringing it back means recutting
    // the bundle AND covering truehdr in the NVIDIA notification. See
    // docs/SHIPPING_LEGAL.md before you touch it.
    let _ = hdr;
    args.push("--no-thdr".into());
    // Flag and value always pushed together: `--cc-blob` left as the final
    // token access-violates the worker.
    if let (Some(blob), Some(k)) = (cc_blob.as_ref(), cc_k) {
        args.push("--cc-blob".into());
        args.push(blob.clone());
        args.push("--cc-strength".into());
        args.push(format!("{k:.2}"));
    }
    args.push("--quality".into());
    args.push(enc_preset.as_str().into());
    let cc_desc = cc_k.map(|k| format!("{k:.2}")).unwrap_or_else(|| "off".into());
    let pix_desc = in_pix.clone().unwrap_or_else(|| "?".into());
    diag::log(
        app,
        "rtx",
        &format!(
            "worker key={event_key} q={q} hdr={hdr} vsr={vsr} scale={}x preset={} cc={cc_desc} pix={pix_desc} -> {worker_out_str}",
            if vsr { s.to_string() } else { "1 (no-vsr)".to_string() },
            enc_preset.as_str()
        ),
    );

    let (mut rx, child) = app
        .shell()
        .command(worker.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| format!("RTX worker spawn: {e}"))?;

    // Register the child so `rtx_enhance_cancel(job_id)` can kill it.
    if let Ok(mut map) = registry.children.lock() {
        map.insert(job_id.to_string(), child);
    }

    // The worker prints its progress bar to stderr, `\r`-updated. Split every
    // chunk on \r/\n and try to parse each segment; keep non-progress lines as
    // an error tail.
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;
    // The worker announces `CodecClean ON` (at -v, which we always pass) the
    // moment it arms the filter. We watch for it because the filter can be
    // dropped WITHOUT an error: if hardware decode fails to initialize, the
    // worker falls back to a CPU path where the filter doesn't exist. Newer
    // workers refuse outright; a user still on an older bundle would
    // otherwise get an unfiltered file marked "done".
    let mut saw_cc_on = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for seg in text.split(['\r', '\n']) {
                    let seg = seg.trim();
                    if seg.is_empty() {
                        continue;
                    }
                    if seg.contains("CodecClean ON") {
                        saw_cc_on = true;
                    }
                    if let Some(p) = parse_progress(seg) {
                        let _ = app.emit(
                            "rtx:progress",
                            EnhanceEvent {
                                asset_id: event_key.to_string(),
                                percent: p.percent,
                                frame: p.frame,
                                total: p.total,
                                fps: p.fps,
                                eta: p.eta,
                            },
                        );
                    } else {
                        stderr_tail.push(seg.to_string());
                        if stderr_tail.len() > 40 {
                            stderr_tail.remove(0);
                        }
                    }
                }
            }
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            _ => {}
        }
    }

    // The preclean intermediate has been fully consumed by the worker; drop it.
    if let Some(tmp) = preclean_tmp.as_ref() {
        let _ = std::fs::remove_file(tmp);
    }

    // Deregister the (finished or killed) child. Then check cancel — a killed
    // process exits non-zero, so this must come BEFORE the failure branch to
    // tell cancel apart from a real crash.
    let _ = registry.children.lock().map(|mut m| m.remove(job_id));
    let was_canceled = registry
        .canceled
        .lock()
        .map(|mut s| s.remove(job_id))
        .unwrap_or(false);
    if was_canceled {
        let _ = std::fs::remove_file(&worker_out);
        let _ = std::fs::remove_file(out);
        return Err("__rtx_canceled__".into());
    }

    if exit_code != Some(0) || !worker_out.is_file() {
        diag::log(
            app,
            "rtx",
            &format!(
                "worker FAILED exit={:?} key={event_key}\n{}",
                exit_code,
                stderr_tail.join("\n")
            ),
        );
        // The worker creates the output container before it can fail,
        // leaving a few dozen bytes of unplayable file behind. The cancel
        // path above already cleaned up; this one did not.
        let _ = std::fs::remove_file(&worker_out);
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no output)".into());
        return Err(format!(
            "RTX enhance failed: {tail} — details in Settings → Diagnostics."
        ));
    }

    // The filter was requested but the worker never announced arming it.
    //
    // This is the defence against a silent drop: `--cc-blob` is simply
    // IGNORED on the worker's CPU path, which it falls back to whenever the
    // hardware decoder fails to initialize — no error, no warning, and an
    // unfiltered file that looks finished. Workers from 888255f on refuse
    // loudly, but a user whose bundle predates that would otherwise be told
    // the job succeeded. Failing here costs a re-run; not failing ships a
    // file that isn't what was asked for.
    if cc.is_some() && !saw_cc_on {
        let _ = std::fs::remove_file(&worker_out);
        diag::log(
            app,
            "rtx",
            &format!("worker never armed CodecClean key={event_key} — refusing the output"),
        );
        return Err(
            "The compression filter was requested but the enhancer never applied it              (its GPU decode path didn't start). Update the enhancer in Settings, or              turn the filter off."
                .into(),
        );
    }

    // Optional post-clean: filter chain applied to the VSR output (at the
    // upscaled resolution), for the artifacts VSR leaves in flat areas. Kept
    // HEVC to match the worker's codec; replaces the worker output in place.
    if let Some(pc) = postclean.as_ref().filter(|p| p.enabled) {
        if let Some(vf) = build_preclean_vf(pc) {
            let post_tmp = worker_out.with_extension("post.mp4");
            let post_str = post_tmp.to_str().ok_or("post path not UTF-8")?.to_string();
            diag::log(app, "rtx", &format!("postclean key={event_key} vf=[{vf}]"));
            filter_encode(app, &worker_out_str, &post_str, &vf, true).await?;
            let _ = std::fs::remove_file(&worker_out);
            std::fs::rename(&post_tmp, &worker_out)
                .map_err(|e| format!("postclean replace: {e}"))?;
        }
    }

    // Restore the original soundtrack — the worker and every filter pass are
    // video-only. Previews pass keep_audio=false (silent throwaways).
    if keep_audio {
        mux_audio(app, &worker_out, input).await?;
    }

    Ok(())
}

/// Output filename suffix for a given scale: 2× upscale vs 1× decompress-only.
/// Output quality preset the worker understands (`--quality`).
///
/// A closed enum on purpose: the worker validates this string and `exit(1)`s
/// on anything unknown, so a free-form value from the frontend would turn a
/// typo into a dead job. Unknown input falls back to the shipped default
/// instead of failing.
///
/// Measured on a 60 s clip: lossless 1.9 GB, master 190 MB, entrega 94 MB,
/// previa 18 MB — and encode TIME is flat from qp 12 to 30, so the choice
/// costs size, not speed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EncPreset {
    Lossless,
    Master,
    Entrega,
    Previa,
}

impl EncPreset {
    fn as_str(self) -> &'static str {
        match self {
            EncPreset::Lossless => "lossless",
            EncPreset::Master => "master",
            EncPreset::Entrega => "entrega",
            EncPreset::Previa => "previa",
        }
    }

    /// Parse a frontend string. Anything unrecognized becomes the default
    /// rather than an error the user can't act on.
    fn from_str(s: &str) -> EncPreset {
        match s.trim().to_ascii_lowercase().as_str() {
            "lossless" => EncPreset::Lossless,
            "master" => EncPreset::Master,
            "previa" | "prévia" => EncPreset::Previa,
            _ => EncPreset::Entrega,
        }
    }
}

/// First free `<stem><suffix>.mp4` in `parent`, adding " (2)", " (3)"… when
/// the plain name is taken.
///
/// 1.14.0 — the output path used to be a pure function of the source name
/// and the scale, so enhancing the same clip twice wrote over the first
/// result. That is worse than losing a file: run 1 leaves a library row
/// pointing at that path, so after run 2 the old row silently describes a
/// render it did not produce — two rows, one file, one of them lying.
/// (Same shape as the filename collision that swallowed a download earlier
/// in 1.13.5, which is what made this one recognizable.)
///
/// Checking existence then creating is a race in principle. In practice the
/// enhance queue runs one job at a time, and the worker creates the file
/// within milliseconds of this call; the 999 cap keeps a pathological
/// directory from spinning forever.
fn unique_out_path(parent: &std::path::Path, stem: &str, suffix: &str) -> std::path::PathBuf {
    let first = parent.join(format!("{stem}{suffix}.mp4"));
    if !first.exists() {
        return first;
    }
    for n in 2..=999 {
        let candidate = parent.join(format!("{stem}{suffix} ({n}).mp4"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Every name taken: fall back to the plain one rather than refusing to
    // render. Overwriting after 998 collisions is a deliberate last resort.
    first
}

fn out_suffix(scale: u8) -> &'static str {
    if scale <= 1 {
        "_rtx-clean"
    } else {
        "_rtx-vsr"
    }
}

/// Run RTX Video Super Resolution on a library clip and register the result as
/// a sibling (same `source_url`). `scale` = 2 (upscale) or 1 (decompress only,
/// same resolution). The original is untouched. Progress streams as
/// `rtx:progress`; completion as `rtx:done`.
#[tauri::command]
pub async fn rtx_enhance(
    app: AppHandle,
    state: State<'_, LibraryState>,
    registry: State<'_, crate::JobRegistry>,
    asset_id: String,
    hdr: bool,
    quality: u8,
    scale: u8,
    // 1.14.0 — CodecClean compression filter. Off by default; strength
    // 0.00-1.00 (1.00 is the tuned dose, 0.00 an exact bypass).
    cc_enabled: bool,
    cc_strength: f32,
    // Output quality preset: lossless | master | entrega | previa.
    enc_preset: String,
    preclean: Option<PrecleanOpts>,
    postclean: Option<PrecleanOpts>,
    job_id: String,
) -> Result<String, String> {
    // 0. Gate on hardware + worker presence.
    let cap = detect();
    if !cap.supported {
        return Err(cap
            .reason
            .unwrap_or_else(|| "RTX upscale isn't supported on this machine.".into()));
    }
    let worker = worker_path(&app).ok_or("The RTX enhancer isn't installed yet.")?;

    // 1. Load the original asset.
    let orig = sqlx::query_as::<_, OrigAsset>(
        r#"SELECT source_url, platform, video_id, channel, title, duration_sec,
                  file_path, project_id, width, height, fps, thumbnail_url, kind
           FROM assets WHERE id = ?"#,
    )
    .bind(&asset_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("rtx_enhance load asset: {e}"))?
    .ok_or("asset not found")?;

    let src = std::path::PathBuf::from(&orig.file_path);
    if !src.is_file() {
        return Err(format!("source file is missing: {}", orig.file_path));
    }

    // 2. Output next to the source. Scale (1/2) drives the filename suffix so
    //    a decompress pass and an upscale pass on the same clip don't collide.
    //    VSR can't upscale 4K+ (it skips ≥1440p), so force 1× (clean-only)
    //    there — the ffmpeg cleanup + filter chain still runs.
    let mut scale = if scale <= 1 { 1u8 } else { 2u8 };
    if orig.height.unwrap_or(0) >= 2160 {
        scale = 1;
    }
    let parent = src.parent().ok_or("source has no parent dir")?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("source path is not valid UTF-8")?;
    let out_path = unique_out_path(parent, stem, out_suffix(scale));
    let out_str = out_path
        .to_str()
        .ok_or("output path is not valid UTF-8")?
        .to_string();

    // 3. Run the worker (optional pre-clean, then VSR at the chosen scale).
    //    keep_audio → mux the original soundtrack back onto the final output.
    run_worker(
        &app, &registry, &worker, &orig.file_path, &out_path, hdr, quality, scale, true,
        if cc_enabled { Some(cc_strength) } else { None }, EncPreset::from_str(&enc_preset), preclean,
        postclean, true, &asset_id, &job_id,
    )
    .await?;

    // 4. Register the enhanced file as a SIBLING (same source_url → the library
    //    groups it automatically). 2× upscale doubles the dims; 1× decompress
    //    keeps them. The worker emits HEVC; the decompress downscale is x264.
    let file_size = std::fs::metadata(&out_path).ok().map(|m| m.len() as i64);
    let input = AssetInput {
        source_url: orig.source_url,
        platform: orig.platform,
        video_id: orig.video_id,
        channel: orig.channel,
        title: if scale == 1 {
            format!("{} · RTX clean", orig.title)
        } else {
            format!("{} · RTX", orig.title)
        },
        duration_sec: orig.duration_sec,
        in_sec: None,
        out_sec: None,
        file_path: out_str,
        file_size,
        container: Some("mp4".into()),
        codec_video: Some("hevc".into()),
        codec_audio: Some("aac".into()),
        width: orig.width.map(|w| w * scale as i64),
        height: orig.height.map(|h| h * scale as i64),
        fps: orig.fps,
        // Marker so the UI can badge RTX-enhanced siblings.
        transcoded_to: Some("rtx-vsr".into()),
        thumbnail_url: orig.thumbnail_url,
        project_id: orig.project_id,
        kind: orig.kind.or_else(|| Some("video".into())),
    };
    let new_id = crate::library::library_insert(app.clone(), state, input).await?;

    let _ = app.emit(
        "rtx:done",
        EnhanceDone {
            asset_id,
            new_id: new_id.clone(),
        },
    );
    Ok(new_id)
}

/// Enhance an arbitrary file by PATH (drag-in from the enhance window — an
/// external file, or a clip dragged out of the library). Unlike `rtx_enhance`
/// there's no library row to clone, so we probe dimensions with ffmpeg and
/// register the result as a fresh Library asset. `event_key`/`job_id` are the
/// same value (the frontend keys progress on the job id for path jobs).
#[tauri::command]
pub async fn rtx_enhance_path(
    app: AppHandle,
    state: State<'_, LibraryState>,
    registry: State<'_, crate::JobRegistry>,
    path: String,
    hdr: bool,
    quality: u8,
    scale: u8,
    // 1.14.0 — CodecClean compression filter. Off by default; strength
    // 0.00-1.00 (1.00 is the tuned dose, 0.00 an exact bypass).
    cc_enabled: bool,
    cc_strength: f32,
    // Output quality preset: lossless | master | entrega | previa.
    enc_preset: String,
    preclean: Option<PrecleanOpts>,
    postclean: Option<PrecleanOpts>,
    job_id: String,
    title: Option<String>,
) -> Result<String, String> {
    let cap = detect();
    if !cap.supported {
        return Err(cap
            .reason
            .unwrap_or_else(|| "RTX upscale isn't supported on this machine.".into()));
    }
    let worker = worker_path(&app).ok_or("The RTX enhancer isn't installed yet.")?;

    let src = std::path::PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("file not found: {path}"));
    }

    // Best-effort probe: size the sibling. If ffmpeg can't read it we let the
    // worker try (it self-skips clips it can't enhance).
    let dims = probe_dimensions(&app, &path).await;

    // VSR can't upscale 4K+ (skips ≥1440p) → force 1× (clean-only) there so the
    // ffmpeg cleanup + filter chain still runs.
    let mut scale = if scale <= 1 { 1u8 } else { 2u8 };
    if dims.map(|(_, h)| h >= 2160).unwrap_or(false) {
        scale = 1;
    }
    let parent = src.parent().ok_or("source has no parent dir")?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("source path is not valid UTF-8")?;
    let out_path = unique_out_path(parent, stem, out_suffix(scale));
    let out_str = out_path
        .to_str()
        .ok_or("output path is not valid UTF-8")?
        .to_string();

    run_worker(
        &app, &registry, &worker, &path, &out_path, hdr, quality, scale, true,
        if cc_enabled { Some(cc_strength) } else { None }, EncPreset::from_str(&enc_preset), preclean, postclean,
        true, &job_id, &job_id,
    )
    .await?;

    let file_size = std::fs::metadata(&out_path).ok().map(|m| m.len() as i64);
    let (w, h) = dims.unwrap_or((0, 0));
    let base_title = title.unwrap_or_else(|| stem.to_string());
    let input = AssetInput {
        // source_url = the input path → unique per file, so re-enhancing the
        // same file groups its variants as siblings.
        source_url: path.clone(),
        platform: "local".into(),
        video_id: None,
        channel: None,
        title: if scale == 1 {
            format!("{base_title} · RTX clean")
        } else {
            format!("{base_title} · RTX")
        },
        duration_sec: None,
        in_sec: None,
        out_sec: None,
        file_path: out_str,
        file_size,
        container: Some("mp4".into()),
        codec_video: Some("hevc".into()),
        codec_audio: Some("aac".into()),
        width: if w > 0 { Some(w * scale as i64) } else { None },
        height: if h > 0 { Some(h * scale as i64) } else { None },
        fps: None,
        transcoded_to: Some("rtx-vsr".into()),
        thumbnail_url: None,
        project_id: None,
        kind: Some("video".into()),
    };
    let new_id = crate::library::library_insert(app.clone(), state, input).await?;
    let _ = app.emit(
        "rtx:done",
        EnhanceDone {
            asset_id: job_id.clone(),
            new_id: new_id.clone(),
        },
    );
    Ok(new_id)
}

/// A rendered preview: paths to a short original snippet and its enhanced
/// counterpart, for the window's before/after preview (both loadable via the
/// asset protocol — scope is `**`).
#[derive(Serialize, Clone)]
pub struct PreviewOut {
    pub before: String,
    pub after: String,
}

/// Render a SHORT preview (~1.5s) of a clip at `start_sec` with the given
/// settings, so the user can judge the result before committing the whole
/// clip. Extracts a snippet with ffmpeg, runs it through the real worker, and
/// returns both paths (written to the OS temp dir). Fast because it's a tiny
/// slice — a second or two on a modern RTX.
#[tauri::command]
pub async fn rtx_preview(
    app: AppHandle,
    registry: State<'_, crate::JobRegistry>,
    path: String,
    start_sec: f64,
    quality: u8,
    scale: u8,
    hdr: bool,
    preclean: Option<PrecleanOpts>,
    preview_id: String,
) -> Result<PreviewOut, String> {
    let cap = detect();
    if !cap.supported {
        return Err(cap
            .reason
            .unwrap_or_else(|| "RTX upscale isn't supported on this machine.".into()));
    }
    let worker = worker_path(&app).ok_or("The RTX enhancer isn't installed yet.")?;
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("file not found: {path}"));
    }

    let dir = std::env::temp_dir().join("mh-rtx-preview");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create preview dir: {e}"))?;
    // Self-manage the temp dir: drop preview snippets older than 2h (including
    // any left behind by earlier sessions) so it can never grow unbounded.
    purge_old_previews(&dir);
    let before = dir.join(format!("{preview_id}_before.mp4"));
    let after = dir.join(format!("{preview_id}_after.mp4"));
    let before_str = before.to_str().ok_or("preview path not UTF-8")?.to_string();
    let after_str = after.to_str().ok_or("preview path not UTF-8")?.to_string();

    // 1. Extract a clean ~1.5s snippet at the requested position (fast seek,
    //    re-encoded so the worker gets a well-formed clip; audio dropped).
    let ss = format!("{:.3}", start_sec.max(0.0));
    let ff_args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        ss,
        "-i".into(),
        path.clone(),
        "-t".into(),
        "1.5".into(),
        "-an".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "12".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        before_str.clone(),
    ];
    let fcmd = crate::tools::ffmpeg_command(&app)?;
    let res = fcmd
        .args(ff_args)
        .output()
        .await
        .map_err(|e| format!("preview snippet spawn: {e}"))?;
    if !res.status.success() || !before.is_file() {
        let tail = String::from_utf8_lossy(&res.stderr);
        return Err(format!("preview snippet failed: {tail}"));
    }

    // 2. Run the snippet through the real worker (same path as a full job, so
    //    the preview reflects the pre-clean too).
    let scale = if scale <= 1 { 1u8 } else { 2u8 };
    run_worker(
        &app, &registry, &worker, &before_str, &after, hdr, quality, scale, true,
        // TODO: rtx_preview has no caller; filter stays off until it does.
        None, EncPreset::Entrega, preclean, None,
        false, &preview_id, &preview_id,
    )
    .await?;

    Ok(PreviewOut {
        before: before_str,
        after: after_str,
    })
}

// ---------------------------------------------------------------------------
// Live single-frame preview (fast cleanup-tuning). The window extracts a short
// raw slice ONCE, re-applies the ffmpeg cleanup chain on every settings change
// (cheap, no GPU), and only runs VSR when the user toggles it on for that
// frame. All slices live in the shared `mh-rtx-preview` temp dir (2h purge).
// ---------------------------------------------------------------------------

/// Shared temp dir for preview slices, created + purged of >2h leftovers.
fn preview_dir() -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("mh-rtx-preview");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create preview dir: {e}"))?;
    purge_old_previews(&dir);
    Ok(dir)
}

/// Extract a ~1.5s raw slice at `start_sec` (H.264, audio dropped) as the
/// stable "before" for a preview session. Cheap; called once per chosen frame.
#[tauri::command]
pub async fn rtx_slice_extract(
    app: AppHandle,
    path: String,
    start_sec: f64,
    key: String,
) -> Result<String, String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("file not found: {path}"));
    }
    let dir = preview_dir()?;
    let before = dir.join(format!("{key}_raw.mp4"));
    let before_str = before.to_str().ok_or("preview path not UTF-8")?.to_string();
    let ss = format!("{:.3}", start_sec.max(0.0));
    let ff_args: Vec<String> = vec![
        "-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-ss".into(), ss, "-i".into(), path,
        "-t".into(), "1.5".into(), "-an".into(),
        "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into(),
        "-crf".into(), "12".into(), "-pix_fmt".into(), "yuv420p".into(),
        before_str.clone(),
    ];
    let res = crate::tools::ffmpeg_command(&app)?
        .args(ff_args)
        .output()
        .await
        .map_err(|e| format!("slice extract spawn: {e}"))?;
    if !res.status.success() || !before.is_file() {
        return Err(format!(
            "slice extract failed: {}",
            String::from_utf8_lossy(&res.stderr)
        ));
    }
    Ok(before_str)
}

/// Apply the cleanup chain to a raw slice → cleaned slice. Returns the raw
/// path unchanged when the chain is empty/disabled (nothing to clean). Fast
/// enough to run live as the user drags sliders.
#[tauri::command]
pub async fn rtx_slice_filter(
    app: AppHandle,
    before: String,
    preclean: Option<PrecleanOpts>,
    key: String,
) -> Result<String, String> {
    let vf = preclean
        .as_ref()
        .filter(|p| p.enabled)
        .and_then(build_preclean_vf);
    let Some(vf) = vf else {
        return Ok(before);
    };
    if !std::path::Path::new(&before).is_file() {
        return Err("raw slice missing — pick the frame again".into());
    }
    let dir = preview_dir()?;
    let cleaned = dir.join(format!("{key}_clean.mp4"));
    let cleaned_str = cleaned.to_str().ok_or("preview path not UTF-8")?.to_string();
    let mut ff_args: Vec<String> = vec![
        "-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-i".into(), before,
        "-vf".into(), vf,
        "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into(),
        "-crf".into(), "12".into(), "-pix_fmt".into(), "yuv420p".into(),
        "-an".into(),
        cleaned_str.clone(),
    ];
    add_vulkan_if_needed(&mut ff_args);
    let res = crate::tools::ffmpeg_command(&app)?
        .args(ff_args)
        .output()
        .await
        .map_err(|e| format!("slice filter spawn: {e}"))?;
    if !res.status.success() || !cleaned.is_file() {
        return Err(format!(
            "slice filter failed: {}",
            String::from_utf8_lossy(&res.stderr)
        ));
    }
    Ok(cleaned_str)
}

/// Run VSR on an (already-cleaned) slice → the "after" clip. The heavy one;
/// only called when the user toggles VSR on for the previewed frame. Preclean
/// is already baked into `cleaned`, so the worker runs with no extra chain.
#[tauri::command]
pub async fn rtx_slice_vsr(
    app: AppHandle,
    registry: State<'_, crate::JobRegistry>,
    cleaned: String,
    quality: u8,
    scale: u8,
    hdr: bool,
    // 1.14.0 — run VSR? False isolates the CodecClean filter, which is the
    // only way to see what each stage contributes on its own.
    vsr: bool,
    // 1.14.0 — CodecClean compression filter. Off by default; strength
    // 0.00-1.00 (1.00 is the tuned dose, 0.00 an exact bypass).
    cc_enabled: bool,
    cc_strength: f32,
    // Output quality preset: lossless | master | entrega | previa.
    enc_preset: String,
    key: String,
) -> Result<String, String> {
    let cap = detect();
    if !cap.supported {
        return Err(cap
            .reason
            .unwrap_or_else(|| "RTX upscale isn't supported on this machine.".into()));
    }
    let worker = worker_path(&app).ok_or("The RTX enhancer isn't installed yet.")?;
    if !std::path::Path::new(&cleaned).is_file() {
        return Err("cleaned slice missing — pick the frame again".into());
    }
    let dir = preview_dir()?;
    let after = dir.join(format!("{key}_vsr.mp4"));
    let after_str = after.to_str().ok_or("preview path not UTF-8")?.to_string();
    // Raw VSR only (no post-clean) — the frontend caches this and re-applies
    // post-clean separately via rtx_slice_post, so tuning post doesn't re-run VSR.
    run_worker(
        &app, &registry, &worker, &cleaned, &after, hdr, quality, scale, vsr,
        if cc_enabled { Some(cc_strength) } else { None }, EncPreset::from_str(&enc_preset), None, None, false, &key,
        &key,
    )
    .await?;
    Ok(after_str)
}

/// Apply the post-clean chain to a (cached) VSR slice → final. Fast H.264 for the
/// preview; returns the VSR path unchanged when post-clean is empty/disabled.
/// This is the cheap step re-run on every post-clean tweak (VSR is reused).
#[tauri::command]
pub async fn rtx_slice_post(
    app: AppHandle,
    vsr: String,
    postclean: Option<PrecleanOpts>,
    key: String,
) -> Result<String, String> {
    let vf = postclean
        .as_ref()
        .filter(|p| p.enabled)
        .and_then(build_preclean_vf);
    let Some(vf) = vf else {
        return Ok(vsr);
    };
    if !std::path::Path::new(&vsr).is_file() {
        return Err("VSR slice missing — toggle VSR again".into());
    }
    let dir = preview_dir()?;
    let post = dir.join(format!("{key}_vsrpost.mp4"));
    let post_str = post.to_str().ok_or("preview path not UTF-8")?.to_string();
    filter_encode(&app, &vsr, &post_str, &vf, false).await?;
    Ok(post_str)
}

/// Difference map: where VSR changed the frame. Upscales the raw slice to the
/// VSR output's size, blends the two in `difference` mode, and boosts contrast
/// so subtle edge work lights up — VSR's active territory vs. the flat areas
/// it ignores (where post-clean should do the work). Returns the map clip.
#[tauri::command]
pub async fn rtx_slice_diff(
    app: AppHandle,
    before: String,
    after: String,
    key: String,
) -> Result<String, String> {
    if !std::path::Path::new(&before).is_file() || !std::path::Path::new(&after).is_file() {
        return Err("slice missing — render VSR first".into());
    }
    let dir = preview_dir()?;
    let diff = dir.join(format!("{key}_diff.mp4"));
    let diff_str = diff.to_str().ok_or("preview path not UTF-8")?.to_string();
    let fc = "[0:v][1:v]scale2ref=flags=lanczos[b][r];[b][r]blend=all_mode=difference,eq=contrast=5:brightness=0.08[out]";
    let ff_args: Vec<String> = vec![
        "-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-i".into(), before,
        "-i".into(), after,
        "-filter_complex".into(), fc.into(),
        "-map".into(), "[out]".into(),
        "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into(),
        "-crf".into(), "12".into(), "-pix_fmt".into(), "yuv420p".into(), "-an".into(),
        diff_str.clone(),
    ];
    let res = crate::tools::ffmpeg_command(&app)?
        .args(ff_args)
        .output()
        .await
        .map_err(|e| format!("diff spawn: {e}"))?;
    if !res.status.success() || !diff.is_file() {
        return Err(format!(
            "diff map failed: {}",
            String::from_utf8_lossy(&res.stderr)
        ));
    }
    Ok(diff_str)
}

/// Cancel a running enhance by its frontend job id — flags it canceled (so the
/// enhance loop returns `__rtx_canceled__` rather than a failure) and kills the
/// worker process. Returns false if the job wasn't running (already done/gone).
#[tauri::command]
pub fn rtx_enhance_cancel(
    registry: State<'_, crate::JobRegistry>,
    job_id: String,
) -> Result<bool, String> {
    // Mark canceled FIRST so the event loop distinguishes user-cancel from a
    // crash when the killed process lands as a Terminated event.
    if let Ok(mut set) = registry.canceled.lock() {
        set.insert(job_id.clone());
    }
    let child = registry
        .children
        .lock()
        .ok()
        .and_then(|mut m| m.remove(&job_id));
    match child {
        Some(c) => {
            c.kill().map_err(|e| format!("kill RTX worker: {e}"))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(all(test, windows))]
mod tests {
    /// 1.14.0 — re-enhancing a clip must not overwrite the previous
    /// render. Reproduced live: a second run of the same clip replaced the
    /// first result in place, leaving an earlier library row describing a
    /// file it never made.
    #[test]
    fn repeated_enhance_never_overwrites() {
        let dir = std::env::temp_dir().join("mh-rtx-test-unique");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Nothing there yet: the plain name.
        let first = unique_out_path(&dir, "clip [abc]", "_rtx-vsr");
        assert_eq!(first.file_name().unwrap(), "clip [abc]_rtx-vsr.mp4");

        // Once it exists, the next run must land somewhere else.
        std::fs::write(&first, b"render 1").unwrap();
        let second = unique_out_path(&dir, "clip [abc]", "_rtx-vsr");
        assert_eq!(second.file_name().unwrap(), "clip [abc]_rtx-vsr (2).mp4");
        assert_ne!(first, second);

        std::fs::write(&second, b"render 2").unwrap();
        let third = unique_out_path(&dir, "clip [abc]", "_rtx-vsr");
        assert_eq!(third.file_name().unwrap(), "clip [abc]_rtx-vsr (3).mp4");

        // The earlier renders are untouched — the whole point.
        assert_eq!(std::fs::read(&first).unwrap(), b"render 1");
        assert_eq!(std::fs::read(&second).unwrap(), b"render 2");

        // A different scale has its own suffix and its own sequence.
        let other = unique_out_path(&dir, "clip [abc]", "_rtx-4x");
        assert_eq!(other.file_name().unwrap(), "clip [abc]_rtx-4x.mp4");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 1.14.0 — the 10-bit gate reads this. Lines below are VERBATIM
    /// `ffmpeg -i` output from files generated for the purpose, not
    /// hand-written fixtures — note the colour metadata `(tv, progressive)`
    /// carries a comma INSIDE the field, which is what breaks a naive
    /// comma-split.
    #[test]
    fn pix_fmt_is_read_from_real_ffmpeg_lines() {
        let eight = "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 50 kb/s, 10 fps, 10 tbr, 10240 tbn (default)";
        assert_eq!(parse_pix_fmt(eight).as_deref(), Some("yuv420p"));
        assert!(!pix_fmt_is_high_bit("yuv420p"));

        let ten = "  Stream #0:0[0x1](und): Video: hevc (Main 10) (hev1 / 0x31766568), yuv420p10le(tv, progressive), 320x240 [SAR 1:1 DAR 4:3], 31 kb/s, 10 fps, 10 tbr, 10240 tbn (default)";
        assert_eq!(parse_pix_fmt(ten).as_deref(), Some("yuv420p10le"));
        assert!(pix_fmt_is_high_bit("yuv420p10le"));

        // The codec tag (0x31637661) must never be mistaken for a format,
        // and an audio line has no pixel format at all.
        assert_eq!(parse_pix_fmt("Stream #0:1: Audio: aac (LC), 44100 Hz, stereo"), None);

        // Formats the filter cannot take.
        for hi in ["p010le", "yuv422p10le", "yuv444p12le", "p016le", "yuv420p10be"] {
            assert!(pix_fmt_is_high_bit(hi), "{hi} must be flagged 10-bit+");
        }
        for ok in ["yuv420p", "yuvj420p", "nv12", "gbrp", "rgb24"] {
            assert!(!pix_fmt_is_high_bit(ok), "{ok} is 8-bit");
        }
    }

    /// The preset never reaches the worker as free-form text: it validates
    /// the value and exits on anything unknown.
    #[test]
    fn enc_preset_is_closed_and_defaults_safely() {
        assert_eq!(EncPreset::from_str("lossless").as_str(), "lossless");
        assert_eq!(EncPreset::from_str("MASTER").as_str(), "master");
        assert_eq!(EncPreset::from_str(" previa ").as_str(), "previa");
        assert_eq!(EncPreset::from_str("prévia").as_str(), "previa");
        // Garbage, empty and the shipped default all land on entrega.
        for junk in ["", "  ", "qp=12", "--nvenc-qp 0", "ultra", "entrega"] {
            assert_eq!(EncPreset::from_str(junk).as_str(), "entrega", "{junk:?}");
        }
    }

    use super::*;

    #[test]
    fn rtx_5080_supported() {
        let c = capability_from_smi("NVIDIA GeForce RTX 5080, 610.47");
        assert!(c.supported);
        assert_eq!(c.gpu_name, "NVIDIA GeForce RTX 5080");
        assert_eq!(c.driver_version, "610.47");
        assert!(c.reason.is_none());
    }

    #[test]
    fn gtx_card_excluded() {
        let c = capability_from_smi("NVIDIA GeForce GTX 1660, 560.00");
        assert!(!c.supported);
        assert!(c.reason.unwrap().contains("RTX"));
    }

    #[test]
    fn old_driver_excluded() {
        let c = capability_from_smi("NVIDIA GeForce RTX 3060, 536.99");
        assert!(!c.supported);
        assert!(c.reason.unwrap().to_lowercase().contains("driver"));
    }

    #[test]
    fn driver_minimum_boundary() {
        assert!(driver_meets_min("550.58"));
        assert!(!driver_meets_min("550.57"));
        assert!(driver_meets_min("551.01"));
        assert!(!driver_meets_min("549.99"));
        assert!(driver_meets_min("610.47"));
        assert!(!driver_meets_min("garbage"));
    }

    #[test]
    fn progress_parses_clean_line() {
        let p = parse_progress("  75.3% [55/73] 31.9 fps ETA: 00:00").unwrap();
        assert_eq!(p.frame, 55);
        assert_eq!(p.total, 73);
        assert!((p.percent - 75.3).abs() < 0.01);
        assert!((p.fps - 31.9).abs() < 0.01);
        assert_eq!(p.eta, "00:00");
    }

    #[test]
    fn progress_parses_with_ansi_noise() {
        let p =
            parse_progress("\x1b[2K[=====================>            ] 043.8% [32/73] 026.1 fps ETA: 00:01")
                .unwrap();
        assert_eq!(p.frame, 32);
        assert_eq!(p.total, 73);
        assert!((p.percent - 43.8).abs() < 0.01);
        assert!((p.fps - 26.1).abs() < 0.01);
    }

    #[test]
    fn parse_wxh_picks_real_dims_over_codec_tag() {
        // Codec tag `0x31637661` must NOT be read as dimensions.
        let line = "  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 5000 kb/s, 30 fps";
        assert_eq!(parse_wxh(line), Some((1920, 1080)));
    }

    #[test]
    fn parse_wxh_none_when_absent() {
        assert_eq!(parse_wxh("[INFO] no dimensions here"), None);
    }

    #[test]
    fn non_progress_line_ignored() {
        assert!(parse_progress("[VERBOSE] Starting video processing pipeline").is_none());
        assert!(parse_progress("[INFO] Primary audio stream: 1 (aac)").is_none());
    }
}
