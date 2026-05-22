import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Icon } from "../lib/icons";
import {
  fmtBytes,
  fmtDuration,
  fmtEta,
  fmtUploadDate,
  parseTimestamp,
  extFromPath,
} from "../lib/format";
import {
  attachLocalThumbnail,
  audioCodecFor,
  recordInLibrary,
  revealFile,
  videoCodecFor,
} from "../lib/library";
import { useActiveProject } from "../lib/activeProject";
import { useSettings } from "../lib/settings";
import { Scrubber } from "../components/Scrubber";
import type {
  DownloadResult,
  DuplicateMatch,
  FormatOption,
  ProgressEvent,
  Segment,
  TranscodePreset,
  TranscodeProgress,
  TranscodeResult,
  VideoMetadata,
} from "../lib/types";
import { TRANSCODE_PRESETS } from "../lib/types";

// =====================================================================
// Page wrapper
// =====================================================================
export default function DownloadPage() {
  const { scope } = useActiveProject();
  const target =
    scope.kind === "library" ? "Library" : `project · ${scope.name}`;
  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Download</div>
        <span className="ch-meta">
          saving to <strong style={{ color: "var(--text-0)" }}>{target}</strong>
        </span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          change scope from the top-bar picker
        </span>
      </div>
      <div className="content-body">
        <div className="stack">
          <MetadataCard />
          <QueueCard />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Metadata + single-URL download
// =====================================================================
/**
 * Ctrl-held "send to Library" override hook.
 *
 * While Ctrl is held, the next Download / Queue click routes to
 * Library regardless of active scope. Releases the moment Ctrl is up
 * (or the window loses focus, in case the user alt-tabs while
 * holding it).
 *
 * We use plain Ctrl (not Ctrl+Space — that's reserved for a future
 * command palette / search). Ctrl-alone works here because:
 *   - It only AFFECTS the next Download/Queue button click
 *   - Other Ctrl shortcuts (copy/paste/etc.) don't trigger our
 *     handler — we never preventDefault the keydown
 *   - The button label changes while Ctrl is held, so the user sees
 *     the override is live before they click
 */
/**
 * Detect the source platform from a paste-able URL. Today we only
 * support YouTube — but the 0.8.C sticky-format feature stores last
 * picks per platform so the shape is forward-compatible with the 1.x
 * platform abstraction. Returns "youtube" as a sensible default for
 * any unrecognized URL (the worst case is a sticky pick that won't
 * resolve, which we simply ignore).
 */
function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
  if (u.includes("tiktok.com")) return "tiktok";
  return "youtube";
}

function useLibraryOverride(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setHeld(false);
    };
    const onBlur = () => setHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return held;
}

