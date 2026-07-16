//! Thumbnail + waveform extraction (0.5.1 / 1.2.0) — extracted from lib.rs
//! (1.12.1 monolith split). Both pull a single representative still (a JPEG
//! frame for video, a showwavespic PNG for audio) into `_thumbnails/` and
//! hand the path to `library_set_thumbnail`.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;

use crate::{settings, tools};

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
pub async fn media_extract_thumbnail(
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

    let ffmpeg = tools::ffmpeg_command(&app)?;

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

/// 1.12.x — fetch the platform's own thumbnail (the YouTube/X CDN art
/// from yt-dlp metadata) and store it as the asset's local thumbnail.
/// The platform art is what the user saw when they picked the video, so
/// a library card matching it beats a mid-clip frame grab. Downloads to
/// a temp sidecar, then normalizes through ffmpeg into the standard
/// 480px `_thumbnails/<asset_id>.jpg` (ffmpeg sniffs the container from
/// content, so webp/png/jpg CDNs all work). The caller falls back to
/// `media_extract_thumbnail` when the URL is missing or this fails.
#[tauri::command]
pub async fn media_fetch_thumbnail(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
    asset_id: String,
) -> Result<ThumbnailResult, String> {
    if url.trim().is_empty() {
        return Err("url is empty".into());
    }
    if asset_id.trim().is_empty() {
        return Err("asset_id is empty".into());
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let thumb_dir = settings::content_root(&settings, &home).join("_thumbnails");
    std::fs::create_dir_all(&thumb_dir).map_err(|e| format!("create thumbnails dir: {e}"))?;

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("thumbnail fetch: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("thumbnail fetch: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("thumbnail read: {e}"))?;
    if bytes.is_empty() {
        return Err("thumbnail fetch: empty body".into());
    }
    let tmp_path = thumb_dir.join(format!("{asset_id}.src"));
    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("write temp thumbnail: {e}"))?;

    let out_path = thumb_dir.join(format!("{asset_id}.jpg"));
    let out_path_str = out_path
        .to_str()
        .ok_or("thumbnail path is not valid UTF-8")?
        .to_string();
    let tmp_str = tmp_path
        .to_str()
        .ok_or("temp thumbnail path is not valid UTF-8")?
        .to_string();

    let ffmpeg = tools::ffmpeg_command(&app)?;
    let args: Vec<&str> = vec![
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", tmp_str.as_str(),
        "-frames:v", "1",
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
    let _ = std::fs::remove_file(&tmp_path);
    if exit_code != Some(0) {
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no stderr)".into());
        return Err(format!("ffmpeg thumbnail convert failed: {tail}"));
    }
    Ok(ThumbnailResult { path: out_path_str })
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
pub async fn media_extract_waveform(
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

    let ffmpeg = tools::ffmpeg_command(&app)?;

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

