// Media Hub — Rust backend entry.
//
// Milestone 0.1: `binaries_version` smoke test (proves sidecar pipeline).
// Milestone 0.2 in progress: `yt_fetch_metadata` (paste URL → metadata card).

mod library;
mod settings;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
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
async fn yt_fetch_metadata(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
) -> Result<VideoMetadata, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    let shell = app.shell();
    let cmd = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?;

    // Cookies extras (0.8.B): empty when source is None, otherwise
    // adds --cookies-from-browser <name> or --cookies <path>.
    // Owned strings because .args() needs &str references that outlive
    // the call.
    let cookies = settings::cookies_args(&settings);
    let mut args: Vec<&str> = vec![
        "-j",                  // dump single JSON object, no download
        "--no-playlist",       // never expand playlists at this stage
        "--no-warnings",       // keep stderr clean
        "--no-call-home",      // be polite, skip telemetry
        "--socket-timeout", "15",
    ];
    for c in &cookies {
        args.push(c.as_str());
    }
    args.push("--");           // end of options, URL is positional
    args.push(trimmed);

    let out = cmd
        .args(args)
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
// 0.2 — Download with streaming progress
// =====================================================================
//
// yt-dlp is spawned (not awaited as one blob) so we can read its stdout
// line by line while the download runs. We instruct yt-dlp to emit
// machine-parseable progress lines with a custom prefix, parse them in
// Rust, and forward structured events to the renderer via Tauri's event
// system. The renderer subscribes with @tauri-apps/api/event `listen`.
//
// Destination resolves per active scope (0.6 Phase B):
//   project_id = None         → ~/Media Hub/Library/raw/
//   project_id = Some(id)     → ~/Media Hub/Projects/<slug>/raw/
// The slug is looked up from the projects table — single source of
// truth, can't drift from what was set at create-time.

#[derive(Serialize)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct ProgressEvent {
    /// Optional job identifier — set by the batch queue caller so the
    /// renderer can route progress events to the right job row. Null
    /// for single-URL downloads where there's only one active job.
    pub job_id: Option<String>,
    /// Bytes pulled across the current stream (resets when yt-dlp moves
    /// from video stream to audio stream during a `<id>+bestaudio` spec).
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub speed_bps: Option<u64>,
    pub eta_sec: Option<u64>,
}

/// Return the actual current byte count of `path` by opening it for read
/// and seeking to the end.
///
/// On Windows, the file size in directory listings is **cached** and
/// doesn't update during buffered writes — `std::fs::metadata().len()`
/// on an actively-growing file returns the size from the last metadata
/// flush, often 0 throughout the entire download. Opening the file
/// ourselves and seeking to the end forces the file system to report
/// the real current position. yt-dlp opens its writes with shared
/// access on Windows, so this concurrent read is allowed.
fn live_file_size(path: &std::path::Path) -> Option<u64> {
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom};
    let mut f = OpenOptions::new().read(true).open(path).ok()?;
    f.seek(SeekFrom::End(0)).ok()
}

/// Sum live byte counts of every active download file in `dir` — both
/// `.part` (when --no-part isn't used) and our matching final-name
/// pattern. At most one or two files are growing at a time (video then
/// audio for composed specs), so the sum is the currently-relevant
/// total even though we don't know which file is which.
fn sum_live_dir_bytes(dir: &std::path::Path, video_id: &str) -> u64 {
    let id_marker = format!("[{video_id}]");
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    // Match either *.part OR files containing our video id
                    // (matches yt-dlp's <title> [<id>].<ext> output template,
                    // including intermediate per-format names like .f313.webm).
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    name.ends_with(".part") || name.contains(&id_marker.to_lowercase())
                })
                .filter_map(|e| live_file_size(&e.path()))
                .sum()
        })
        .unwrap_or(0)
}

/// Format a number of seconds as HH-MM-SS for use in filenames.
/// Dashes (not colons) so the result is filesystem-safe on Windows.
fn fmt_segment_label(sec: f64) -> String {
    let total = sec.max(0.0) as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{:02}-{:02}-{:02}", h, m, s)
}

