import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  // Download state
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlResult, setDlResult] = useState<DownloadResult | null>(null);

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

  async function download() {
    if (!selectedFormat || !url.trim()) return;
    setDownloading(true);
    setDlErr(null);
    setDlResult(null);
    try {
      const res = await invoke<DownloadResult>("yt_download", {
        url,
        formatId: selectedFormat,
      });
      setDlResult(res);
    } catch (e) {
      setDlErr(String(e));
    } finally {
      setDownloading(false);
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
                    const isSel = selectedFormat === f.id;
                    return (
                      <tr
                        key={f.id}
                        className={isSel ? "mh-meta__row--sel" : ""}
                        onClick={() => setSelectedFormat(f.id)}
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

          {/* Download bar — only after metadata exists */}
          <div className="mh-meta__dlbar">
            <div className="mh-meta__dlbar-info">
              {selectedFormat ? (
                <>
                  <span className="mh-smoke__label">selected</span>
                  <code>{selectedFormat}</code>
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
