// Media Hub — Rust backend entry.
//
// Milestone 0.1: `binaries_version` smoke test (proves sidecar pipeline).
// Milestone 0.2 in progress: `yt_fetch_metadata` (paste URL → metadata card).

mod bridge;
mod direct;
mod library;
mod settings;
mod updater;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// =====================================================================
// 1.0.1 — Cancel in-flight downloads
// =====================================================================
//
// JobRegistry holds the CommandChild for every active yt-dlp process,
// keyed by job_id. A separate `canceled` set remembers job_ids the user
// has explicitly canceled, so when yt_download's event loop exits with
// a non-zero code we can distinguish "user killed it" from "yt-dlp
// crashed" — both look the same at the process layer.
//
// Lock discipline: take the mutex, mutate, drop immediately. Never hold
// across await points. The map values (CommandChild) are removed via
// `.remove()` so we own them before calling `.kill()` (which consumes
// the handle).
pub struct JobRegistry {
    pub children: Mutex<HashMap<String, CommandChild>>,
    pub canceled: Mutex<HashSet<String>>,
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self {
            children: Mutex::new(HashMap::new()),
            canceled: Mutex::new(HashSet::new()),
        }
    }
}

/// Remove a job's child handle from the registry (no-op if absent).
fn registry_remove(registry: &JobRegistry, job_id: &str) -> Option<CommandChild> {
    registry
        .children
        .lock()
        .ok()
        .and_then(|mut m| m.remove(job_id))
}

/// True if the user has flagged this job_id for cancellation since the
/// last call to `registry_take_canceled`. The flag is one-shot — reading
/// also clears it so a follow-up job with the same id (rare, but
/// possible on retry) starts clean.
fn registry_take_canceled(registry: &JobRegistry, job_id: &str) -> bool {
    registry
        .canceled
        .lock()
        .map(|mut s| s.remove(job_id))
        .unwrap_or(false)
}