#[tauri::command]
async fn yt_download(
    app: AppHandle,
    state: tauri::State<'_, library::LibraryState>,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
    format_spec: String,
    merge_container: Option<String>,
    total_bytes_hint: Option<u64>,
    video_id: String,
    // 0.6.1: multi-segment support replaces the old in_sec / out_sec
    // pair. Semantics:
    //   - None or Some(empty)  → full video, returns single result
    //   - Some(N >= 1)          → full source downloaded once, ffmpeg
    //                             trims into N segment files, source
    //                             is deleted, returns N results
    // Single-segment downloads still work the same — just pass a vec
    // with one (in, out) pair.
    segments: Option<Vec<(f64, f64)>>,
    job_id: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<DownloadResult>, String> {
    // `format_spec` is an opaque yt-dlp -f argument — could be a single
    // format id ("18", "313") or a composed spec ("313+bestaudio/best").
    // `merge_container` is an optional yt-dlp --merge-output-format value
    // ("mp4", "webm", "mkv"). The React layer decides both based on the
    // picked format's ext (so picking MP4 stays MP4, picking WebM stays
    // WebM). Note: muxing is byte-copy only — no recompression happens.
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }
    if format_spec.trim().is_empty() {
        return Err("format_spec is empty".into());
    }

    // Resolve destination dir from the active scope:
    //   project_id = None     → Library/raw/
    //   project_id = Some(id) → Projects/<slug>/raw/   (slug from DB)
    //
    // Looking up the slug here (rather than passing it from the
    // renderer) keeps the projects table as the single source of
    // truth. If a project was renamed since the renderer cached its
    // info, we still write to the original slug — folders on disk
    // stay stable across project renames.
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    // 0.8.C: respect library_root override. The content root is either
    // `<home>/Media Hub` (default) or the user's configured override path.
    let content_root = settings::content_root(&settings, &home);
    let dest = library::resolve_download_dir(&state, &content_root, project_id.as_deref())
        .await
        .map_err(|e| format!("resolve dest dir: {e}"))?;
    std::fs::create_dir_all(&dest).map_err(|e| format!("create dest dir: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();
    // Force yt-dlp's temp files (during merges and section trims) into
    // our dest dir so the filesystem-polling progress task can see them.
    // Without this, segment downloads stage in a hidden temp dir and the
    // bar sits at 0 the whole time.
    let temp_paths_arg = format!("temp:{}", dest_str);

    // Segment validation: each pair must have in < out, both >= 0.
    // Empty / None means "full video, no trims" — back-compat with the
    // pre-0.6.1 single-segment API where the renderer passed null/null.
    let trims: Vec<(f64, f64)> = match segments {
        None => Vec::new(),
        Some(v) => {
            for (i, o) in &v {
                if *i < 0.0 || *o <= *i {
                    return Err(format!(
                        "Invalid segment ({i}, {o}): require in >= 0 and out > in"
                    ));
                }
            }
            v
        }
    };

    // Template is ALWAYS the full-video form now. Trims happen post-
    // download with their own naming. For a single segment this is a
    // wash — we used to embed the in/out in the yt-dlp template, but
    // since we ffmpeg-trim after the download either way, the template
    // doesn't need it.
    //
    // 0.8.C: rename template comes from settings. Empty = legacy
    // default. `build_filename_template` converts user-facing tokens
    // ({channel}, {title}, {date}, {id}) into yt-dlp's %(...)s syntax
    // and guarantees a trailing .%(ext)s so we never produce
    // extension-less files.
    let user_template = settings::rename_template(&settings);
    let template_path = dest.join(settings::build_filename_template(&user_template));
    let template_str = template_path.to_string_lossy().to_string();

    // When yt-dlp needs to mux (e.g. `313+bestaudio/best`), it shells out
    // to ffmpeg. It looks for ffmpeg on PATH by default — but our ffmpeg
    // is bundled as a sidecar next to media-hub.exe, not on PATH. Point
    // yt-dlp at the bundled binary explicitly so muxing Just Works
    // regardless of whether the user has a system ffmpeg.
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
    let ffmpeg_path_str = ffmpeg_path.as_ref().map(|p| p.to_string_lossy().to_string());

    let shell = app.shell();
    // PYTHONUNBUFFERED disables Python's block-buffering of stdout when
    // the process is piped (not attached to a TTY). yt-dlp.exe is a
    // PyInstaller bundle and honors this env var — without it, progress
    // lines sit in the buffer until the process exits, defeating the
    // whole point of streaming.
    let cmd = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar resolve: {e}"))?
        .env("PYTHONUNBUFFERED", "1");

    // We don't try to parse yt-dlp's progress output anymore — Python's
    // block-buffering on piped stdout makes it arrive in one burst at
    // end-of-process (PYTHONUNBUFFERED doesn't override PyInstaller's
    // bundled Python in practice). Instead we poll the .part file size
    // from the filesystem every 500ms in a sibling task, which gives
    // us real progress without depending on stdout flushing. See
    // sum_part_file_bytes + the spawn block below.
    //
    // `--print after_move:...` still works — it fires only once after
    // each stream's post-processing rename, so a single end-of-process
    // flush is fine for capturing the final path.
    let filepath_template = "after_move:[mh-filepath] %(filepath)s";

    let mut args: Vec<&str> = vec![
        "-f",
        format_spec.trim(),
        "--no-playlist",
        "--no-warnings",
        "--restrict-filenames",
        "--no-mtime", // download time, not source mtime — friendlier for library sort
        // Sequential fragment downloads — forces each fragment to flush
        // before the next starts, giving our filesystem polling more
        // discrete checkpoints to observe. Without this yt-dlp downloads
        // N fragments in parallel and the writes can all arrive in one burst.
        "--concurrent-fragments",
        "1",
        // Force temp files to be in dest dir (see temp_paths_arg above).
        "-P",
        temp_paths_arg.as_str(),
        "--print",
        filepath_template,
        "-o",
        template_str.as_str(),
    ];
    if let Some(ref ff) = ffmpeg_path_str {
        args.push("--ffmpeg-location");
        args.push(ff.as_str());
    }
    // Cookies extras (0.8.B) for age-restricted / following-only content.
    let cookies = settings::cookies_args(&settings);
    for c in &cookies {
        args.push(c.as_str());
    }
    // Bandwidth throttle (0.8.C). Empty when unlimited (default);
    // otherwise emits --limit-rate <N>K. yt-dlp's rate limiter is
    // per-process, so with N parallel workers the effective ceiling
    // is N × limit. That's a feature — users tune the per-job limit
    // up if they want headroom.
    let bandwidth = settings::bandwidth_args(&settings);
    for b in &bandwidth {
        args.push(b.as_str());
    }
    // Allowed container values — defensive guard against arbitrary
    // strings from the renderer slipping into a yt-dlp arg.
    let container_owned = merge_container
        .as_deref()
        .map(str::trim)
        .filter(|c| matches!(*c, "mp4" | "webm" | "mkv" | "m4a"))
        .map(|c| c.to_string());
    if let Some(ref c) = container_owned {
        args.push("--merge-output-format");
        args.push(c.as_str());
    }

    // Segment trims are done as a POST-DOWNLOAD step (see below). We
    // intentionally do NOT pass --download-sections to yt-dlp — its
    // built-in trim is unreliable for AV1/VP9 high-res content (cut
    // points off keyframes silently drop the video stream), and its
    // temp-file behavior breaks our filesystem-polling progress.
    //
    // Cost of doing the trim ourselves: same bandwidth (always full
    // source), plus a few seconds of `ffmpeg -c copy` after download.
    // Benefits: real progress during download, correct video every
    // time, no codec-specific gotchas.

    args.push("--");
    args.push(trimmed);

    // Polling task: every 500ms, sum .part file sizes in dest, compute
    // speed from delta, emit a progress event. Stops as soon as the
    // shared `running` flag flips — set by the StopPolling drop guard
    // when this function returns (success or error), so the task can
    // never outlive the download.
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    struct StopPolling(Arc<AtomicBool>);
    impl Drop for StopPolling {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Relaxed);
        }
    }

    let running = Arc::new(AtomicBool::new(true));
    let _stop_guard = StopPolling(running.clone());

    {
        let app = app.clone();
        let dest = dest.clone();
        let running = running.clone();
        let total_hint = total_bytes_hint;
        let video_id = video_id.clone();
        let job_id_clone = job_id.clone();
        tokio::spawn(async move {
            // Rolling window of (bytes, time) samples. Speed is computed
            // across the oldest-to-newest sample, smoothing out the
            // burstiness of yt-dlp's network writes (chunks land in
            // clumps which would give 0 → 200 MB/s swings at the raw
            // 500ms tick). Five samples = ~2.5 s of history.
            const WINDOW: usize = 5;
            let mut window: std::collections::VecDeque<(u64, Instant)> =
                std::collections::VecDeque::with_capacity(WINDOW + 1);

            while running.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if !running.load(Ordering::Relaxed) {
                    break;
                }
                let bytes_now = sum_live_dir_bytes(&dest, &video_id);
                let now = Instant::now();

                window.push_back((bytes_now, now));
                while window.len() > WINDOW {
                    window.pop_front();
                }

                // Need at least two samples to compute a delta.
                let speed = if window.len() >= 2 {
                    let (b0, t0) = window.front().copied().unwrap();
                    let (b1, t1) = window.back().copied().unwrap();
                    let dt = t1.duration_since(t0).as_secs_f64();
                    let db = b1.saturating_sub(b0);
                    if dt > 0.0 && db > 0 {
                        Some((db as f64 / dt) as u64)
                    } else {
                        None
                    }
                } else {
                    None
                };

                let percent = total_hint
                    .filter(|t| *t > 0)
                    .map(|t| ((bytes_now as f64 / t as f64) * 100.0).min(99.9));
                let eta = match (speed, total_hint) {
                    (Some(s), Some(t)) if s > 0 && t > bytes_now => {
                        Some(t.saturating_sub(bytes_now) / s)
                    }
                    _ => None,
                };
                let _ = app.emit(
                    "download:progress",
                    ProgressEvent {
                        job_id: job_id_clone.clone(),
                        downloaded_bytes: bytes_now,
                        total_bytes: total_hint,
                        percent,
                        speed_bps: speed,
                        eta_sec: eta,
                    },
                );
            }
        });
    }

    // Spawn yt-dlp and read its event stream. We only consume stdout for
    // the [mh-filepath] capture and stderr for error reporting; progress
    // comes from the polling task above.
    let (mut rx, _child) = cmd
        .args(args)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let mut final_path: Option<String> = None;
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let line = line.trim();
                if let Some(path) = line.strip_prefix("[mh-filepath] ") {
                    final_path = Some(path.trim().to_string());
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if !line.is_empty() {
                    stderr_tail.push(line);
                    if stderr_tail.len() > 50 {
                        stderr_tail.remove(0);
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no stderr)".into());
        return Err(format!("yt-dlp failed: {tail}"));
    }

    let full_path = final_path.ok_or_else(|| "yt-dlp returned no output path".to_string())?;

    // Post-download trim step (only when at least one segment is set).
    //
    // Approach per segment: `ffmpeg -ss <in> -i <full> -t <dur> -c copy`
    // - `-ss BEFORE -i`: fast-seek (decoder-level) to the nearest
    //   keyframe at or before <in>. The first second or two of output
    //   may be a hair earlier than the user requested, which is
    //   actually useful for editing (lead-in frames).
    // - `-c copy`: byte-copy both streams — no re-encode, no quality
    //   loss, runs at I/O speed (~5-15s for a 1GB file).
    // - `-t <duration>`: stop after that many seconds. Using `-t`
    //   instead of `-to` is more reliable across ffmpeg versions when
    //   combined with input seek.
    //
    // For multi-segment downloads, we run N ffmpeg invocations
    // sequentially. Could parallelize, but ffmpeg -c copy is I/O bound
    // and parallel reads from the same source file would just thrash.
    // Sequential is fine — each trim is ~5-15s, N usually small.
    if !trims.is_empty() {
        // Stop the progress poller — download phase is complete. Emit
        // one last "100%" progress so the bar parks at the top during
        // the trim instead of falling back to indeterminate.
        running.store(false, Ordering::Relaxed);
        if let Some(total) = total_bytes_hint {
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
                    job_id: job_id.clone(),
                    downloaded_bytes: total,
                    total_bytes: Some(total),
                    percent: Some(100.0),
                    speed_bps: None,
                    eta_sec: None,
                },
            );
        }

        let full_pb = std::path::PathBuf::from(&full_path);
        let parent = full_pb.parent().unwrap_or(&dest).to_path_buf();
        let stem = full_pb
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("video");
        let ext = full_pb
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4");

        let ffmpeg_cmd_path = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("sidecar resolve ffmpeg: {e}"))?;
        // Resolving the sidecar each iteration is cheap — it doesn't
        // re-spawn, just builds the Command struct. But the type isn't
        // Clone, so we re-resolve in the loop.
        drop(ffmpeg_cmd_path);

        let mut results: Vec<DownloadResult> = Vec::with_capacity(trims.len());
        for (in_sec, out_sec) in &trims {
            let seg_name = format!(
                "{} [{}_{}].{}",
                stem,
                fmt_segment_label(*in_sec),
                fmt_segment_label(*out_sec),
                ext
            );
            let seg_path = parent.join(seg_name);

            let in_arg = format!("{}", in_sec);
            let dur_arg = format!("{}", (out_sec - in_sec).max(0.0));
            let seg_path_str = seg_path
                .to_str()
                .ok_or("segment path is not valid UTF-8")?
                .to_string();

            let ffmpeg_cmd = app
                .shell()
                .sidecar("ffmpeg")
                .map_err(|e| format!("sidecar resolve ffmpeg: {e}"))?;
            let ff_out = ffmpeg_cmd
                .args([
                    "-y", // overwrite if exists
                    "-ss", in_arg.as_str(),
                    "-i", full_path.as_str(),
                    "-t", dur_arg.as_str(),
                    "-c", "copy",
                    "-movflags", "+faststart", // friendly mp4 layout
                    seg_path_str.as_str(),
                ])
                .output()
                .await
                .map_err(|e| format!("ffmpeg spawn: {e}"))?;

            if !ff_out.status.success() {
                let stderr = String::from_utf8_lossy(&ff_out.stderr);
                let tail = stderr
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .last()
                    .unwrap_or("(no stderr)");
                // Leave the full source on disk so the user can recover
                // (or manually retry the trim). Earlier successful
                // segments stay too — they're independently useful.
                return Err(format!(
                    "ffmpeg trim failed at segment ({in_sec},{out_sec}): {tail}"
                ));
            }

            let bytes = std::fs::metadata(&seg_path_str).ok().map(|m| m.len());
            results.push(DownloadResult {
                path: seg_path_str,
                bytes,
            });
        }

        // All trims succeeded — delete the full intermediate. We don't
        // keep it (user explicitly asked for segments). A future "keep
        // source too" setting could change this.
        let _ = std::fs::remove_file(&full_path);

        Ok(results)
    } else {
        // No segments — caller wanted the full video as-is.
        let bytes = std::fs::metadata(&full_path).ok().map(|m| m.len());
        Ok(vec![DownloadResult {
            path: full_path,
            bytes,
        }])
    }
}

