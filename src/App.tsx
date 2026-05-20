import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";

// =====================================================================
// Types — kept in sync with src-tauri/src/lib.rs serializers
// =====================================================================

type SidecarVersion = {
  name: string;
  version: string;
  ok: boolean;
  error: string | null;
};

type FormatOption = {
  id: string;
  ext: string;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  filesize_bytes: number | null;
  note: string | null;
  has_video: boolean;
  has_audio: boolean;
};

type VideoMetadata = {
  id: string;
  title: string;
  channel: string;
  duration_sec: number | null;
  thumbnail: string | null;
  upload_date: string | null; // YYYYMMDD
  webpage_url: string;
  view_count: number | null;
  formats: FormatOption[];
};

type DownloadResult = {
  path: string;
  bytes: number | null;
};

type ProgressEvent = {
  job_id: string | null;
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
  speed_bps: number | null;
  eta_sec: number | null;
};

type TranscodeProgress = {
  job_id: string | null;
  processed_sec: number;
  total_sec: number | null;
  percent: number | null;
  speed_mult: number | null;
};

type TranscodeResult = {
  path: string;
  bytes: number | null;
};

type TranscodePreset = "none" | "prores_422_lt" | "dnxhr_sq" | "h264_mp4";

const TRANSCODE_PRESETS: { value: TranscodePreset; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "keep source as-is" },
  {
    value: "prores_422_lt",
    label: "ProRes 422 LT",
    hint: ".mov · NLE-friendly · ~100 Mbps · default for editing",
  },
  {
    value: "dnxhr_sq",
    label: "DNxHR SQ",
    hint: ".mov · Avid-native intermediate",
  },
  {
    value: "h264_mp4",
    label: "H.264 MP4 (optimized)",
    hint: ".mp4 · small file · for sharing, not editing",
  },
];

// =====================================================================
// Helpers
// =====================================================================

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtUploadDate(d: string | null): string {
  if (!d || d.length !== 8) return "—";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/**
 * Parse a flexible timestamp string into seconds.
 *
 * Accepted forms:
 *   "42"          → 42
 *   "1:30"        → 90        (mm:ss)
 *   "1:02:30"     → 3750      (hh:mm:ss)
 *   "01:30.500"   → 90.5      (fractional seconds optional anywhere)
 *   ""            → null      (caller treats as "unset")
 *
 * Returns null for invalid input.
 */
function parseTimestamp(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n) || n < 0) return null;
    // Largest unit first: hh:mm:ss, mm:ss, or just seconds
    const mult = Math.pow(60, parts.length - 1 - i);
    total += n * mult;
  }
  return total;
}