#[tauri::command]
fn yt_download_cancel(
    registry: tauri::State<'_, JobRegistry>,
    job_id: String,
) -> Result<bool, String> {
    // Mark canceled FIRST so the event loop in yt_download (which will
    // see the killed process land as a Terminated event) can tell the
    // difference between user-cancel and real failure.
    if let Ok(mut set) = registry.canceled.lock() {
        set.insert(job_id.clone());
    }
    match registry_remove(&registry, &job_id) {
        Some(child) => {
            child
                .kill()
                .map_err(|e| format!("kill yt-dlp: {e}"))?;
            Ok(true)
        }
        // Job not in registry — either it already finished, never
        // started, or was never registered (single-URL flow with a
        // missing id). Not an error from the frontend's perspective.
        None => Ok(false),
    }
}

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
    // yt-dlp routes through the updater resolver so the version we report
    // reflects the managed (auto-updated) binary when present. ffmpeg has
    // no auto-updater, so it stays on the bundled sidecar.
    let resolved = if sidecar == "yt-dlp" {
        updater::resolve_yt_dlp(app)
    } else {
        shell
            .sidecar(sidecar)
            .map_err(|e| format!("sidecar resolve failed: {e}"))
    };
    let cmd = match resolved {
        Ok(c) => c,
        Err(e) => {
            return SidecarVersion {
                name: sidecar.to_string(),
                version: String::new(),
                ok: false,
                error: Some(e),
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

    // 1.2.16 — prefer the auto-updated managed binary, fall back to the
    // bundled sidecar. See updater::resolve_yt_dlp.
    let cmd = updater::resolve_yt_dlp(&app)?;

    // Cookies extras (0.8.B): empty when source is None, otherwise
    // adds --cookies-from-browser <name> or --cookies <path>.
    // Owned strings because .args() needs &str references that outlive
    // the call.
    let cookies = settings::cookies_args(&settings);
    // 1.0.3 — TV client first, web fallback. Lets a chunk of
    // age-restricted videos resolve metadata without cookies at all.
    let yt_args = settings::youtube_extractor_args();
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
    for a in &yt_args {
        args.push(a.as_str());
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
        return Err(settings::translate_ytdlp_error(&tail));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    // 1.2.7 — yt-dlp's `-j` flag emits ONE JSON object per video,
    // newline-separated. For multi-video tweets (e.g. an X post
    // containing 3 videos), stdout is 3 JSON objects in a row;
    // serde_json::from_str only consumes the first and errors out
    // with "trailing characters at line N column 1" on the rest.
    //
    // Streaming parser to the rescue — take the first complete
    // RawYtDlp and ignore the trailing values. The download command
    // (`yt_download`) handles multi-media tweets on its own; here
    // we just need representative metadata for the card.
    let raw: RawYtDlp = serde_json::Deserializer::from_str(&stdout)
        .into_iter::<RawYtDlp>()
        .next()
        .ok_or_else(|| "yt-dlp returned no JSON".to_string())?
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
// 1.1 — Playlist enumeration
// =====================================================================
//
// `yt_fetch_playlist` runs `yt-dlp --flat-playlist -J <url>` to list
// the videos in a playlist without extracting per-video formats. Fast
// (a few seconds even for big playlists). Returns enough info per
// entry to render a multi-select picker; the actual format pick + full
// metadata fetch happens later when each selected entry runs through
// the normal yt_fetch_metadata + yt_download pipeline as its own job.
//
// Why flat:
//   - `-j` (per-video JSON dump) on a 200-video playlist takes minutes
//     because it makes 200 network calls to fetch full metadata.
//   - `--flat-playlist` enumerates from the playlist page's HTML in a
//     single request and gives us title / duration / thumbnail / id —
//     enough for the picker UI.
//
// Channel URLs (`/@channel/videos`) are deliberately not supported —
// they're effectively unbounded and "enqueue all videos by this
// channel" isn't what 1.1 is for. The frontend should refuse to call
// this with channel URLs; we also defensive-cap at 500 entries here
// so a misuse doesn't lock the UI.

#[derive(Serialize, Debug, Clone)]
pub struct PlaylistInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub entry_count: u32,
    pub entries: Vec<PlaylistEntry>,
    /// True when we truncated the result. Frontend should surface a
    /// "showing first N of M" notice + an option to load more (later).
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    /// The per-video URL the queue should enqueue. yt-dlp's
    /// `--flat-playlist` populates `url` (canonical watch URL) or
    /// `webpage_url`; we prefer the former, fall back to the latter,
    /// or synthesize from `id` as last resort.
    pub url: String,
    /// True when yt-dlp marked the entry as unavailable (private,
    /// deleted, region-blocked). UI grays these out and skips them
    /// from default selection.
    pub unavailable: bool,
}

const PLAYLIST_CAP: usize = 500;

#[derive(Deserialize, Debug)]
struct RawPlaylist {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    entries: Vec<RawPlaylistEntry>,
    /// yt-dlp's `playlist_count` when present is the authoritative
    /// total. Fall back to entries.len() when missing.
    #[serde(default)]
    playlist_count: Option<u32>,
}

#[derive(Deserialize, Debug)]
struct RawPlaylistEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnails: Vec<RawThumbnail>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    /// yt-dlp sets `availability` to e.g. "private", "unlisted",
    /// "needs_subscription". Anything not None and not "public" we
    /// flag as potentially unavailable.
    #[serde(default)]
    availability: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RawThumbnail {
    #[serde(default)]
    url: Option<String>,
}

#[tauri::command]
async fn yt_fetch_playlist(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
) -> Result<PlaylistInfo, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    // 1.2.16 — prefer the auto-updated managed binary (see updater).
    let cmd = updater::resolve_yt_dlp(&app)?;

    // Same cookies + extractor-args plumbing as the metadata fetch so
    // private / members-only / region-flavored playlists work the same
    // way as the rest of the app.
    let cookies = settings::cookies_args(&settings);
    let yt_args = settings::youtube_extractor_args();
    let mut args: Vec<&str> = vec![
        "-J",                  // dump as single JSON object (playlist + entries)
        "--flat-playlist",     // skip per-video format extraction (huge speedup)
        "--no-warnings",
        "--no-call-home",
        "--socket-timeout", "30",
    ];
    for c in &cookies {
        args.push(c.as_str());
    }
    for a in &yt_args {
        args.push(a.as_str());
    }
    args.push("--");
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
        return Err(settings::translate_ytdlp_error(&tail));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let raw: RawPlaylist = serde_json::from_str(&stdout)
        .map_err(|e| format!("playlist JSON parse failed: {e}"))?;

    let total = raw.playlist_count.unwrap_or(raw.entries.len() as u32);
    let truncated = raw.entries.len() > PLAYLIST_CAP;
    let take_n = raw.entries.len().min(PLAYLIST_CAP);

    let entries: Vec<PlaylistEntry> = raw
        .entries
        .into_iter()
        .take(take_n)
        .map(|e| {
            let id = e.id.clone().unwrap_or_default();
            // Prefer the flat-playlist `url` (canonical watch URL),
            // then `webpage_url`, then synthesize from id.
            let url = e
                .url
                .clone()
                .or(e.webpage_url.clone())
                .unwrap_or_else(|| {
                    if id.is_empty() {
                        String::new()
                    } else {
                        format!("https://www.youtube.com/watch?v={id}")
                    }
                });
            // Pick the largest-looking thumbnail when an array was
            // provided (yt-dlp orders smallest-first usually, but we
            // just take the last one — last-is-largest is the
            // long-standing yt-dlp convention).
            let thumbnail = e
                .thumbnail
                .clone()
                .or_else(|| e.thumbnails.last().and_then(|t| t.url.clone()));
            let unavailable = e
                .availability
                .as_deref()
                .map(|a| !matches!(a, "public" | ""))
                .unwrap_or(false);
            PlaylistEntry {
                id,
                title: e.title.unwrap_or_else(|| "(no title)".to_string()),
                channel: e.channel.or(e.uploader),
                duration_sec: e.duration,
                thumbnail,
                url,
                unavailable,
            }
        })
        // Drop entries with no usable URL — they'd just fail at queue time.
        .filter(|e| !e.url.is_empty())
        .collect();

    Ok(PlaylistInfo {
        id: raw.id.unwrap_or_default(),
        title: raw
            .title
            .or(raw.uploader.clone())
            .or(raw.channel)
            .unwrap_or_else(|| "(untitled playlist)".to_string()),
        uploader: raw.uploader,
        entry_count: total,
        entries,
        truncated,
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
    registry: tauri::State<'_, JobRegistry>,
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
    // 1.2.0 — audio-only mode. When Some("mp3"|"m4a"|"flac"),
    // swaps the yt-dlp args to extract audio and convert to that
    // container. `format_spec` should typically be "bestaudio/best"
    // in this case but isn't enforced — the renderer picks. We
    // skip --merge-output-format (single-stream output) and the
    // container allowlist clause.
    audio_format: Option<String>,
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

    // PYTHONUNBUFFERED disables Python's block-buffering of stdout when
    // the process is piped (not attached to a TTY). yt-dlp.exe is a
    // PyInstaller bundle and honors this env var — without it, progress
    // lines sit in the buffer until the process exits, defeating the
    // whole point of streaming.
    //
    // 1.2.14 — REVERTED a "stabilizer" attempt that added
    // PYTHONIOENCODING + PYTHONDONTWRITEBYTECODE. Those env vars
    // confused PyInstaller's bundled Python bootloader and crashed
    // every download. Keeping only the original safe PYTHONUNBUFFERED.
    //
    // 1.2.16 — prefer the auto-updated managed binary (see updater).
    let cmd = updater::resolve_yt_dlp(&app)?.env("PYTHONUNBUFFERED", "1");

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
    // 1.0.3 — TV-client-first extractor args. See youtube_extractor_args
    // doc for why. Owned outside the loop so the &str references survive.
    let yt_args = settings::youtube_extractor_args();
    for a in &yt_args {
        args.push(a.as_str());
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
    // Skipped in audio mode (single-stream output, no merge needed).
    let audio_fmt_owned = audio_format
        .as_deref()
        .map(str::trim)
        .filter(|f| matches!(*f, "mp3" | "m4a" | "flac"))
        .map(|f| f.to_string());
    let container_owned = if audio_fmt_owned.is_some() {
        None
    } else {
        merge_container
            .as_deref()
            .map(str::trim)
            .filter(|c| matches!(*c, "mp4" | "webm" | "mkv" | "m4a"))
            .map(|c| c.to_string())
    };
    if let Some(ref c) = container_owned {
        args.push("--merge-output-format");
        args.push(c.as_str());
    }

    // 1.2.0 — audio extraction. `-x` tells yt-dlp to strip video
    // post-download (or pick audio-only formats outright). `--audio-format`
    // converts to the desired container via ffmpeg (which is already
    // configured via --ffmpeg-location above). `--audio-quality 0` is
    // yt-dlp's "best" — 320k VBR for MP3, original for M4A passthrough,
    // lossless for FLAC.
    if let Some(ref fmt) = audio_fmt_owned {
        args.push("-x");
        args.push("--audio-format");
        args.push(fmt.as_str());
        args.push("--audio-quality");
        args.push("0");
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
    let (mut rx, child) = cmd
        .args(args)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // 1.0.1: register the child so `yt_download_cancel(job_id)` can
    // kill it. Only jobs with an explicit job_id are cancelable — the
    // batch queue always supplies one, the single-URL flow now also
    // synthesizes one (`single-url`). Jobs without an id stay
    // un-killable (no UI to cancel them anyway).
    if let Some(jid) = job_id.as_ref() {
        if let Ok(mut map) = registry.children.lock() {
            map.insert(jid.clone(), child);
        }
        // If the lock somehow poisoned, we lose the kill handle but
        // the download proceeds normally. Document but don't panic.
    } else {
        // No job_id — drop the child handle. The process keeps running
        // until natural completion (drop doesn't kill in
        // tauri-plugin-shell).
        drop(child);
    }

    let mut final_path: Option<String> = None;
    let mut stderr_tail: Vec<String> = Vec::new();
    // 1.2.14 — also tail stdout. PyInstaller-bundled yt-dlp can
    // write the actual Python traceback to stdout when it crashes
    // during bootstrap (the only stderr line is the cryptic
    // "[PYI-...] Failed to execute script '__main__'"). Storing
    // both lets us surface the real cause on failure.
    let mut stdout_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let line = line.trim();
                if let Some(path) = line.strip_prefix("[mh-filepath] ") {
                    final_path = Some(path.trim().to_string());
                } else if !line.is_empty() {
                    // Skip the noisy progress chatter; only keep lines
                    // that look like errors / unusual messages. yt-dlp's
                    // normal stdout doesn't print much when we suppress
                    // warnings, so this is mostly tracebacks anyway.
                    stdout_tail.push(line.to_string());
                    if stdout_tail.len() > 50 {
                        stdout_tail.remove(0);
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

    // Process has terminated — unregister the child handle. Best-effort:
    // if cancel raced us to remove it, that's fine. If we never inserted
    // (no job_id), nothing to remove.
    if let Some(jid) = job_id.as_ref() {
        let _ = registry_remove(&registry, jid);
    }

    // 1.0.1: distinguish user-cancel from a real yt-dlp failure. Both
    // produce a non-zero exit code (kill = signal exit on unix, exit
    // code 1 on windows), so we check the canceled-flag set instead.
    if let Some(jid) = job_id.as_ref() {
        if registry_take_canceled(&registry, jid) {
            return Err("__canceled__".to_string());
        }
    }

    if exit_code != Some(0) {
        // 1.2.14 — Combine stderr + stdout tails. PyInstaller
        // crashes during yt-dlp bootstrap write the actual Python
        // traceback to STDOUT and only the cryptic
        // "[PYI-...:ERROR] Failed to execute script" to stderr.
        // Show both so the chip shows the real exception.
        let stderr_tail_str: Vec<String> = stderr_tail
            .iter()
            .rev()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let stdout_tail_str: Vec<String> = stdout_tail
            .iter()
            .rev()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let mut parts: Vec<String> = Vec::new();
        if !stderr_tail_str.is_empty() {
            parts.push(format!("[stderr] {}", stderr_tail_str.join(" · ")));
        }
        if !stdout_tail_str.is_empty() {
            parts.push(format!("[stdout] {}", stdout_tail_str.join(" · ")));
        }
        let tail = if parts.is_empty() {
            format!("exit code {:?}, no output", exit_code)
        } else {
            parts.join(" || ")
        };
        return Err(settings::translate_ytdlp_error(&tail));
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

    // Delete the source on successful transcode (2026-05-22). The
    // transcoded output is what we record in the library and what the
    // user actually opens in their NLE — keeping the pre-transcode
    // source around just doubles disk usage for no editing-workflow
    // benefit. Best-effort: log on failure but don't break the call
    // (user still got their transcode; orphan file is just clutter).
    //
    // Only fires when paths differ — defensive against a hypothetical
    // future preset whose output path collides with input.
    if src_path != out_path_str {
        if let Err(e) = std::fs::remove_file(&src_path) {
            eprintln!(
                "media_transcode: couldn't delete source {src_path}: {e}"
            );
        }
    }

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
// Waveform thumbnail extraction (1.2.0 — audio)
// =====================================================================
//
// For audio-only assets, "thumbnail" is a slim waveform PNG generated
// from ffmpeg's `showwavespic` filter. Same on-disk shape as the video
// thumbnail (~30-80 KB JPG/PNG in _thumbnails/<asset_id>.png), same
// wiring through library_set_thumbnail so the rest of the app
// (grid card, drawer, project covers) treats it identically.
//
// Visual: lime accent on transparent background, mono-mixed so stereo
// files don't have two stacked traces. compand applied for visual
// punch — without it, dynamic-range-compressed pop music produces a
// nearly-solid rectangle.

#[tauri::command]
async fn media_extract_waveform(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    src_path: String,
    asset_id: String,
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
    let thumb_dir = settings::content_root(&settings, &home).join("_thumbnails");
    std::fs::create_dir_all(&thumb_dir).map_err(|e| format!("create thumbnails dir: {e}"))?;
    // PNG (not JPG) — transparent background so the card's dark
    // surface shows through and the waveform doesn't sit on a black
    // rectangle. PNG also handles single-color line art at any
    // resolution with no compression artifacts.
    let out_path = thumb_dir.join(format!("{asset_id}.png"));
    let out_path_str = out_path
        .to_str()
        .ok_or("waveform path is not valid UTF-8")?
        .to_string();

    let ffmpeg = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar resolve ffmpeg: {e}"))?;

    // Filter chain:
    //   aformat=channel_layouts=mono  — collapse stereo so we get a
    //                                   single trace, not two.
    //   compand=...                   — visual companding so quiet
    //                                   tracks don't render as a flat
    //                                   line. attacks/decays kept short
    //                                   so transients are still visible.
    //   showwavespic=s=480x120:
    //     colors=#c5ff3d              — lime accent matches the app.
    //     scale=lin                   — linear (not log) scale; reads
    //                                   the way users expect for music.
    let filter = "aformat=channel_layouts=mono,\
                  compand=attacks=0:points=-90/-90|-50/-30|0/-5,\
                  showwavespic=s=480x120:colors=#c5ff3d:scale=lin";
    let args: Vec<&str> = vec![
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", src_path.as_str(),
        "-filter_complex", filter,
        "-frames:v", "1",
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
        return Err(format!("ffmpeg waveform failed: {tail}"));
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

    // The format spec biases toward muxed streams the browser can
    // play. Falls back twice before giving up — final "best" is
    // always defined for any playable YouTube URL.
    let format_spec =
        "best[ext=mp4][height<=720]/best[ext=mp4]/best[height<=720]/best";

    let cookies = settings::cookies_args(&settings);
    // 1.0.3 — TV-client-first. Scrubber stream resolution benefits
    // from the same age-gate bypass as the main download flow.
    let yt_args = settings::youtube_extractor_args();
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
    for a in &yt_args {
        args.push(a.as_str());
    }
    args.push(trimmed);

    // 1.2.16 — prefer the auto-updated managed binary (see updater).
    let output = updater::resolve_yt_dlp(&app)?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("yt-dlp -g failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.lines().last().unwrap_or("(no stderr)").trim();
        return Err(settings::translate_ytdlp_error(tail));
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
// 1.2.3 — Deep-link (mediahub://) URL handling
// =====================================================================
//
// The browser-extension MVP doesn't strictly need this — the localhost
// HTTP bridge already handles "enqueue this URL" while the app is
// running. Deep links cover the case where the app is NOT running:
// the browser fires `mediahub://enqueue?url=...&token=...`, Windows
// launches media-hub.exe with the URL as argv[1], the single-instance
// plugin forwards it to the running window (or starts a fresh one),
// and we parse + dispatch the same `bridge:enqueue` event the HTTP
// path uses.
//
// URL shape:
//   mediahub://enqueue?url=<urlencoded>&audio_format=mp3&project_id=abc&token=<token>
//
// Auth: the bridge token is required as a query param. Deep links
// can't carry headers, so the URL is the only auth channel. The
// browser extension will inject the token before opening the URL.
//
// Without token check, ANY website could fire a mediahub:// link via
// `<a href="mediahub://...">` and forcibly enqueue malicious URLs.
// Token gates that off (drive-by sites don't know your token).

fn parse_deeplink_url(raw: &str) -> Option<(String, Option<String>, Option<String>, String)> {
    // Strict prefix match. Anything else → no-op.
    let stripped = raw.strip_prefix("mediahub://")?;
    // Split path from query: "enqueue?url=...&token=..."
    let (path, query) = match stripped.split_once('?') {
        Some((p, q)) => (p.trim_end_matches('/'), q),
        None => (stripped.trim_end_matches('/'), ""),
    };
    if path != "enqueue" {
        eprintln!("[deeplink] unknown action: {}", path);
        return None;
    }
    // Tiny query parser — pulls url, audio_format, project_id, token.
    // We percent-decode values via the `url` crate which is already
    // a transitive dep of tauri.
    let mut url = String::new();
    let mut audio_format: Option<String> = None;
    let mut project_id: Option<String> = None;
    let mut token = String::new();
    for pair in query.split('&') {
        let (k, v) = match pair.split_once('=') {
            Some(kv) => kv,
            None => continue,
        };
        // Decode percent-encoded value. Failure → skip the param.
        let decoded = percent_decode(v).unwrap_or_else(|| v.to_string());
        match k {
            "url" => url = decoded,
            "audio_format" => audio_format = Some(decoded),
            "project_id" => project_id = Some(decoded),
            "token" => token = decoded,
            _ => {}
        }
    }
    if url.is_empty() {
        eprintln!("[deeplink] missing url param");
        return None;
    }
    Some((url, audio_format, project_id, token))
}

/// Minimal percent decoder for the deep-link query string. Avoids
/// pulling a fresh dep — we only handle ASCII + the standard
/// `%xx` escapes, which is all browsers emit for query strings.
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16)?;
                let lo = (bytes[i + 2] as char).to_digit(16)?;
                out.push(((hi << 4) | lo) as u8);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Dedupe window for deep-link dispatches. On Windows the same URL
/// arrives via two channels — the single-instance plugin's CLI-arg
/// forward AND the deep-link plugin's `on_open_url` event — so each
/// click was firing twice (observed 1.2.3 first ship: every deep-
/// linked URL appeared twice in the queue). Tracking the last-seen
/// URL with a 2s expiry collapses the duplicates without needing to
/// gate channels per-platform.
fn deeplink_recently_seen(url: &str) -> bool {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    let mut guard = match LAST.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let now = Instant::now();
    if let Some((prev_url, prev_at)) = guard.as_ref() {
        if prev_url == url && now.duration_since(*prev_at) < Duration::from_secs(2) {
            return true;
        }
    }
    *guard = Some((url.to_string(), now));
    false
}

/// Dispatch a parsed deep-link URL through the same path the HTTP
/// bridge uses. We re-validate the token against settings here —
/// the URL came from outside the trust boundary.
fn dispatch_deeplink(app: &AppHandle, raw_url: &str) {
    if deeplink_recently_seen(raw_url) {
        eprintln!("[deeplink] duplicate within 2s — skipping");
        return;
    }
    let Some((url, audio_format, project_id, token)) = parse_deeplink_url(raw_url) else {
        return;
    };

    // Token check. Pull from settings; if the user disabled the
    // bridge, deep links are also disabled (mirrors HTTP behavior).
    let (expected_token, enabled) = match app.try_state::<settings::SettingsState>() {
        Some(s) => match s.inner.lock() {
            Ok(g) => (g.bridge_token.clone(), g.bridge_enabled),
            Err(_) => return,
        },
        None => return,
    };
    if !enabled {
        eprintln!("[deeplink] bridge disabled in settings — ignoring URL");
        return;
    }
    if expected_token.is_empty() || token != expected_token {
        eprintln!("[deeplink] invalid token — ignoring URL");
        return;
    }

    // Normalize audio_format to the same allowlist the HTTP path uses.
    let audio_format = audio_format
        .as_deref()
        .map(str::trim)
        .filter(|s| matches!(*s, "mp3" | "m4a" | "flac"))
        .map(|s| s.to_string());

    // Emit the same event shape as bridge.rs so the React listener
    // doesn't care which channel the URL came in on.
    let payload = serde_json::json!({
        "url": url,
        "audio_format": audio_format,
        "project_id": project_id,
        "source": "deep-link",
    });
    if let Err(e) = app.emit("bridge:enqueue", payload) {
        eprintln!("[deeplink] emit failed: {e}");
    } else {
        eprintln!("[deeplink] enqueued: {}", url);
    }

    // Focus the window so the user sees the queue update. Useful
    // when the click happened while the app was minimized.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

/// Handle deep links arriving as CLI args. Used by both the
/// single-instance forward (running app) and the first-launch
/// scenario (no app running yet — the OS spawned us with the URL
/// as argv[1]). Walks every arg so it works regardless of position.
fn handle_deeplink_args(app: &AppHandle, args: &[String]) {
    for a in args {
        if a.starts_with("mediahub://") {
            dispatch_deeplink(app, a);
        }
    }
}

// =====================================================================
// 1.2.0 — OS-default "open file" (bypass plugin-opener scope)
// =====================================================================
//
// tauri-plugin-opener enforces a path allowlist via capabilities. Our
// library files can live under a user-configured root (Settings →
// library root) that may sit on any drive — `$HOME/**` doesn't cover
// E:\ or D:\ paths, and broadening the plugin scope to `**` is wider
// than we want for plugin defaults.
//
// This command is our own. Capability is implicit (commands always
// reach the renderer once registered). Path arrives from the asset
// row in our own DB, so it's a path we already wrote there during
// download — trust boundary is "the library is the trust boundary."
//
// Windows: `cmd /c start "" "<path>"` — empty title arg is required
// so quoted paths don't get parsed as the window title.
// macOS: `open "<path>"`
// Linux: `xdg-open "<path>"`

#[tauri::command]
fn os_open_path(path: String) -> Result<(), String> {
    use std::process::Command;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".into());
    }
    if !std::path::Path::new(trimmed).exists() {
        return Err(format!("file does not exist: {trimmed}"));
    }

    #[cfg(windows)]
    let result = Command::new("cmd")
        .args(["/c", "start", "", trimmed])
        // Hide the brief cmd window flash. CREATE_NO_WINDOW = 0x08000000.
        .creation_flags(0x08000000)
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(trimmed).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(trimmed).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("os_open_path spawn failed: {e}"))
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// =====================================================================
// 1.1.7 — Direct cursor-position probe (Windows OLE-drag workaround)
// =====================================================================
//
// During `tauri-plugin-drag::startDrag` on Windows, OLE's DoDragDrop
// blocks the tao event loop. Tauri's built-in `cursorPosition()`
// command dispatches through that loop — so JS polling stalls until
// drop, defeating live folder-hover feedback in the library page.
//
// Workaround: call Win32 `GetCursorPos` directly via FFI. It works
// from any thread, doesn't touch tao/wry, and a tokio task running
// our command returns instantly even while a drag is in flight.
//
// The function exists on all desktop targets but is only ever called
// on Windows (the Library page only triggers polling during a drag,
// and the drag plugin uses OS-native drag on every platform). The
// Mac/Linux fallback returns an error which the JS side handles by
// falling back to `cursorPosition()` (which on those platforms
// doesn't have this dispatch problem in the first place).

#[derive(Serialize)]
pub struct CursorPos {
    /// X in screen-physical pixels (Windows convention).
    pub x: i32,
    pub y: i32,
}

#[cfg(windows)]
#[repr(C)]
struct Win32Point {
    x: i32,
    y: i32,
}

#[cfg(windows)]
extern "system" {
    fn GetCursorPos(point: *mut Win32Point) -> i32;
}

#[tauri::command]
fn mouse_cursor_pos() -> Result<CursorPos, String> {
    #[cfg(windows)]
    {
        let mut p = Win32Point { x: 0, y: 0 };
        // SAFETY: GetCursorPos writes two i32 fields. Win32Point is
        // exactly two i32 with #[repr(C)]; pointer is non-null and
        // properly aligned. Returns nonzero on success.
        let ok = unsafe { GetCursorPos(&mut p as *mut Win32Point) };
        if ok == 0 {
            return Err("GetCursorPos returned 0".to_string());
        }
        Ok(CursorPos { x: p.x, y: p.y })
    }
    #[cfg(not(windows))]
    {
        Err("mouse_cursor_pos: only Windows is implemented; JS falls back to Tauri cursorPosition()".to_string())
    }
}

// =====================================================================
// Tauri bootstrap
// =====================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 1.2.3 — single-instance MUST come first (per Tauri docs).
        // When the user clicks a mediahub:// link, the browser
        // launches a second media-hub.exe; this plugin detects an
        // existing instance, forwards the cli args, and exits the
        // new one — so we get one window with the new URL added to
        // its queue instead of a duplicate app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The forwarded argv contains the deep-link URL on
            // Windows/Linux. tauri-plugin-deep-link will also pick it
            // up via OnNewIntent on macOS; we just handle the OS-arg
            // case here.
            handle_deeplink_args(app, &argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // 1.1.2 — OS-level file drag-out (drag clips into Premiere/
        // Resolve/Explorer). The callback returns cursorPos so we can
        // ALSO hit-test internal drop targets (folder rows) — single
        // gesture for both internal + external. See docs/NOTES.md
        // 2026-05-24 PM for the design write-up.
        .plugin(tauri_plugin_drag::init())
        // 1.3.0 — App auto-updater. Verifies signed update bundles
        // against the public key in tauri.conf.json (see
        // `plugins.updater.pubkey`). The matching private key lives at
        // ~/.tauri/media-hub.key on the build machine, NEVER in the
        // repo. Endpoint hits GitHub Releases for latest.json. See the
        // updater::check_for_app_update / install_app_update commands +
        // docs/NOTES.md "release process" for the per-build steps.
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // 1.2.2 — spawn the browser-extension bridge HTTP server
            // before we hand ownership of settings_state to State<>.
            // Snapshot token + port + enabled flag now; later token /
            // port changes require an app restart (TODO: hot-reload).
            {
                let (token, port, enabled) = {
                    let guard = settings_state.inner.lock().ok();
                    match guard {
                        Some(g) => (g.bridge_token.clone(), g.bridge_port, g.bridge_enabled),
                        None => (String::new(), 47821, false),
                    }
                };
                if enabled && !token.is_empty() {
                    bridge::spawn(app_handle.clone(), token, port);
                } else if !enabled {
                    eprintln!("[bridge] disabled in settings — skipping server start");
                } else {
                    eprintln!("[bridge] no token configured — skipping server start");
                }
            }
            app.manage(settings_state);

            // 1.2.16 — yt-dlp engine auto-updater. Fire a silent,
            // throttled (24h) background check on every launch so testers
            // stay current with YouTube fixes without rebuilding the app.
            // Non-blocking and failure-tolerant; the bundled sidecar is
            // always the fallback. Uses tauri::async_runtime::spawn (no
            // tokio reactor in setup — same lesson as the bridge server).
            updater::spawn_startup_check(app_handle.clone());

            // 1.0.1: registry of in-flight yt-dlp children so we can
            // cancel them. Empty at startup — populated as downloads
            // spawn, drained as they finish or get killed.
            app.manage(JobRegistry::default());

            // 1.2.3 — Deep-link wiring.
            //
            // Three paths a mediahub:// URL can reach us:
            //
            //   A) App not running, user clicks link → OS launches
            //      media-hub.exe with the URL as argv[1]. We pick it
            //      up here on first launch.
            //   B) App running, user clicks link → single-instance
            //      plugin (registered above) forwards the URL via
            //      its callback — already wired up to handle_deeplink_args.
            //   C) macOS only — onOpenUrl event via the plugin's
            //      `on_open_url` handler. We subscribe below for
            //      cross-platform symmetry; on Windows this also
            //      fires when the in-process listener picks up a URL.
            //
            // For dev (`npm run tauri dev`) on Windows, the protocol
            // isn't registered in HKCR (the installer does that for
            // built apps). We call `register_all()` at runtime so the
            // user can test deep links during development — it writes
            // HKCU\Software\Classes which is per-user and survives
            // across runs. Failures are non-fatal (e.g. corporate
            // policy blocking registry writes).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[deeplink] runtime scheme registration failed: {e}");
                }
            }

            // Handle the first-launch case (path A above).
            {
                let args: Vec<String> = std::env::args().collect();
                handle_deeplink_args(&app.handle(), &args);
            }

            // Subscribe to the plugin's on_open_url event. Fires on
            // every URL the OS hands us, including the cases the
            // single-instance forward already caught — that's fine,
            // dispatch_deeplink is idempotent for repeated URLs (it
            // just enqueues again, and the user sees the second copy
            // as a duplicate-source download which the existing dedup
            // surfaces via the "already saved" chip).
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        dispatch_deeplink(&handle, url.as_str());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            binaries_version,
            yt_fetch_metadata,
            yt_fetch_playlist,
            yt_resolve_stream_url,
            yt_download,
            yt_download_cancel,
            mouse_cursor_pos,
            os_open_path,
            media_transcode,
            media_extract_thumbnail,
            media_extract_waveform,
            direct::media_direct_download,
            library::library_insert,
            library::library_list,
            library::library_count,
            library::library_delete,
            library::library_delete_many,
            library::library_remove_missing,
            library::library_trash_count,
            library::library_trash_restore,
            library::library_trash_empty,
            library::library_set_thumbnail,
            library::library_thumbnails_missing,
            library::library_repair_thumbnails,
            library::library_scan_orphans,
            library::library_clean_orphans,
            library::library_siblings,
            library::tag_set_for_asset,
            library::tag_list_all,
            library::project_create,
            library::project_dir,
            library::project_list,
            library::project_rename,
            library::project_delete,
            library::project_finish,
            library::asset_set_project,
            library::folder_create,
            library::folder_list,
            library::folder_rename,
            library::folder_delete,
            library::asset_set_folder,
            library::asset_set_folder_many,
            library::library_find_by_url,
            library::library_migrate_root,
            settings::settings_get,
            settings::settings_set,
            settings::cookies_validate,
            updater::yt_dlp_update_now,
            updater::yt_dlp_engine_info,
            updater::check_for_app_update,
            updater::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
