// Media Hub — Rust backend entry.
//
// Milestone 0.1: `binaries_version` smoke test (proves sidecar pipeline).
// Milestone 0.2 in progress: `yt_fetch_metadata` (paste URL → metadata card).

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
// 0.2 — Download with streaming progress
// =====================================================================
//
// yt-dlp is spawned (not awaited as one blob) so we can read its stdout
// line by line while the download runs. We instruct yt-dlp to emit
// machine-parseable progress lines with a custom prefix, parse them in
// Rust, and forward structured events to the renderer via Tauri's event
// system. The renderer subscribes with @tauri-apps/api/event `listen`.
//
// Destination is still hardcoded to ~/Media Hub/Downloads/_test/ for
// this slice; proper Library/Project routing lands with milestone 0.6.

#[derive(Serialize)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct ProgressEvent {
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
    url: String,
    format_spec: String,
    merge_container: Option<String>,
    total_bytes_hint: Option<u64>,
    video_id: String,
    in_sec: Option<f64>,
    out_sec: Option<f64>,
) -> Result<DownloadResult, String> {
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

    // Resolve destination dir. Hardcoded for MVD — the real picker comes
    // with the active-project / library work in 0.6.
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let dest = home.join("Media Hub").join("Downloads").join("_test");
    std::fs::create_dir_all(&dest).map_err(|e| format!("create dest dir: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();
    // Force yt-dlp's temp files (during merges and section trims) into
    // our dest dir so the filesystem-polling progress task can see them.
    // Without this, segment downloads stage in a hidden temp dir and the
    // bar sits at 0 the whole time.
    let temp_paths_arg = format!("temp:{}", dest_str);

    // Segment validation: both must be set together (one without the
    // other is meaningless), and in must be strictly before out.
    let segment = match (in_sec, out_sec) {
        (Some(i), Some(o)) if o > i && i >= 0.0 => Some((i, o)),
        (Some(_), Some(_)) => return Err("In must be < Out and both >= 0".into()),
        (None, None) => None,
        _ => return Err("Specify both In and Out, or neither".into()),
    };

    // Output template — include segment range in the filename when set
    // so re-downloading a different slice doesn't overwrite the previous.
    let template_path = if let Some((i, o)) = segment {
        dest.join(format!(
            "%(title).180B [%(id)s] [{}_{}].%(ext)s",
            fmt_segment_label(i),
            fmt_segment_label(o)
        ))
    } else {
        dest.join("%(title).180B [%(id)s].%(ext)s")
    };
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
        tokio::spawn(async move {
            let mut last_bytes: u64 = 0;
            let mut last_time = Instant::now();
            // First emit fires after the first sleep — gives yt-dlp ~500ms
            // to actually start writing before we report 0/0.
            while running.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if !running.load(Ordering::Relaxed) {
                    break;
                }
                let bytes_now = sum_live_dir_bytes(&dest, &video_id);
                let now = Instant::now();
                let dt = now.duration_since(last_time).as_secs_f64();
                let db = bytes_now.saturating_sub(last_bytes);
                let speed = if dt > 0.0 && db > 0 {
                    Some((db as f64 / dt) as u64)
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
                        downloaded_bytes: bytes_now,
                        total_bytes: total_hint,
                        percent,
                        speed_bps: speed,
                        eta_sec: eta,
                    },
                );
                last_bytes = bytes_now;
                last_time = now;
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

    // Post-download trim step (only when segment is set).
    //
    // Approach: `ffmpeg -ss <in> -i <full> -t <dur> -c copy <segment>`
    // - `-ss BEFORE -i`: fast-seek (decoder-level) to the nearest
    //   keyframe at or before <in>. The first second or two of output
    //   may be a hair earlier than the user requested, which is
    //   actually useful for editing (lead-in frames).
    // - `-c copy`: byte-copy both streams — no re-encode, no quality
    //   loss, runs at I/O speed (~5-15s for a 1GB file).
    // - `-t <duration>`: stop after that many seconds. Using `-t`
    //   instead of `-to` is more reliable across ffmpeg versions when
    //   combined with input seek.
    let final_path = if let Some((in_sec, out_sec)) = segment {
        // Stop the progress poller — download phase is complete. Emit
        // one last "100%" progress so the bar parks at the top during
        // the trim instead of falling back to indeterminate.
        running.store(false, Ordering::Relaxed);
        if let Some(total) = total_bytes_hint {
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
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
        let seg_name = format!(
            "{} [{}_{}].{}",
            stem,
            fmt_segment_label(in_sec),
            fmt_segment_label(out_sec),
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
            return Err(format!("ffmpeg trim failed: {tail}"));
        }

        // Trim succeeded — delete the full intermediate. We don't keep
        // it for now (user explicitly asked for a segment). A future
        // "keep source" setting could change this.
        let _ = std::fs::remove_file(&full_path);

        seg_path_str
    } else {
        full_path
    };

    let bytes = std::fs::metadata(&final_path).ok().map(|m| m.len());
    Ok(DownloadResult {
        path: final_path,
        bytes,
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
            yt_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