// =====================================================================
// 0.3 — Transcode pipeline
// =====================================================================
//
// Spawns our bundled ffmpeg to convert a downloaded file into an edit-
// friendly intermediate (ProRes / DNxHR) or a smaller MP4. The encode
// preset is decoded server-side from an allowlisted string so the
// renderer can't inject arbitrary ffmpeg arguments.
//
// Progress comes from ffmpeg's `-progress pipe:1` which writes
// structured key=value lines per chunk — no PyInstaller-style stdout
// buffering nightmare here, just a clean stream. Parse line by line,
// emit a transcode:progress event when we see `progress=continue`.

#[derive(Serialize, Clone)]
pub struct TranscodeProgress {
    pub job_id: Option<String>,
    pub processed_sec: f64,
    pub total_sec: Option<f64>,
    pub percent: Option<f64>,
    pub speed_mult: Option<f64>, // 1.0 = realtime, 2.0 = 2× faster than realtime
}

#[derive(Serialize)]
pub struct TranscodeResult {
    pub path: String,
    pub bytes: Option<u64>,
}

/// Resolve a preset name to (ffmpeg args, file extension, name suffix).
/// All preset strings are allowlisted — anything else is rejected so
/// the renderer can't smuggle ffmpeg flags via this parameter.
///
/// Audio handling:
///   - ProRes / DNxHR: PCM s16le @ 48kHz — uncompressed, NLE-standard
///   - H.264 MP4: AAC @ 192k — small file, web-friendly
///
/// Container choice:
///   - ProRes / DNxHR: .mov — the universal "intermediate" container
///   - H.264: .mp4 — small files, Resolve/Premiere read it fine
fn resolve_preset(preset: &str) -> Result<(Vec<&'static str>, &'static str, &'static str), String> {
    match preset {
        "prores_422_lt" => Ok((
            vec![
                "-c:v", "prores_ks",
                "-profile:v", "1",       // 1 = 422 LT
                "-vendor", "apl0",       // marks the file as Apple-encoded; Resolve accepts this
                "-pix_fmt", "yuv422p10le",
                "-c:a", "pcm_s16le",
                "-ar", "48000",
            ],
            "mov",
            "prores422lt",
        )),
        "dnxhr_sq" => Ok((
            vec![
                "-c:v", "dnxhd",
                "-profile:v", "dnxhr_sq",
                "-pix_fmt", "yuv422p",
                "-c:a", "pcm_s16le",
                "-ar", "48000",
            ],
            "mov",
            "dnxhrsq",
        )),
        "h264_mp4" => Ok((
            vec![
                "-c:v", "libx264",
                "-preset", "slow",       // good quality/size balance
                "-crf", "18",            // visually lossless threshold
                "-pix_fmt", "yuv420p",   // widest compatibility
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
            ],
            "mp4",
            "h264",
        )),
        // NVENC variant — 5-10× faster than libx264 on NVIDIA hardware.
        // Falls back to "ffmpeg failed: unknown encoder h264_nvenc" if
        // the user's machine doesn't have a compatible NVIDIA GPU or
        // their driver is too old. Quality is delivery-tier (CQ 20 is
        // visually equivalent to libx264 -crf 18 for most content).
        "h264_nvenc_mp4" => Ok((
            vec![
                "-c:v", "h264_nvenc",
                "-preset", "p6",         // p1 fastest .. p7 highest quality
                "-rc", "vbr",
                "-cq", "20",             // constant quality target
                "-b:v", "0",             // pure CQ, no bitrate cap
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
            ],
            "mp4",
            "h264nv",
        )),
        other => Err(format!("unknown preset: {other}")),
    }
}

