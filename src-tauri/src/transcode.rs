//! Transcode pipeline (0.3) — extracted from lib.rs (1.12.1 monolith split).
//!
//! Spawns the managed ffmpeg to convert a downloaded file into an edit-
//! friendly intermediate (ProRes / DNxHR) or a smaller MP4. The encode
//! preset is decoded server-side from an allowlisted string so the renderer
//! can't inject arbitrary ffmpeg arguments. Progress comes from ffmpeg's
//! `-progress pipe:1` (structured key=value lines), emitted as
//! `transcode:progress` events.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;

use crate::{diag, tools};

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
pub(crate) fn resolve_preset(preset: &str) -> Result<(Vec<&'static str>, &'static str, &'static str), String> {
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
pub async fn media_transcode(
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
    let ffmpeg = tools::ffmpeg_command(&app)?;

    let mut args: Vec<&str> = vec![
        "-y",                // overwrite output if it exists
        "-hide_banner",      // skip the version/copyright preamble
        "-loglevel", "warning",
        "-progress", "pipe:1",
        "-nostats",          // we have our own progress; the stderr stats are noise
        // NOTE: no `-hwaccel auto`. On Windows it decodes into GPU
        // surfaces (d3d11va/dxva2), but our CPU encoders (libx264,
        // prores_ks, dnxhd) can't read GPU frames — the encoder then
        // gets zero packets and ffmpeg aborts with "at least one of its
        // streams received no packets". CPU decode is the safe default;
        // the NVENC preset is still GPU-accelerated on the encode side.
        "-i", src_path.as_str(),
        // Explicit, resilient mapping: always take the first video; take
        // the first audio only if it exists (`?`) so a video-only source
        // doesn't abort with the same "no packets" error.
        "-map", "0:v:0",
        "-map", "0:a:0?",
    ];
    args.extend(preset_args.iter());
    args.push(out_path_str.as_str());

    // Diagnostics: record the exact command so a failure report is
    // actionable without a local repro.
    diag::log(
        &app,
        "transcode",
        &format!("preset={} cmd: ffmpeg {}", preset.trim(), args.join(" ")),
    );

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
        // Diagnostics: the last stderr line alone is rarely enough to tell
        // WHY a transcode failed (esp. "a stream received no packets", which
        // depends entirely on the input). Log the full stderr + probe the
        // input's real streams so a tester's report is self-contained.
        let full_stderr = if stderr_tail.is_empty() {
            "(no stderr)".to_string()
        } else {
            stderr_tail.join("\n")
        };
        let probe = diag::probe_media(&app, &src_path).await;
        diag::log(
            &app,
            "transcode",
            &format!(
                "FAILED exit={:?} src={}\n--- ffmpeg stderr ---\n{}\n--- input probe ---\n{}",
                exit_code, src_path, full_stderr, probe
            ),
        );
        let tail = stderr_tail
            .last()
            .cloned()
            .unwrap_or_else(|| "(no stderr)".into());
        return Err(format!(
            "ffmpeg failed: {tail} — details saved to the diagnostics log (Settings → Diagnostics → Open logs)"
        ));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_resolve_known_and_reject_unknown() {
        let (_, ext, suffix) = resolve_preset("h264_mp4").unwrap();
        assert_eq!((ext, suffix), ("mp4", "h264"));
        assert_eq!(resolve_preset("prores_422_lt").unwrap().1, "mov");
        assert_eq!(resolve_preset("dnxhr_sq").unwrap().2, "dnxhrsq");
        assert_eq!(resolve_preset("h264_nvenc_mp4").unwrap().1, "mp4");
        // Guards against the renderer smuggling arbitrary ffmpeg flags.
        assert!(resolve_preset("rm -rf /").is_err());
        assert!(resolve_preset("").is_err());
    }
}
