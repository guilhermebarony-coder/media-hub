import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
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
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
  speed_bps: number | null;
  eta_sec: number | null;
};

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

  // Subscribe to streaming progress events from Rust. The event payload
  // arrives once per yt-dlp progress tick; we just stuff it into state
  // and let React re-render the bar.
  //
  // Note: for `<id>+bestaudio` specs, yt-dlp downloads video THEN audio
  // as separate streams — progress resets between them. UI will show
  // two passes. Cleaner stream-aware progress is a future polish item.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<ProgressEvent>("download:progress", (e) => {
      setProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
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
    try {
      const res = await invoke<DownloadResult>("yt_download", {
        url,
        formatSpec: spec,
        mergeContainer,
        totalBytesHint: bytesHint,
        videoId: meta?.id ?? "",
        inSec,
        outSec,
      });
      setDlResult(res);
    } catch (e) {
      setDlErr(String(e));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  async function openContainingFolder(filePath: string) {
    // Strip filename to get parent dir. Works for both Windows (\) and POSIX (/).
    const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
    const dir = idx > 0 ? filePath.slice(0, idx) : filePath;
    try {
      await openPath(dir);
    } catch (e) {
      setDlErr(`open folder failed: ${String(e)}`);
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

          {downloading && (
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
                    ? `${progress.percent.toFixed(1)}%`
                    : "starting…"}
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