#[tauri::command]
async fn media_transcode(
    app: AppHandle,
    src_path: String,
    preset: String,
    total_sec_hint: Option<f64>,
    job_id: Option<String>,
) -> Result<TranscodeResult, String> {
    if src_path.trim().is_empty() {
        return Err("src_path is empty".into());
    }
    let src_pb = std::path::PathBuf::from(&src_path);
    if !src_pb.exists() {
        return Err(format!("source file does not exist: {src_path}"));
    }

    let (preset_args, out_ext, suffix) = resolve_preset(preset.trim())?;

    // Build output path: <stem>.<suffix>.<ext> next to the source.
    let parent = src_pb.parent().ok_or("source has no parent dir")?.to_path_buf();
    let stem = src_pb
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("source path is not valid UTF-8")?;
    let out_path = parent.join(format!("{}.{}.{}", stem, suffix, out_ext));
    let out_path_str = out_path
        .to_str()
        .ok_or("output path is not valid UTF-8")?
        .to_string();

    // Build full ffmpeg command. -progress pipe:1 emits structured
    // key=value progress lines on stdout — much cleaner than parsing
    // ffmpeg's human-readable banner output.
    let ffmpeg = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar resolve ffmpeg: {e}"))?;

    let mut args: Vec<&str> = vec![
        "-y",                // overwrite output if it exists
        "-hide_banner",      // skip the version/copyright preamble
        "-loglevel", "warning",
        "-progress", "pipe:1",
        "-nostats",          // we have our own progress; the stderr stats are noise
        // Hardware decode acceleration where available. `auto` picks
        // the best available backend (NVDEC on NVIDIA, QSV on Intel,
        // VideoToolbox on macOS, etc.) and falls back to CPU silently
        // if none work. Cuts decode time substantially on H.264/HEVC/
        // AV1 inputs which is most of what YouTube serves.
        "-hwaccel", "auto",
        "-i", src_path.as_str(),
    ];
    args.extend(preset_args.iter());
    args.push(out_path_str.as_str());

    let (mut rx, _child) = ffmpeg
        .args(args)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    // Accumulator for the current chunk of progress key=value pairs.
    // ffmpeg writes one chunk per ~1s of source processed, terminated
    // by `progress=continue` (or `progress=end` for the final chunk).
    let mut chunk: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Some(eq) = line.find('=') {
                    let key = line[..eq].trim().to_string();
                    let value = line[eq + 1..].trim().to_string();
                    if key == "progress" {
                        // End of chunk — compute and emit.
                        let processed_us: f64 = chunk
                            .get("out_time_us")
                            .or_else(|| chunk.get("out_time_ms"))
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0.0);
                        // out_time_us is microseconds; out_time_ms in
                        // ffmpeg is also microseconds despite the name
                        // (legacy quirk). Either way, divide by 1e6.
                        let processed_sec = processed_us / 1_000_000.0;
                        let speed_mult: Option<f64> = chunk
                            .get("speed")
                            .and_then(|s| s.trim_end_matches('x').trim().parse().ok())
                            .filter(|s: &f64| *s > 0.0);
                        let percent = total_sec_hint
                            .filter(|t| *t > 0.0)
                            .map(|t| (processed_sec / t * 100.0).min(99.9));

                        let _ = app.emit(
                            "transcode:progress",
                            TranscodeProgress {
                                job_id: job_id.clone(),
                                processed_sec,
                                total_sec: total_sec_hint,
                                percent,
                                speed_mult,
                            },
                        );

                        chunk.clear();
                        if value == "end" {
                            // The final chunk — loop will exit on
                            // Terminated event next, but we've emitted
                            // the last data point.
                        }
                    } else {
                        chunk.insert(key, value);
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if !line.is_empty() {
                    stderr_tail.push(line);
                    if stderr_tail.len() > 50 {
                        stderr_tail.remove(0);
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no stderr)".into());
        return Err(format!("ffmpeg failed: {tail}"));
    }

    let bytes = std::fs::metadata(&out_path_str).ok().map(|m| m.len());
    Ok(TranscodeResult {
        path: out_path_str,
        bytes,
    })
}

// =====================================================================
// Thumbnail extraction (0.5.1)
// =====================================================================

#[derive(Serialize)]
pub struct ThumbnailResult {
    pub path: String,
}

/// Extract a single representative frame from a clip and save it as
/// JPEG into `~/Media Hub/_thumbnails/<asset_id>.jpg`. Returns the
/// final path so the caller can hand it to `library_set_thumbnail`.
///
/// Seek strategy: jump to `duration/2` when we have a duration, else
/// fall back to `1.0s`. Mid-clip avoids the typical opening
/// black/title-card and is representative enough for a thumbnail.
///
/// Output is 480px wide (height auto, divisible by 2 for codec
/// happiness) at JPEG q=4 — ~30-80 KB per thumb, good enough for grid
/// rendering at any reasonable card size.
///
/// We use `-ss` BEFORE `-i` for fast keyframe seek (decoder skips
/// straight to the nearest keyframe before the requested timestamp).
/// Frame-accurate seeking would need `-ss` after `-i` and is overkill
/// for a thumbnail.
#[tauri::command]
async fn media_extract_thumbnail(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    src_path: String,
    asset_id: String,
    duration_sec: Option<f64>,
) -> Result<ThumbnailResult, String> {
    if src_path.trim().is_empty() {
        return Err("src_path is empty".into());
    }
    if asset_id.trim().is_empty() {
        return Err("asset_id is empty".into());
    }
    let src_pb = std::path::PathBuf::from(&src_path);
    if !src_pb.exists() {
        return Err(format!("source file does not exist: {src_path}"));
    }

    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    // 0.8.C: respect library_root override so thumbnails sit alongside
    // the content tree they belong to.
    let thumb_dir = settings::content_root(&settings, &home).join("_thumbnails");
    std::fs::create_dir_all(&thumb_dir).map_err(|e| format!("create thumbnails dir: {e}"))?;
    let out_path = thumb_dir.join(format!("{asset_id}.jpg"));
    let out_path_str = out_path
        .to_str()
        .ok_or("thumbnail path is not valid UTF-8")?
        .to_string();

    let seek = duration_sec
        .filter(|d| *d > 2.0)
        .map(|d| d / 2.0)
        .unwrap_or(1.0);
    let seek_str = format!("{:.3}", seek);

    let ffmpeg = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar resolve ffmpeg: {e}"))?;

    let args: Vec<&str> = vec![
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-ss", seek_str.as_str(),
        "-i", src_path.as_str(),
        "-frames:v", "1",
        // scale=480:-2 keeps aspect ratio, rounds height to even
        // (some codecs / players choke on odd dimensions even for stills).
        "-vf", "scale=480:-2:flags=lanczos",
        "-q:v", "4",
        out_path_str.as_str(),
    ];

    let (mut rx, _child) = ffmpeg
        .args(args)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let mut stderr_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if !line.is_empty() {
                    stderr_tail.push(line);
                    if stderr_tail.len() > 20 {
                        stderr_tail.remove(0);
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no stderr)".into());
        return Err(format!("ffmpeg thumbnail failed: {tail}"));
    }

    Ok(ThumbnailResult {
        path: out_path_str,
    })
}

// =====================================================================
// Direct stream URL resolution (0.6 Phase D — scrubber)
// =====================================================================

#[derive(Serialize)]
pub struct StreamUrl {
    pub url: String,
    /// True when the resolved stream contains both video and audio in a
    /// single track. False means yt-dlp picked separate streams and
    /// the browser can only play the video track (used for visual
    /// scrub-only previews when no muxed format exists).
    pub has_audio: bool,
}

/// Resolve a direct, browser-playable stream URL for a YouTube video
/// without downloading anything. Used by the in-app scrubber so the
/// user can mark In/Out timestamps without committing bandwidth to a
/// full source download first.
///
/// Format preference (cheapest-but-playable for scrubbing):
///   1. Muxed MP4 ≤ 720p — single stream the <video> element loves
///   2. Muxed MP4 at any height — most common up to 720p, sometimes 1080p
///   3. Any ≤ 720p — fall back to WebM if MP4 isn't available
///   4. Whatever yt-dlp's "best" thinks — last resort
///
/// `yt-dlp -g` prints the resolved URL(s) on stdout. For muxed
/// formats it's one URL; for separate video+audio it'd be two
/// (we'd discard audio — only video plays in the scrubber).
#[tauri::command]
async fn yt_resolve_stream_url(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
) -> Result<StreamUrl, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    let shell = app.shell();
    // The format spec biases toward muxed streams the browser can
    // play. Falls back twice before giving up — final "best" is
    // always defined for any playable YouTube URL.
    let format_spec =
        "best[ext=mp4][height<=720]/best[ext=mp4]/best[height<=720]/best";

    let cookies = settings::cookies_args(&settings);
    let mut args: Vec<&str> = vec![
        "-g",
        "--no-warnings",
        "--no-playlist",
        "-f",
        format_spec,
    ];
    for c in &cookies {
        args.push(c.as_str());
    }
    args.push(trimmed);

    let output = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar resolve: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("yt-dlp -g failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.lines().last().unwrap_or("(no stderr)").trim();
        return Err(format!("yt-dlp -g: {tail}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let urls: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();

    let first = urls
        .first()
        .ok_or("yt-dlp returned no stream URLs")?
        .to_string();

    // Heuristic: yt-dlp returns 1 URL for muxed, 2 for separate
    // streams (video then audio). We can't easily tell from the URL
    // alone whether audio is included — but the format spec above
    // biases toward muxed, so 1 URL almost always means has_audio.
    let has_audio = urls.len() == 1;

    Ok(StreamUrl {
        url: first,
        has_audio,
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Open / create the library DB synchronously at startup so
            // the first command call doesn't race the pool initialization.
            // block_on inside setup is the standard Tauri pattern for
            // "async init that the rest of the app depends on."
            let app_handle = app.handle().clone();
            let lib_state = tauri::async_runtime::block_on(async {
                library::init(&app_handle).await
            })?;
            app.manage(lib_state);
            // Settings init is synchronous (just reads a tiny JSON file
            // or accepts defaults). Failure here also accepts defaults
            // — same philosophy as in settings::init.
            let settings_state = settings::init(&app_handle)?;
            app.manage(settings_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            binaries_version,
            yt_fetch_metadata,
            yt_resolve_stream_url,
            yt_download,
            media_transcode,
            media_extract_thumbnail,
            library::library_insert,
            library::library_list,
            library::library_count,
            library::library_delete,
            library::library_set_thumbnail,
            library::library_thumbnails_missing,
            library::library_siblings,
            library::tag_set_for_asset,
            library::tag_list_all,
            library::project_create,
            library::project_list,
            library::project_rename,
            library::project_delete,
            library::project_finish,
            library::asset_set_project,
            library::library_find_by_url,
            settings::settings_get,
            settings::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