function MetadataCard() {
  const { scope } = useActiveProject();
  const { settings, save: saveSettings } = useSettings();
  const overrideLibrary = useLibraryOverride();
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFormats, setShowFormats] = useState(false);
  // If we already have this URL in the library, show a yellow chip
  // so the user knows they're about to re-download. We don't BLOCK —
  // sometimes you want a different quality / segment / transcode.
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);

  const [selectedFormat, setSelectedFormat] = useState<FormatOption | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlResult, setDlResult] = useState<DownloadResult | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  // 0.6.1: list of segments to trim from the single source download.
  // Empty = full video. N = N independent clip files on disk after
  // ffmpeg trims. The scrubber drives this entirely.
  const [segments, setSegments] = useState<Segment[]>([]);
  // Manual text-entry mode — when the scrubber's stream fails (age-
  // gated, region-locked, etc.) or the user wants exact-second
  // precision. Currently single-segment only; for multi-segment
  // users should rely on the scrubber. Worth-its-keep fallback.
  const [manualMode, setManualMode] = useState(false);
  const [inStr, setInStr] = useState("");
  const [outStr, setOutStr] = useState("");
  // Track the last batch of completed asset paths so the "downloaded"
  // success message can list them.
  const [downloadedPaths, setDownloadedPaths] = useState<string[]>([]);

  // Initial preset comes from settings; user can still override per-
  // download. We sync on first ready (settings is async) so the
  // default matches what they picked in Settings → Transcode.
  const [transcodePreset, setTranscodePreset] = useState<TranscodePreset>(
    () => (settings.default_transcode_preset as TranscodePreset) ?? "none",
  );
  const presetInitialized = useRef(false);
  useEffect(() => {
    if (presetInitialized.current) return;
    if (settings.default_transcode_preset) {
      setTranscodePreset(settings.default_transcode_preset as TranscodePreset);
      presetInitialized.current = true;
    }
  }, [settings.default_transcode_preset]);
  const [transcodeProgress, setTranscodeProgress] = useState<TranscodeProgress | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "transcoding">("idle");

  // Untagged events (no job_id) are routed to the single-URL flow.
  // Batch events with job_id are handled by QueueCard's own listener.
  useEffect(() => {
    let unlistenDl: UnlistenFn | null = null;
    let unlistenTx: UnlistenFn | null = null;
    listen<ProgressEvent>("download:progress", (e) => {
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
    setDuplicate(null);
    setSegments([]);
    setInStr("");
    setOutStr("");
    setDownloadedPaths([]);
    try {
      // Run metadata fetch and dupe check in parallel — both are
      // network/IO so doing them sequentially would slow the UI
      // unnecessarily. Dupe check failure is non-fatal.
      const [out, dupe] = await Promise.all([
        invoke<VideoMetadata>("yt_fetch_metadata", { url }),
        invoke<DuplicateMatch | null>("library_find_by_url", {
          sourceUrl: url,
        }).catch(() => null),
      ]);
      setMeta(out);
      setDuplicate(dupe);
      // 0.8.C sticky format: if the user has previously downloaded
      // this platform, try to re-pick the same format_id. Silent
      // no-op when the sticky id no longer exists in the format
      // list (yt-dlp's ladder rotates over time).
      const platform = detectPlatform(url);
      const stickyId = settings.last_formats?.[platform];
      if (stickyId) {
        const match = out.formats.find((f) => f.id === stickyId);
        if (match) setSelectedFormat(match);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Compose `-f` spec — video-only picks auto-promote to <id>+bestaudio
  // with container hygiene (MP4 → MP4, WebM → WebM, else MKV).
  function composeFormatSpec(f: FormatOption): { spec: string; mergeContainer: string | null } {
    if (!f.has_video || f.has_audio) return { spec: f.id, mergeContainer: null };
    if (f.ext === "mp4") return { spec: `${f.id}+bestaudio[ext=m4a]/bestaudio/best`, mergeContainer: "mp4" };
    if (f.ext === "webm") return { spec: `${f.id}+bestaudio[ext=webm]/bestaudio/best`, mergeContainer: "webm" };
    return { spec: `${f.id}+bestaudio/best`, mergeContainer: "mkv" };
  }

  async function download() {
    if (!selectedFormat || !url.trim()) return;
    const { spec, mergeContainer } = composeFormatSpec(selectedFormat);

    // Resolve effective segment list. Manual mode wins when on (single
    // segment). Otherwise the scrubber's committed list is the source
    // of truth. Empty list = full-video download.
    let effectiveSegments: Segment[] = segments;
    if (manualMode) {
      const i = parseTimestamp(inStr);
      const o = parseTimestamp(outStr);
      if (inStr.trim() !== "" && i == null) {
        setDlErr(`Invalid In timestamp: "${inStr}"`);
        return;
      }
      if (outStr.trim() !== "" && o == null) {
        setDlErr(`Invalid Out timestamp: "${outStr}"`);
        return;
      }
      if ((i == null) !== (o == null)) {
        setDlErr("Specify both In and Out, or neither (for full video)");
        return;
      }
      effectiveSegments = i != null && o != null ? [{ inSec: i, outSec: o }] : [];
    }

    // Per-segment validation: in < out, out within duration if known.
    for (const seg of effectiveSegments) {
      if (seg.outSec <= seg.inSec) {
        setDlErr(`Invalid segment: Out (${seg.outSec.toFixed(1)}s) must be after In (${seg.inSec.toFixed(1)}s)`);
        return;
      }
      if (meta?.duration_sec != null && seg.outSec > meta.duration_sec) {
        setDlErr(
          `Segment Out (${seg.outSec.toFixed(1)}s) exceeds video duration (${Math.floor(meta.duration_sec)}s)`,
        );
        return;
      }
    }

    const bytesHint = selectedFormat.filesize_bytes;

    // Resolve target scope at click time, respecting Ctrl+Space.
    // Capture into a local so subsequent state changes don't leak in.
    const targetProjectId =
      !overrideLibrary && scope.kind === "project" ? scope.id : null;

    // 0.8.C: remember this format pick for the platform. Fire-and-
    // forget — failure to persist isn't worth blocking the download.
    {
      const platform = detectPlatform(url);
      const fmtId = selectedFormat.id;
      void saveSettings((s) => ({
        ...s,
        last_formats: { ...(s.last_formats ?? {}), [platform]: fmtId },
      })).catch(() => {});
    }

    setDownloading(true);
    setDlErr(null);
    setDlResult(null);
    setDownloadedPaths([]);
    setProgress(null);
    setTranscodeProgress(null);
    setPhase("downloading");
    try {
      // 0.6.1: yt_download now returns Vec<DownloadResult>. Full-video
      // mode is just [single result]; segment mode is N results, one
      // per trim. Backend deletes the source after all trims succeed.
      const rustSegments = effectiveSegments.map((s) => [s.inSec, s.outSec] as [number, number]);
      const dlResults = await invoke<DownloadResult[]>("yt_download", {
        url,
        formatSpec: spec,
        mergeContainer,
        totalBytesHint: bytesHint,
        videoId: meta?.id ?? "",
        segments: rustSegments.length > 0 ? rustSegments : null,
        projectId: targetProjectId,
      });

      // Transcode + library-insert + thumbnail per result. Sequential
      // because: transcodes are CPU-bound and parallel would thrash;
      // library inserts are cheap but emitting library:changed once
      // per row coalesces nicely in the UI; thumbnails are fire-and-
      // forget anyway.
      const finalPaths: string[] = [];
      for (let i = 0; i < dlResults.length; i++) {
        const dlRes = dlResults[i];
        const seg = effectiveSegments[i]; // undefined for full-video mode
        let finalRes = dlRes;
        let usedPreset: TranscodePreset = "none";

        if (transcodePreset !== "none") {
          setPhase("transcoding");
          const totalSecHint = seg
            ? seg.outSec - seg.inSec
            : meta?.duration_sec ?? null;
          try {
            const txRes = await invoke<TranscodeResult>("media_transcode", {
              srcPath: dlRes.path,
              preset: transcodePreset,
              totalSecHint,
              jobId: null,
            });
            finalRes = txRes;
            usedPreset = transcodePreset;
          } catch (e) {
            // Surface the transcode failure but keep the source
            // segment as the asset on disk. Continue with the rest
            // — one bad transcode shouldn't abort the whole batch.
            setDlErr(
              `transcode failed for segment ${i + 1}: ${String(e)} (source kept: ${dlRes.path})`,
            );
          }
        }

        const effectiveDuration = seg
          ? seg.outSec - seg.inSec
          : meta?.duration_sec ?? null;

        const assetId = await recordInLibrary({
          source_url: url,
          platform: "youtube",
          video_id: meta?.id ?? null,
          channel: meta?.channel ?? null,
          title: meta?.title ?? url,
          duration_sec: meta?.duration_sec ?? null,
          in_sec: seg ? seg.inSec : null,
          out_sec: seg ? seg.outSec : null,
          file_path: finalRes.path,
          file_size: finalRes.bytes ?? null,
          container: extFromPath(finalRes.path),
          codec_video: videoCodecFor(usedPreset, selectedFormat.vcodec),
          codec_audio: audioCodecFor(usedPreset, selectedFormat.acodec),
          width: selectedFormat.width,
          height: selectedFormat.height,
          fps: selectedFormat.fps,
          transcoded_to: usedPreset === "none" ? null : usedPreset,
          thumbnail_url: meta?.thumbnail ?? null,
          project_id: targetProjectId,
        });
        if (assetId) {
          void attachLocalThumbnail(assetId, finalRes.path, effectiveDuration);
        }
        finalPaths.push(finalRes.path);
      }

      // Show the LAST result as the canonical dlResult (drives the
      // existing single-file success row). For multi-segment, also
      // remember the full path list for the summary panel.
      if (finalPaths.length > 0) {
        setDlResult({ path: finalPaths[finalPaths.length - 1], bytes: null });
        setDownloadedPaths(finalPaths);
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

  const videoFormats = meta?.formats.filter((f) => f.has_video) ?? [];
  const audioOnly = meta?.formats.filter((f) => !f.has_video && f.has_audio) ?? [];

  return (
    <section className="card-box">
      <h2>
        Fetch & download <span className="chip">single URL</span>
      </h2>
      <p className="hint">
        Paste a YouTube URL. Runs <code>yt-dlp -j</code>, then lets you pick a
        format, scrub segments, and optionally transcode. Files land in the
        active scope (Library or current project). Hold <span className="kbd">Ctrl</span>{" "}
        to override to Library.
      </p>

      <form className="field" onSubmit={fetchMetadata}>
        <input
          className="field-input"
          type="text"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={loading || !url.trim()}>
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </form>

      {err && (
        <div className="msg-row err">
          <span className="label">error</span>
          <code>{err}</code>
        </div>
      )}

      {meta && (
        <>
          <div className="meta-hero">
            {meta.thumbnail ? (
              <img className="meta-thumb" src={meta.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="meta-thumb empty">no thumb</div>
            )}
            <div className="meta-info">
              <h3 className="meta-title">{meta.title}</h3>
              <div className="meta-channel">{meta.channel}</div>
              <dl className="meta-stats">
                <div>
                  <dt>Duration</dt>
                  <dd>{fmtDuration(meta.duration_sec)}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>{fmtUploadDate(meta.upload_date)}</dd>
                </div>
                <div>
                  <dt>Views</dt>
                  <dd>{meta.view_count != null ? meta.view_count.toLocaleString() : "—"}</dd>
                </div>
                <div>
                  <dt>Formats</dt>
                  <dd>
                    {videoFormats.length} video · {audioOnly.length} audio-only
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <button className="meta-toggle" onClick={() => setShowFormats((s) => !s)}>
            {showFormats ? "▾" : "▸"} {showFormats ? "Hide" : "Show"} format list ({meta.formats.length})
          </button>

          {duplicate && (
            <div className="msg-row dupe">
              <span className="label">already saved</span>
              <code style={{ flex: 1 }}>
                "{duplicate.title}" — in <strong>{duplicate.scope_label}</strong>
              </code>
              <button
                className="btn btn-secondary"
                onClick={() => revealFile(duplicate.file_path)}
              >
                <Icon.folder width={11} height={11} /> Open existing
              </button>
            </div>
          )}

          {showFormats && (
            <div className="meta-formats">
              <table>
                <thead>
                  <tr>
                    <th />
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
                      <tr key={f.id} className={isSel ? "sel" : ""} onClick={() => setSelectedFormat(f)}>
                        <td className="radio">
                          <span className={isSel ? "dot on" : "dot"} />
                        </td>
                        <td>{f.id}</td>
                        <td>{f.ext}</td>
                        <td>{f.width && f.height ? `${f.width}×${f.height}` : "—"}</td>
                        <td>{f.fps ? Math.round(f.fps) : "—"}</td>
                        <td>{f.vcodec && f.vcodec !== "none" ? f.vcodec.split(".")[0] : "—"}</td>
                        <td>{f.acodec && f.acodec !== "none" ? f.acodec.split(".")[0] : "—"}</td>
                        <td>{fmtBytes(f.filesize_bytes)}</td>
                        <td>{f.note ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Scrubber
            sourceUrl={url}
            durationHint={meta.duration_sec}
            fpsHint={selectedFormat?.fps ?? null}
            segments={segments}
            onSegmentsChange={setSegments}
          />

          <div className="bar">
            <button
              type="button"
              className="meta-toggle"
              onClick={() => setManualMode((m) => !m)}
            >
              {manualMode ? "▾" : "▸"} Manual timestamp entry{" "}
              <span className="faint">(use when stream playback fails)</span>
            </button>
          </div>

          {manualMode && (
            <div className="bar">
              <span className="label">segment</span>
              <label className="seg-input">
                <span>in</span>
                <input
                  type="text"
                  placeholder="—"
                  value={inStr}
                  onChange={(e) => setInStr(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="seg-input">
                <span>out</span>
                <input
                  type="text"
                  placeholder="—"
                  value={outStr}
                  onChange={(e) => setOutStr(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <span className="hint-text">
                mm:ss · hh:mm:ss · or seconds. Overrides the scrubber's markers when this row is open.
              </span>
            </div>
          )}

          <div className="bar">
            <span className="label">transcode</span>
            <select
              className="field-select"
              value={transcodePreset}
              onChange={(e) => setTranscodePreset(e.target.value as TranscodePreset)}
            >
              {TRANSCODE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="hint-text">
              {TRANSCODE_PRESETS.find((p) => p.value === transcodePreset)?.hint}
            </span>
          </div>

          <div className="dlbar">
            <div className="dlbar-info">
              {selectedFormat ? (
                <>
                  <span className="label">spec</span>
                  <code>{composeFormatSpec(selectedFormat).spec}</code>
                  {selectedFormat.has_video && !selectedFormat.has_audio && (
                    <span className="hint-chip">+ audio → .{composeFormatSpec(selectedFormat).mergeContainer}</span>
                  )}
                  <span className="dlbar-dest">
                    →{" "}
                    {overrideLibrary
                      ? "Library (override)"
                      : scope.kind === "project"
                        ? `Projects/${scope.name}/`
                        : "Library/"}
                  </span>
                </>
              ) : (
                <span className="faint">
                  Click a format row above, then download.{" "}
                  <span className="mono">
                    Hold <span className="kbd">Ctrl</span> to override → Library
                  </span>
                </span>
              )}
            </div>
            <button
              className={"btn" + (overrideLibrary ? " btn-override" : "")}
              onClick={download}
              disabled={!selectedFormat || downloading}
              title={overrideLibrary ? "Send to Library (Ctrl held)" : undefined}
            >
              <Icon.download width={13} height={13} />
              {downloading
                ? "Downloading…"
                : overrideLibrary
                  ? segments.length > 1
                    ? `Download ${segments.length} → Library`
                    : "Download → Library"
                  : segments.length > 1
                    ? `Download ${segments.length} segments`
                    : "Download"}
            </button>
          </div>

          {downloading && phase === "downloading" && (
            <ProgressBar
              percent={progress?.percent ?? null}
              kind="download"
              label={progress?.percent != null ? `${progress.percent.toFixed(1)}% · downloading` : "starting download…"}
              extra={[
                `${fmtBytes(progress?.downloaded_bytes ?? 0)}${
                  progress?.total_bytes != null ? ` / ${fmtBytes(progress.total_bytes)}` : ""
                }`,
                progress?.speed_bps != null ? `${fmtBytes(progress.speed_bps)}/s` : "",
                progress?.eta_sec != null ? `ETA ${fmtEta(progress.eta_sec)}` : "",
              ].filter(Boolean)}
            />
          )}

          {downloading && phase === "transcoding" && (
            <ProgressBar
              percent={transcodeProgress?.percent ?? null}
              kind="transcode"
              label={
                transcodeProgress?.percent != null
                  ? `${transcodeProgress.percent.toFixed(1)}% · transcoding`
                  : "starting transcode…"
              }
              extra={[
                transcodeProgress
                  ? `${fmtEta(Math.floor(transcodeProgress.processed_sec))}${
                      transcodeProgress.total_sec ? ` / ${fmtEta(Math.floor(transcodeProgress.total_sec))}` : ""
                    }`
                  : "",
                transcodeProgress?.speed_mult != null ? `${transcodeProgress.speed_mult.toFixed(2)}× realtime` : "",
              ].filter(Boolean)}
            />
          )}

          {dlErr && (
            <div className="msg-row err">
              <span className="label">download error</span>
              <code>{dlErr}</code>
            </div>
          )}

          {dlResult && downloadedPaths.length <= 1 && (
            <div className="msg-row ok">
              <span className="label">downloaded</span>
              <code>{dlResult.path}</code>
              <button className="btn-secondary btn" onClick={() => revealFile(dlResult.path)}>
                <Icon.folder width={12} height={12} /> Open
              </button>
            </div>
          )}
          {downloadedPaths.length > 1 && (
            <div className="msg-row ok" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <span className="label">downloaded</span>
                <span className="mono" style={{ flex: 1 }}>
                  {downloadedPaths.length} segments
                </span>
                <button
                  className="btn-secondary btn"
                  onClick={() => revealFile(downloadedPaths[0])}
                >
                  <Icon.folder width={12} height={12} /> Open folder
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "var(--text-2)", fontFamily: "var(--mono)" }}>
                {downloadedPaths.map((p, i) => (
                  <li key={p} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    #{i + 1}: {p.split(/[\\/]/).pop()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProgressBar({
  percent,
  label,
  extra,
}: {
  percent: number | null;
  kind: "download" | "transcode";
  label: string;
  extra: string[];
}) {
  return (
    <div className="dl-progress">
      <div className="progress">
        <i
          className={percent == null ? "indet" : ""}
          style={{ width: percent != null ? `${Math.min(100, percent)}%` : undefined }}
        />
      </div>
      <div className="dl-progress-meta">
        <span>{label}</span>
        {extra.map((e, i) => (
          <span key={i}>{e}</span>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// Batch queue
// =====================================================================

type QueueStatus = "queued" | "fetching" | "downloading" | "transcoding" | "done" | "failed";

type QueueJob = {
  id: string;
  url: string;
  status: QueueStatus;
  transcodePreset: TranscodePreset;
  /** Project id captured at enqueue time. NULL = Library. Locked at
   *  enqueue so changing the active scope mid-batch doesn't reroute
   *  already-queued jobs. */
  projectId: string | null;
  title?: string;
  channel?: string;
  thumbnail?: string | null;
  duration_sec?: number | null;
  progress?: ProgressEvent;
  transcodeProgress?: TranscodeProgress;
  resultPath?: string;
  resultBytes?: number | null;
  error?: string;
};

class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = permits;
  }
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }
}

const NVENC_PRESETS: Set<TranscodePreset> = new Set(["h264_nvenc_mp4"]);
const isGpuPreset = (p: TranscodePreset): boolean => NVENC_PRESETS.has(p);

function newJobId(): string {
  return `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const QUEUE_STORAGE_KEY = "mh.queue.v1";

function loadQueueFromStorage(): QueueJob[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueJob[];
    return parsed.map((j) => {
      if (j.status === "fetching" || j.status === "downloading" || j.status === "transcoding") {
        return { ...j, status: "queued" as QueueStatus, progress: undefined, transcodeProgress: undefined };
      }
      return { ...j, progress: undefined, transcodeProgress: undefined };
    });
  } catch {
    return [];
  }
}

const cpuTranscodeSem = new Semaphore(1);
const gpuTranscodeSem = new Semaphore(1);

function QueueCard() {
  const { scope } = useActiveProject();
  const { settings } = useSettings();
  const overrideLibrary = useLibraryOverride();
  const [urlsInput, setUrlsInput] = useState("");
  const [jobs, setJobs] = useState<QueueJob[]>(() => loadQueueFromStorage());
  const [batchTranscode, setBatchTranscode] = useState<TranscodePreset>(
    () => (settings.default_transcode_preset as TranscodePreset) ?? "none",
  );
  const batchPresetInitialized = useRef(false);
  useEffect(() => {
    if (batchPresetInitialized.current) return;
    if (settings.default_transcode_preset) {
      setBatchTranscode(settings.default_transcode_preset as TranscodePreset);
      batchPresetInitialized.current = true;
    }
  }, [settings.default_transcode_preset]);

  // Worker count is settings-driven. When user bumps concurrency, the
  // useEffect that spawns workers picks up the new ceiling and spins
  // additional loops if there's queued work.
  const downloadWorkers = Math.max(1, Math.min(6, settings.download_concurrency));

  const jobsRef = useRef<QueueJob[]>([]);
  jobsRef.current = jobs;
  const claimedRef = useRef<Set<string>>(new Set());
  const activeWorkersRef = useRef(0);

  useEffect(() => {
    let unlistenDl: UnlistenFn | null = null;
    let unlistenTx: UnlistenFn | null = null;
    listen<ProgressEvent>("download:progress", (e) => {
      const id = e.payload.job_id;
      if (!id) return;
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, progress: e.payload } : j)));
    }).then((fn) => {
      unlistenDl = fn;
    });
    listen<TranscodeProgress>("transcode:progress", (e) => {
      const id = e.payload.job_id;
      if (!id) return;
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, transcodeProgress: e.payload } : j)));
    }).then((fn) => {
      unlistenTx = fn;
    });
    return () => {
      unlistenDl?.();
      unlistenTx?.();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(jobs));
    } catch {
      // Quota exceeded — skip this tick.
    }
  }, [jobs]);

  useEffect(() => {
    const queuedUnclaimed = jobs.some(
      (j) => j.status === "queued" && !claimedRef.current.has(j.id),
    );
    if (!queuedUnclaimed) return;
    while (activeWorkersRef.current < downloadWorkers) {
      activeWorkersRef.current++;
      void workerLoop().finally(() => {
        activeWorkersRef.current--;
      });
    }
    // Re-runs when downloadWorkers changes too — bumping concurrency
    // mid-session spawns more loops to consume the new headroom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, downloadWorkers]);

  function updateJob(id: string, patch: Partial<QueueJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  /**
   * One worker. Pulls the next unclaimed queued job, processes it
   * through download + (optional) transcode, then loops. Exits when
   * no more queued work.
   *
   * Concurrency:
   *   - N workers download in parallel (default 3)
   *   - CPU transcodes serialize via cpuTranscodeSem
   *   - GPU transcodes serialize separately via gpuTranscodeSem
   *   - A CPU job and a GPU job CAN run simultaneously (disjoint HW)
   */
  async function workerLoop(): Promise<void> {
    while (true) {
      let next: QueueJob | undefined;
      for (const j of jobsRef.current) {
        if (j.status === "queued" && !claimedRef.current.has(j.id)) {
          next = j;
          claimedRef.current.add(j.id);
          break;
        }
      }
      if (!next) return;
      try {
        await processOne(next);
      } catch (e) {
        updateJob(next.id, { status: "failed", error: String(e) });
      }
    }
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

    const bestVideo =
      meta.formats
        .filter((f) => f.has_video)
        .reduce<FormatOption | null>(
          (best, f) => ((f.filesize_bytes ?? 0) > (best?.filesize_bytes ?? 0) ? f : best),
          null,
        ) ?? null;

    updateJob(job.id, {
      status: "downloading",
      title: meta.title,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
      duration_sec: meta.duration_sec,
    });

    let dlRes: DownloadResult;
    try {
      // Batch queue is always full-video (no segments) — multi-segment
      // is a single-URL workflow. The 0.6.1 yt_download returns a Vec,
      // so unwrap the single element. Empty/None segments triggers the
      // full-video path on the Rust side.
      const results = await invoke<DownloadResult[]>("yt_download", {
        url: job.url,
        formatSpec: "bv*+ba/b",
        mergeContainer: "mp4",
        totalBytesHint: bestVideo?.filesize_bytes ?? null,
        videoId: meta.id,
        segments: null,
        jobId: job.id,
        // Per-job projectId snapshot, locked at enqueue time. Phase B
        // honors this when computing dest dir on the Rust side.
        projectId: job.projectId,
      });
      dlRes = results[0];
    } catch (e) {
      updateJob(job.id, { status: "failed", error: String(e) });
      return;
    }

    const preset = job.transcodePreset;
    let finalPath = dlRes.path;
    let finalBytes = dlRes.bytes;
    let usedPreset: TranscodePreset = "none";

    if (preset !== "none") {
      const sem = isGpuPreset(preset) ? gpuTranscodeSem : cpuTranscodeSem;
      await sem.acquire();
      try {
        updateJob(job.id, { status: "transcoding", resultPath: dlRes.path });
        const txRes = await invoke<TranscodeResult>("media_transcode", {
          srcPath: dlRes.path,
          preset,
          totalSecHint: meta.duration_sec ?? null,
          jobId: job.id,
        });
        finalPath = txRes.path;
        finalBytes = txRes.bytes;
        usedPreset = preset;
        updateJob(job.id, { status: "done", resultPath: txRes.path, resultBytes: txRes.bytes });
      } catch (e) {
        updateJob(job.id, {
          status: "failed",
          resultPath: dlRes.path,
          resultBytes: dlRes.bytes,
          error: `transcode failed: ${String(e)} (source kept)`,
        });
      } finally {
        sem.release();
      }
    } else {
      updateJob(job.id, { status: "done", resultPath: dlRes.path, resultBytes: dlRes.bytes });
    }

    const assetId = await recordInLibrary({
      source_url: job.url,
      platform: "youtube",
      video_id: meta.id,
      channel: meta.channel,
      title: meta.title,
      duration_sec: meta.duration_sec,
      in_sec: null,
      out_sec: null,
      file_path: finalPath,
      file_size: finalBytes,
      container: extFromPath(finalPath),
      codec_video: videoCodecFor(usedPreset, bestVideo?.vcodec),
      codec_audio: audioCodecFor(usedPreset, null),
      width: bestVideo?.width ?? null,
      height: bestVideo?.height ?? null,
      fps: bestVideo?.fps ?? null,
      transcoded_to: usedPreset === "none" ? null : usedPreset,
      thumbnail_url: meta.thumbnail,
      // Project assignment is captured at enqueue time below; we
      // resolve it from the job, not the live `scope` ref.
      project_id: job.projectId ?? null,
    });
    if (assetId) {
      void attachLocalThumbnail(assetId, finalPath, meta.duration_sec ?? null);
    }
  }

  function queueAll() {
    const urls = urlsInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) return;
    const presetSnapshot = batchTranscode;
    // Snapshot the project assignment too — same reasoning as the
    // preset capture: the user's expectation is that what they
    // pressed Queue with is what runs, even if they switch scope
    // afterward. Ctrl+Space override applies to the whole batch.
    const projectSnapshot =
      !overrideLibrary && scope.kind === "project" ? scope.id : null;
    const newJobs: QueueJob[] = urls.map((url) => ({
      id: newJobId(),
      url,
      status: "queued",
      transcodePreset: presetSnapshot,
      projectId: projectSnapshot,
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    setUrlsInput("");
  }

  function clearCompleted() {
    setJobs((prev) => {
      const removed = prev.filter((j) => j.status === "done" || j.status === "failed");
      for (const j of removed) claimedRef.current.delete(j.id);
      return prev.filter((j) => j.status !== "done" && j.status !== "failed");
    });
  }

  function retryFailed() {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.status !== "failed") return j;
        claimedRef.current.delete(j.id);
        return {
          ...j,
          status: "queued" as QueueStatus,
          error: undefined,
          progress: undefined,
          transcodeProgress: undefined,
          resultPath: undefined,
          resultBytes: undefined,
        };
      }),
    );
  }

  const stats = (() => {
    if (jobs.length === 0) return "";
    const counts: Record<QueueStatus, number> = {
      queued: 0,
      fetching: 0,
      downloading: 0,
      transcoding: 0,
      done: 0,
      failed: 0,
    };
    for (const j of jobs) counts[j.status]++;
    const active = counts.downloading + counts.transcoding + counts.fetching;
    const parts: string[] = [];
    if (active) parts.push(`${active} active`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    return parts.join(" · ");
  })();

  return (
    <section className="card-box">
      <h2>
        Batch queue <span className="chip">parallel × {downloadWorkers}</span>
      </h2>
      <p className="hint">
        Paste one URL per line, hit Queue all. Each downloads at the best
        available video + audio (mp4). {downloadWorkers} downloads run in
        parallel; transcodes serialize (CPU + GPU pools run independently,
        so a libx264 job and an NVENC job can overlap). Queue persists
        across app restarts.
      </p>

      <textarea
        className="field-input"
        rows={4}
        placeholder={"https://www.youtube.com/watch?v=…\nhttps://www.youtube.com/watch?v=…"}
        value={urlsInput}
        onChange={(e) => setUrlsInput(e.target.value)}
        spellCheck={false}
      />

      <div className="bar" style={{ borderTop: 0, padding: "8px 0 4px" }}>
        <span className="label">transcode all</span>
        <select
          className="field-select"
          value={batchTranscode}
          onChange={(e) => setBatchTranscode(e.target.value as TranscodePreset)}
        >
          {TRANSCODE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="hint-text">
          {TRANSCODE_PRESETS.find((p) => p.value === batchTranscode)?.hint}
        </span>
      </div>

      <div className="queue-actions">
        <button
          className={"btn" + (overrideLibrary ? " btn-override" : "")}
          onClick={queueAll}
          disabled={!urlsInput.trim()}
          title={overrideLibrary ? "Queue into Library (Ctrl held)" : undefined}
        >
          {overrideLibrary ? "Queue → Library" : "Queue all"}
        </button>
        <button className="btn btn-secondary" onClick={clearCompleted}>
          Clear completed
        </button>
        {jobs.some((j) => j.status === "failed") && (
          <button className="btn btn-secondary" onClick={retryFailed}>
            <Icon.retry width={12} height={12} /> Retry failed
          </button>
        )}
        <span className="stats">{stats}</span>
      </div>

      {jobs.length > 0 && (
        <ul className="queue-list">
          {jobs.map((job) => (
            <QueueRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({ job }: { job: QueueJob }) {
  const pillClass =
    job.status === "done"
      ? "pill ok"
      : job.status === "failed"
        ? "pill err"
        : job.status === "queued"
          ? "pill queued"
          : "pill live";

  return (
    <li className="queue-row">
      <div className="queue-thumb">
        {job.thumbnail ? (
          <img src={job.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="queue-thumb-empty" />
        )}
      </div>
      <div className="queue-body">
        <div className="queue-title">{job.title ?? job.url}</div>
        <div className="queue-meta">
          {job.channel
            ? `${job.channel}${job.duration_sec ? ` · ${fmtDuration(job.duration_sec)}` : ""}`
            : job.url}
        </div>

        {job.status === "downloading" && (
          <div className="dl-progress" style={{ padding: "6px 0 0" }}>
            <div className="progress">
              <i
                className={job.progress?.percent == null ? "indet" : ""}
                style={{
                  width: job.progress?.percent != null ? `${Math.min(100, job.progress.percent)}%` : undefined,
                }}
              />
            </div>
            <div className="dl-progress-meta">
              <span>{job.progress?.percent != null ? `${job.progress.percent.toFixed(1)}%` : "starting…"}</span>
              <span>
                {fmtBytes(job.progress?.downloaded_bytes ?? 0)}
                {job.progress?.total_bytes ? ` / ${fmtBytes(job.progress.total_bytes)}` : ""}
              </span>
              {job.progress?.speed_bps != null && <span>{fmtBytes(job.progress.speed_bps)}/s</span>}
              {job.progress?.eta_sec != null && <span>ETA {fmtEta(job.progress.eta_sec)}</span>}
            </div>
          </div>
        )}

        {job.status === "transcoding" && (
          <div className="dl-progress" style={{ padding: "6px 0 0" }}>
            <div className="progress">
              <i
                className={job.transcodeProgress?.percent == null ? "indet" : ""}
                style={{
                  width:
                    job.transcodeProgress?.percent != null
                      ? `${Math.min(100, job.transcodeProgress.percent)}%`
                      : undefined,
                }}
              />
            </div>
            <div className="dl-progress-meta">
              <span>
                {job.transcodeProgress?.percent != null
                  ? `${job.transcodeProgress.percent.toFixed(1)}% · transcoding`
                  : "starting transcode…"}
              </span>
              {job.transcodeProgress && (
                <span>
                  {fmtEta(Math.floor(job.transcodeProgress.processed_sec))}
                  {job.transcodeProgress.total_sec
                    ? ` / ${fmtEta(Math.floor(job.transcodeProgress.total_sec))}`
                    : ""}
                </span>
              )}
              {job.transcodeProgress?.speed_mult != null && (
                <span>{job.transcodeProgress.speed_mult.toFixed(2)}×</span>
              )}
            </div>
          </div>
        )}

        {job.status === "done" && job.resultPath && (
          <div className="queue-done mono">
            <span>{fmtBytes(job.resultBytes ?? 0)}</span>
            <button className="btn btn-secondary" onClick={() => revealFile(job.resultPath!)}>
              <Icon.folder width={11} height={11} /> Open
            </button>
          </div>
        )}

        {job.status === "failed" && <div className="queue-error">{job.error}</div>}
      </div>
      <div className="queue-status">
        <span className={pillClass}>{job.status}</span>
      </div>
    </li>
  );
}

// Sidecar smoke test (0.1) lived here; removed once yt-dlp + ffmpeg
// versions stopped being interesting to verify daily. The Rust
// `binaries_version` command is still wired — re-add a tiny UI if we
// ever need it again (e.g. for a Settings → diagnostics panel).