function fmtEta(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${s.toString().padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${(m % 60).toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

// =====================================================================
// Smoke-test card (0.1)
// =====================================================================

function SmokeCard() {
  const [results, setResults] = useState<SidecarVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runSmokeTest() {
    setLoading(true);
    setErr(null);
    setResults(null);
    try {
      const out = await invoke<SidecarVersion[]>("binaries_version");
      setResults(out);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mh-smoke__card">
      <h1>Sidecar smoke test</h1>
      <p className="mh-smoke__hint">
        Spawns <code>yt-dlp --version</code> and <code>ffmpeg -version</code> via
        the Rust backend.
      </p>
      <button className="mh-smoke__btn" onClick={runSmokeTest} disabled={loading}>
        {loading ? "Running…" : "Run smoke test"}
      </button>
      {err && (
        <div className="mh-smoke__row mh-smoke__row--err">
          <span className="mh-smoke__label">error</span>
          <code>{err}</code>
        </div>
      )}
      {results && (
        <ul className="mh-smoke__list">
          {results.map((r) => (
            <li
              key={r.name}
              className={
                "mh-smoke__row " +
                (r.ok ? "mh-smoke__row--ok" : "mh-smoke__row--err")
              }
            >
              <span className="mh-smoke__label">{r.name}</span>
              <code>{r.ok ? r.version : r.error ?? "(unknown error)"}</code>
              <span className="mh-smoke__status">{r.ok ? "ok" : "fail"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// Metadata fetch card (0.2 preview)
// =====================================================================

function MetadataCard() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFormats, setShowFormats] = useState(false);

  // Download state — store the full FormatOption so we can compose the
  // yt-dlp spec (video-only picks auto-promote to <id>+bestaudio/best).
  const [selectedFormat, setSelectedFormat] = useState<FormatOption | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlResult, setDlResult] = useState<DownloadResult | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  // Segment In/Out timestamps — strings so the user can type whatever
  // form they want (mm:ss, hh:mm:ss, seconds); parsed on submit.
  const [inStr, setInStr] = useState("");
  const [outStr, setOutStr] = useState("");

  // Transcode state — preset selection + active progress + phase tracking.
  // Phase distinguishes the two visual stages of a single "download" job:
  // downloading the source, then re-encoding into the editor-friendly
  // intermediate. Both use the same progress bar with different labels.
  const [transcodePreset, setTranscodePreset] =
    useState<TranscodePreset>("none");
  const [transcodeProgress, setTranscodeProgress] =
    useState<TranscodeProgress | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "transcoding">(
    "idle",
  );

  // Subscribe to streaming progress events from Rust. The event payload
  // arrives once per yt-dlp progress tick; we just stuff it into state
  // and let React re-render the bar.
  //
  // Note: for `<id>+bestaudio` specs, yt-dlp downloads video THEN audio
  // as separate streams — progress resets between them. UI will show
  // two passes. Cleaner stream-aware progress is a future polish item.
  useEffect(() => {
    let unlistenDl: UnlistenFn | null = null;
    let unlistenTx: UnlistenFn | null = null;
    listen<ProgressEvent>("download:progress", (e) => {
      // Single-URL flow doesn't tag with a job_id, so accept all
      // untagged events. Batch events (with job_id set) are routed
      // by QueueCard's own listener.
      if (e.payload.job_id) return;
      setProgress(e.payload);
    }).then((fn) => {
      unlistenDl = fn;
    });
    listen<TranscodeProgress>("transcode:progress", (e) => {
      if (e.payload.job_id) return;
      setTranscodeProgress(e.payload);
    }).then((fn) => {
      unlistenTx = fn;
    });
    return () => {
      unlistenDl?.();
      unlistenTx?.();
    };
  }, []);

  async function fetchMetadata(e?: FormEvent) {
    e?.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setErr(null);
    setMeta(null);
    setShowFormats(false);
    setSelectedFormat(null);
    setDlResult(null);
    setDlErr(null);
    try {
      const out = await invoke<VideoMetadata>("yt_fetch_metadata", { url });
      setMeta(out);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Compose the yt-dlp -f argument + merge container from a picked
  // format row.
  //
  // YouTube above ~360p serves video and audio as separate streams. If
  // the user picks a video-only row, we silently grab the best audio
  // stream alongside it and let ffmpeg (bundled) mux them together.
  // Muxing is byte-copy only — no quality loss.
  //
  // Container hygiene: keep the user's picked video container.
  //   MP4 video  → pair with M4A audio  → merge into MP4
  //   WebM video → pair with WebM audio → merge into WebM
  //   anything else → MKV (it can hold anything)
  // This prevents the surprise of picking "mp4" and getting ".webm"
  // back when yt-dlp default-mergeed AV1 + Opus into the WebM family.
  function composeFormatSpec(
    f: FormatOption,
  ): { spec: string; mergeContainer: string | null } {
    if (!f.has_video || f.has_audio) {
      // Audio-only OR pre-muxed — no muxing needed.
      return { spec: f.id, mergeContainer: null };
    }
    if (f.ext === "mp4") {
      return {
        spec: `${f.id}+bestaudio[ext=m4a]/bestaudio/best`,
        mergeContainer: "mp4",
      };
    }
    if (f.ext === "webm") {
      return {
        spec: `${f.id}+bestaudio[ext=webm]/bestaudio/best`,
        mergeContainer: "webm",
      };
    }
    return { spec: `${f.id}+bestaudio/best`, mergeContainer: "mkv" };
  }

  async function download() {
    if (!selectedFormat || !url.trim()) return;
    const { spec, mergeContainer } = composeFormatSpec(selectedFormat);

    // Resolve segment from the text inputs. Both empty → full download.
    // One empty / one filled → user error.
    const inSec = parseTimestamp(inStr);
    const outSec = parseTimestamp(outStr);
    if (inStr.trim() !== "" && inSec == null) {
      setDlErr(`Invalid In timestamp: "${inStr}"`);
      return;
    }
    if (outStr.trim() !== "" && outSec == null) {
      setDlErr(`Invalid Out timestamp: "${outStr}"`);
      return;
    }
    if ((inSec == null) !== (outSec == null)) {
      setDlErr("Specify both In and Out, or neither (for full video)");
      return;
    }
    if (inSec != null && outSec != null) {
      if (outSec <= inSec) {
        setDlErr("Out must be after In");
        return;
      }
      if (meta?.duration_sec != null && outSec > meta.duration_sec) {
        setDlErr(
          `Out (${outSec}s) exceeds video duration (${Math.floor(meta.duration_sec)}s)`,
        );
        return;
      }
    }

    // The size hint is the FULL filesize — we always pull the full
    // source, then trim locally with ffmpeg. (Earlier scaled this by
    // segment duration when we thought yt-dlp could byte-range, which
    // it can't.)
    const bytesHint: number | null = selectedFormat.filesize_bytes;

    setDownloading(true);
    setDlErr(null);
    setDlResult(null);
    setProgress(null);
    setTranscodeProgress(null);
    setPhase("downloading");
    try {
      const dlRes = await invoke<DownloadResult>("yt_download", {
        url,
        formatSpec: spec,
        mergeContainer,
        totalBytesHint: bytesHint,
        videoId: meta?.id ?? "",
        inSec,
        outSec,
      });

      // If a transcode preset was chosen, run it as a sequential
      // second phase. The downloaded file is the input; the encoded
      // file lands next to it with a preset-suffixed name.
      if (transcodePreset !== "none") {
        setPhase("transcoding");
        // Estimate total seconds for percent/ETA: trim duration for
        // segments, full video duration otherwise.
        const totalSecHint =
          inSec != null && outSec != null
            ? outSec - inSec
            : (meta?.duration_sec ?? null);
        try {
          const txRes = await invoke<TranscodeResult>("media_transcode", {
            srcPath: dlRes.path,
            preset: transcodePreset,
            totalSecHint,
            jobId: null,
          });
          // Replace the displayed result with the transcoded file —
          // the user picked a preset because that's the file they want.
          setDlResult(txRes);
        } catch (e) {
          // Transcode failed but the download succeeded. Surface the
          // error and keep showing the source file so the user has
          // something usable.
          setDlErr(`transcode failed: ${String(e)} (source kept: ${dlRes.path})`);
          setDlResult(dlRes);
        }
      } else {
        setDlResult(dlRes);
      }
    } catch (e) {
      setDlErr(String(e));
    } finally {
      setDownloading(false);
      setProgress(null);
      setTranscodeProgress(null);
      setPhase("idle");
    }
  }

  async function openContainingFolder(filePath: string) {
    // revealItemInDir opens the folder AND highlights the file in it
    // (Explorer on Windows, Finder on macOS). If that fails for any
    // reason, fall back to just opening the parent dir.
    try {
      await revealItemInDir(filePath);
    } catch {
      const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
      const dir = idx > 0 ? filePath.slice(0, idx) : filePath;
      try {
        await openPath(dir);
      } catch (e) {
        setDlErr(`open folder failed: ${String(e)}`);
      }
    }
  }

  const videoFormats = meta?.formats.filter((f) => f.has_video) ?? [];
  const audioOnly = meta?.formats.filter((f) => !f.has_video && f.has_audio) ?? [];

  return (
    <section className="mh-smoke__card">
      <h1>Fetch metadata <span className="mh-smoke__chip">0.2 preview</span></h1>
      <p className="mh-smoke__hint">
        Paste a YouTube URL. Runs <code>yt-dlp -j</code> and returns the title,
        channel, duration, thumbnail, and full format list — no download.
      </p>

      <form className="mh-meta__form" onSubmit={fetchMetadata}>
        <input
          className="mh-meta__input"
          type="text"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="mh-smoke__btn"
          disabled={loading || !url.trim()}
        >
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </form>

      {err && (
        <div className="mh-smoke__row mh-smoke__row--err" style={{ marginTop: 14 }}>
          <span className="mh-smoke__label">error</span>
          <code>{err}</code>
        </div>
      )}

      {meta && (
        <article className="mh-meta__result">
          <div className="mh-meta__hero">
            {meta.thumbnail ? (
              <img
                className="mh-meta__thumb"
                src={meta.thumbnail}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="mh-meta__thumb mh-meta__thumb--empty">no thumb</div>
            )}
            <div className="mh-meta__info">
              <h2 className="mh-meta__title">{meta.title}</h2>
              <div className="mh-meta__channel">{meta.channel}</div>
              <dl className="mh-meta__stats">
                <div>
                  <dt>Duration</dt>
                  <dd className="mono">{fmtDuration(meta.duration_sec)}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd className="mono">{fmtUploadDate(meta.upload_date)}</dd>
                </div>
                <div>
                  <dt>Views</dt>
                  <dd className="mono">
                    {meta.view_count != null
                      ? meta.view_count.toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Formats</dt>
                  <dd className="mono">
                    {videoFormats.length} video · {audioOnly.length} audio-only
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <button
            className="mh-meta__toggle"
            onClick={() => setShowFormats((s) => !s)}
          >
            {showFormats ? "▾" : "▸"} {showFormats ? "Hide" : "Show"} format list ({meta.formats.length})
          </button>

          {showFormats && (
            <div className="mh-meta__formats">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>id</th>
                    <th>ext</th>
                    <th>res</th>
                    <th>fps</th>
                    <th>vcodec</th>
                    <th>acodec</th>
                    <th>size</th>
                    <th>note</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.formats.map((f) => {
                    const isSel = selectedFormat?.id === f.id;
                    return (
                      <tr
                        key={f.id}
                        className={isSel ? "mh-meta__row--sel" : ""}
                        onClick={() => setSelectedFormat(f)}
                      >
                        <td className="mh-meta__radio">
                          <span className={isSel ? "dot dot--on" : "dot"} />
                        </td>
                        <td className="mono">{f.id}</td>
                        <td className="mono">{f.ext}</td>
                        <td className="mono">
                          {f.width && f.height ? `${f.width}×${f.height}` : "—"}
                        </td>
                        <td className="mono">
                          {f.fps ? Math.round(f.fps) : "—"}
                        </td>
                        <td className="mono">
                          {f.vcodec && f.vcodec !== "none"
                            ? f.vcodec.split(".")[0]
                            : "—"}
                        </td>
                        <td className="mono">
                          {f.acodec && f.acodec !== "none"
                            ? f.acodec.split(".")[0]
                            : "—"}
                        </td>
                        <td className="mono">{fmtBytes(f.filesize_bytes)}</td>
                        <td className="mh-meta__note">{f.note ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Segment In/Out — optional. Empty = full video. */}
          <div className="mh-meta__segbar">
            <span className="mh-smoke__label">segment</span>
            <label className="mh-meta__seginput">
              <span className="mh-meta__seglabel">in</span>
              <input
                type="text"
                placeholder="—"
                value={inStr}
                onChange={(e) => setInStr(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="mh-meta__seginput">
              <span className="mh-meta__seglabel">out</span>
              <input
                type="text"
                placeholder="—"
                value={outStr}
                onChange={(e) => setOutStr(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <span className="mh-smoke__faint mh-meta__seghint">
              {inStr || outStr ? (
                <>
                  Downloads the full source first, then trims with ffmpeg
                  (stream-copy, ~5–15 s, no quality loss).
                </>
              ) : (
                <>mm:ss · hh:mm:ss · or seconds. Leave both empty for full video.</>
              )}
            </span>
          </div>

          {/* Transcode preset selector */}
          <div className="mh-meta__segbar">
            <span className="mh-smoke__label">transcode</span>
            <select
              className="mh-meta__select"
              value={transcodePreset}
              onChange={(e) =>
                setTranscodePreset(e.target.value as TranscodePreset)
              }
            >
              {TRANSCODE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="mh-smoke__faint mh-meta__seghint">
              {TRANSCODE_PRESETS.find((p) => p.value === transcodePreset)?.hint}
            </span>
          </div>

          {/* Download bar — only after metadata exists */}
          <div className="mh-meta__dlbar">
            <div className="mh-meta__dlbar-info">
              {selectedFormat ? (
                <>
                  <span className="mh-smoke__label">spec</span>
                  <code>{composeFormatSpec(selectedFormat).spec}</code>
                  {selectedFormat.has_video && !selectedFormat.has_audio && (
                    <span className="mh-meta__hint-chip">
                      + audio →{" "}
                      .{composeFormatSpec(selectedFormat).mergeContainer}
                    </span>
                  )}
                  <span className="mh-meta__dlbar-dest">
                    → ~/Media Hub/Downloads/_test/
                  </span>
                </>
              ) : (
                <span className="mh-smoke__faint">
                  Click a format row above, then download.
                </span>
              )}
            </div>
            <button
              className="mh-smoke__btn"
              onClick={download}
              disabled={!selectedFormat || downloading}
            >
              {downloading ? "Downloading…" : "Download"}
            </button>
          </div>

          {downloading && phase === "downloading" && (
            <div className="mh-meta__progress">
              <div className="mh-meta__progress-bar">
                <div
                  className={
                    "mh-meta__progress-fill" +
                    (progress?.percent == null
                      ? " mh-meta__progress-fill--indeterminate"
                      : "")
                  }
                  style={{
                    width:
                      progress?.percent != null
                        ? `${Math.min(100, progress.percent)}%`
                        : "100%",
                  }}
                />
              </div>
              <div className="mh-meta__progress-meta">
                <span className="mono">
                  {progress?.percent != null
                    ? `${progress.percent.toFixed(1)}% · downloading`
                    : "starting download…"}
                </span>
                <span className="mono">
                  {fmtBytes(progress?.downloaded_bytes ?? 0)}
                  {progress?.total_bytes != null
                    ? ` / ${fmtBytes(progress.total_bytes)}`
                    : ""}
                </span>
                <span className="mono">
                  {progress?.speed_bps != null
                    ? `${fmtBytes(progress.speed_bps)}/s`
                    : ""}
                </span>
                <span className="mono">
                  {progress?.eta_sec != null
                    ? `ETA ${fmtEta(progress.eta_sec)}`
                    : ""}
                </span>
              </div>
            </div>
          )}

          {downloading && phase === "transcoding" && (
            <div className="mh-meta__progress">
              <div className="mh-meta__progress-bar">
                <div
                  className={
                    "mh-meta__progress-fill" +
                    (transcodeProgress?.percent == null
                      ? " mh-meta__progress-fill--indeterminate"
                      : "")
                  }
                  style={{
                    width:
                      transcodeProgress?.percent != null
                        ? `${Math.min(100, transcodeProgress.percent)}%`
                        : "100%",
                  }}
                />
              </div>
              <div className="mh-meta__progress-meta">
                <span className="mono">
                  {transcodeProgress?.percent != null
                    ? `${transcodeProgress.percent.toFixed(1)}% · transcoding`
                    : "starting transcode…"}
                </span>
                <span className="mono">
                  {transcodeProgress
                    ? `${fmtEta(Math.floor(transcodeProgress.processed_sec))}${transcodeProgress.total_sec ? ` / ${fmtEta(Math.floor(transcodeProgress.total_sec))}` : ""}`
                    : ""}
                </span>
                <span className="mono">
                  {transcodeProgress?.speed_mult != null
                    ? `${transcodeProgress.speed_mult.toFixed(2)}× realtime`
                    : ""}
                </span>
              </div>
            </div>
          )}

          {dlErr && (
            <div className="mh-smoke__row mh-smoke__row--err mh-meta__dlmsg">
              <span className="mh-smoke__label">download error</span>
              <code>{dlErr}</code>
            </div>
          )}

          {dlResult && (
            <div className="mh-smoke__row mh-smoke__row--ok mh-meta__dlmsg">
              <span className="mh-smoke__label">downloaded</span>
              <code>{dlResult.path}</code>
              <button
                className="mh-meta__openbtn"
                onClick={() => openContainingFolder(dlResult.path)}
              >
                Open folder
              </button>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

// =====================================================================
// Batch queue card (0.2 MVP)
// =====================================================================
//
// Sequential downloads from a paste-multiple-URLs textarea. Each job
// gets a unique id so we can route Rust's download:progress events to
// the right row.
//
// Out of scope for this MVP (intentionally — see ROADMAP.md 0.4):
//   - parallel workers / concurrency
//   - per-job format picker (everyone gets bv*+ba/b → mp4)
//   - pause / resume
//   - retry with backoff
//   - persistence (queue dies on app close)
//
// Architecturally the design is: state lives in React (a jobs array),
// the queue processor is just a sequential async loop that calls
// yt_fetch_metadata + yt_download per job, mutating job state through
// each phase. No new Rust commands needed — yt_download already accepts
// optional job_id and tags its progress events with it.

type QueueStatus =
  | "queued"
  | "fetching"
  | "downloading"
  | "done"
  | "failed";

type QueueJob = {
  id: string;
  url: string;
  status: QueueStatus;
  title?: string;
  channel?: string;
  thumbnail?: string | null;
  duration_sec?: number | null;
  progress?: ProgressEvent;
  resultPath?: string;
  resultBytes?: number | null;
  error?: string;
};

function statusLabel(s: QueueStatus): string {
  switch (s) {
    case "queued":
      return "queued";
    case "fetching":
      return "fetching";
    case "downloading":
      return "downloading";
    case "done":
      return "done";
    case "failed":
      return "failed";
  }
}

function newJobId(): string {
  // Date.now + random is plenty unique for our scale.
  return `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function revealFile(filePath: string) {
  try {
    await revealItemInDir(filePath);
  } catch {
    const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
    const dir = idx > 0 ? filePath.slice(0, idx) : filePath;
    try {
      await openPath(dir);
    } catch {
      // swallow — the row's error state will show in this case
    }
  }
}

function QueueCard() {
  const [urlsInput, setUrlsInput] = useState("");
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  // Ref mirrors jobs so the async processor can read fresh state without
  // closing over stale React snapshots.
  const jobsRef = useRef<QueueJob[]>([]);
  jobsRef.current = jobs;
  // True while the sequential processor loop is running. Prevents double-
  // starting if the user adds more URLs mid-queue (the existing loop
  // picks them up on its next iteration).
  const processingRef = useRef(false);

  // Subscribe to progress events and route to the matching job by id.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<ProgressEvent>("download:progress", (e) => {
      const id = e.payload.job_id;
      if (!id) return; // ignore single-URL flow events
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, progress: e.payload } : j)),
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Auto-start the processor whenever there are queued jobs and the
  // pump isn't already running. Runs AFTER React commits the new jobs
  // to state, so jobsRef is up to date when pump iterates.
  //
  // Calling void pump() directly from queueAll() doesn't work because
  // jobsRef.current still points to the pre-queueAll snapshot at that
  // synchronous moment — React hasn't re-rendered yet.
  useEffect(() => {
    if (processingRef.current) return;
    if (!jobs.some((j) => j.status === "queued")) return;
    void pump();
    // pump itself is stable (uses refs internally) so it's not listed
    // as a dep; we only care about jobs changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  function updateJob(id: string, patch: Partial<QueueJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function processOne(job: QueueJob): Promise<void> {
    updateJob(job.id, { status: "fetching" });
    let meta: VideoMetadata;
    try {
      meta = await invoke<VideoMetadata>("yt_fetch_metadata", { url: job.url });
    } catch (e) {
      updateJob(job.id, { status: "failed", error: String(e) });
      return;
    }

    // Pick a size hint from the largest video format available — close
    // enough to what `bv*+ba/b` will resolve to. Without this the
    // progress bar shows raw bytes only (no percent).
    const bestVideo =
      meta.formats
        .filter((f) => f.has_video)
        .reduce<FormatOption | null>(
          (best, f) =>
            (f.filesize_bytes ?? 0) > (best?.filesize_bytes ?? 0) ? f : best,
          null,
        ) ?? null;

    updateJob(job.id, {
      status: "downloading",
      title: meta.title,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
      duration_sec: meta.duration_sec,
    });

    try {
      const res = await invoke<DownloadResult>("yt_download", {
        url: job.url,
        // bv*+ba/b → best video + best audio merged; fallback to best
        // pre-muxed if a YT format has both. Solid universal default.
        formatSpec: "bv*+ba/b",
        mergeContainer: "mp4",
        totalBytesHint: bestVideo?.filesize_bytes ?? null,
        videoId: meta.id,
        inSec: null,
        outSec: null,
        jobId: job.id,
      });
      updateJob(job.id, {
        status: "done",
        resultPath: res.path,
        resultBytes: res.bytes,
      });
    } catch (e) {
      updateJob(job.id, { status: "failed", error: String(e) });
    }
  }

  async function pump() {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      // Loop until no queued jobs remain. Reads from the ref each
      // iteration so newly-added jobs are picked up automatically.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = jobsRef.current.find((j) => j.status === "queued");
        if (!next) break;
        await processOne(next);
      }
    } finally {
      processingRef.current = false;
    }
  }

  function queueAll() {
    const urls = urlsInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) return;
    const newJobs: QueueJob[] = urls.map((url) => ({
      id: newJobId(),
      url,
      status: "queued",
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    setUrlsInput("");
    // The processor starts via the useEffect above once React commits
    // the new jobs to state — no manual pump() call here.
  }

  function clearCompleted() {
    setJobs((prev) =>
      prev.filter((j) => j.status !== "done" && j.status !== "failed"),
    );
  }

  const stats = (() => {
    if (jobs.length === 0) return "";
    const counts: Record<QueueStatus, number> = {
      queued: 0,
      fetching: 0,
      downloading: 0,
      done: 0,
      failed: 0,
    };
    for (const j of jobs) counts[j.status]++;
    const parts: string[] = [];
    if (counts.downloading) parts.push(`${counts.downloading} active`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    return parts.join(" · ");
  })();

  return (
    <section className="mh-smoke__card">
      <h1>
        Batch queue <span className="mh-smoke__chip">0.2 mvp</span>
      </h1>
      <p className="mh-smoke__hint">
        Paste one URL per line, hit Queue all. Each downloads at the best
        available video + audio (mp4). Sequential — one at a time.
      </p>

      <textarea
        className="mh-queue__textarea"
        rows={4}
        placeholder={"https://www.youtube.com/watch?v=…\nhttps://www.youtube.com/watch?v=…"}
        value={urlsInput}
        onChange={(e) => setUrlsInput(e.target.value)}
        spellCheck={false}
      />

      <div className="mh-queue__actions">
        <button
          className="mh-smoke__btn"
          onClick={queueAll}
          disabled={!urlsInput.trim()}
        >
          Queue all
        </button>
        <button className="mh-queue__btn-secondary" onClick={clearCompleted}>
          Clear completed
        </button>
        <span className="mh-smoke__faint mh-queue__stats">{stats}</span>
      </div>

      {jobs.length > 0 && (
        <ul className="mh-queue__list">
          {jobs.map((job) => (
            <li key={job.id} className="mh-queue__row">
              <div className="mh-queue__thumb">
                {job.thumbnail ? (
                  <img src={job.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="mh-queue__thumb-empty" />
                )}
              </div>
              <div className="mh-queue__body">
                <div className="mh-queue__title">{job.title ?? job.url}</div>
                <div className="mh-queue__meta mono">
                  {job.channel
                    ? `${job.channel}${job.duration_sec ? ` · ${fmtDuration(job.duration_sec)}` : ""}`
                    : job.url}
                </div>
                {job.status === "downloading" && (
                  <div className="mh-queue__progress">
                    <div className="mh-queue__progress-bar">
                      <div
                        className={
                          "mh-queue__progress-fill" +
                          (job.progress?.percent == null
                            ? " mh-meta__progress-fill--indeterminate"
                            : "")
                        }
                        style={{
                          width:
                            job.progress?.percent != null
                              ? `${Math.min(100, job.progress.percent)}%`
                              : "100%",
                        }}
                      />
                    </div>
                    <div className="mh-queue__progress-meta mono">
                      <span>
                        {job.progress?.percent != null
                          ? `${job.progress.percent.toFixed(1)}%`
                          : "starting…"}
                      </span>
                      <span>
                        {fmtBytes(job.progress?.downloaded_bytes ?? 0)}
                        {job.progress?.total_bytes
                          ? ` / ${fmtBytes(job.progress.total_bytes)}`
                          : ""}
                      </span>
                      {job.progress?.speed_bps != null && (
                        <span>{fmtBytes(job.progress.speed_bps)}/s</span>
                      )}
                      {job.progress?.eta_sec != null && (
                        <span>ETA {fmtEta(job.progress.eta_sec)}</span>
                      )}
                    </div>
                  </div>
                )}
                {job.status === "done" && job.resultPath && (
                  <div className="mh-queue__done mono">
                    <span>{fmtBytes(job.resultBytes ?? 0)}</span>
                    <button
                      className="mh-meta__openbtn"
                      onClick={() => revealFile(job.resultPath!)}
                    >
                      Open
                    </button>
                  </div>
                )}
                {job.status === "failed" && (
                  <div className="mh-queue__error">{job.error}</div>
                )}
              </div>
              <div className="mh-queue__status">
                <span className={`mh-queue__pill mh-queue__pill--${job.status}`}>
                  {statusLabel(job.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// App shell
// =====================================================================

function App() {
  return (
    <main className="mh-smoke">
      <header className="mh-smoke__header">
        <div className="mh-smoke__brand">
          <span className="mh-smoke__mark" />
          <span className="mh-smoke__name">media·hub</span>
          <span className="mh-smoke__build">0.2.0-dev</span>
        </div>
        <span className="mh-smoke__phase">Milestone 0.2 — single-URL metadata</span>
      </header>

      <div className="mh-smoke__stack">
        <MetadataCard />
        <QueueCard />
        <SmokeCard />
      </div>

      <footer className="mh-smoke__footer">
        <span>Next: download + progress (0.2 cont.)</span>
        <span className="mh-smoke__faint">F:\CLAUDE\media-hub</span>
      </footer>
    </main>
  );
}

export default App;
