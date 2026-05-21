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
  audioCodecFor,
  recordInLibrary,
  revealFile,
  videoCodecFor,
} from "../lib/library";
import type {
  DownloadResult,
  FormatOption,
  ProgressEvent,
  SidecarVersion,
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
  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Download</div>
        <span className="ch-meta">paste · pick · trim · transcode</span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          single-URL above · batch queue below
        </span>
      </div>
      <div className="content-body">
        <div className="stack">
          <MetadataCard />
          <QueueCard />
          <SmokeCard />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Metadata + single-URL download
// =====================================================================
function MetadataCard() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFormats, setShowFormats] = useState(false);

  const [selectedFormat, setSelectedFormat] = useState<FormatOption | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlResult, setDlResult] = useState<DownloadResult | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [inStr, setInStr] = useState("");
  const [outStr, setOutStr] = useState("");

  const [transcodePreset, setTranscodePreset] = useState<TranscodePreset>("none");
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
    try {
      const out = await invoke<VideoMetadata>("yt_fetch_metadata", { url });
      setMeta(out);
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
        setDlErr(`Out (${outSec}s) exceeds video duration (${Math.floor(meta.duration_sec)}s)`);
        return;
      }
    }

    const bytesHint = selectedFormat.filesize_bytes;

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

      let finalRes = dlRes;
      let usedPreset: TranscodePreset = "none";
      if (transcodePreset !== "none") {
        setPhase("transcoding");
        const totalSecHint =
          inSec != null && outSec != null ? outSec - inSec : meta?.duration_sec ?? null;
        try {
          const txRes = await invoke<TranscodeResult>("media_transcode", {
            srcPath: dlRes.path,
            preset: transcodePreset,
            totalSecHint,
            jobId: null,
          });
          finalRes = txRes;
          usedPreset = transcodePreset;
          setDlResult(txRes);
        } catch (e) {
          setDlErr(`transcode failed: ${String(e)} (source kept: ${dlRes.path})`);
          setDlResult(dlRes);
        }
      } else {
        setDlResult(dlRes);
      }

      void recordInLibrary({
        source_url: url,
        platform: "youtube",
        video_id: meta?.id ?? null,
        channel: meta?.channel ?? null,
        title: meta?.title ?? url,
        duration_sec: meta?.duration_sec ?? null,
        in_sec: inSec,
        out_sec: outSec,
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
      });
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
        format, optionally trim a segment (In/Out), optionally transcode to an
        editing-friendly intermediate, and saves to <code>~/Media Hub/Downloads/_test/</code>.
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
              {inStr || outStr
                ? "Downloads full source, then ffmpeg stream-copy trim (~5–15s, no quality loss)."
                : "mm:ss · hh:mm:ss · or seconds. Leave both empty for full video."}
            </span>
          </div>

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
                  <span className="dlbar-dest">→ ~/Media Hub/Downloads/_test/</span>
                </>
              ) : (
                <span className="faint">Click a format row above, then download.</span>
              )}
            </div>
            <button className="btn" onClick={download} disabled={!selectedFormat || downloading}>
              <Icon.download width={13} height={13} />
              {downloading ? "Downloading…" : "Download"}
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

          {dlResult && (
            <div className="msg-row ok">
              <span className="label">downloaded</span>
              <code>{dlResult.path}</code>
              <button className="btn-secondary btn" onClick={() => revealFile(dlResult.path)}>
                <Icon.folder width={12} height={12} /> Open
              </button>
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

const DOWNLOAD_WORKERS = 3;
const cpuTranscodeSem = new Semaphore(1);
const gpuTranscodeSem = new Semaphore(1);

function QueueCard() {
  const [urlsInput, setUrlsInput] = useState("");
  const [jobs, setJobs] = useState<QueueJob[]>(() => loadQueueFromStorage());
  const [batchTranscode, setBatchTranscode] = useState<TranscodePreset>("none");

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
    while (activeWorkersRef.current < DOWNLOAD_WORKERS) {
      activeWorkersRef.current++;
      void workerLoop().finally(() => {
        activeWorkersRef.current--;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

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
      dlRes = await invoke<DownloadResult>("yt_download", {
        url: job.url,
        formatSpec: "bv*+ba/b",
        mergeContainer: "mp4",
        totalBytesHint: bestVideo?.filesize_bytes ?? null,
        videoId: meta.id,
        inSec: null,
        outSec: null,
        jobId: job.id,
      });
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

    void recordInLibrary({
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
    });
  }

  function queueAll() {
    const urls = urlsInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) return;
    const presetSnapshot = batchTranscode;
    const newJobs: QueueJob[] = urls.map((url) => ({
      id: newJobId(),
      url,
      status: "queued",
      transcodePreset: presetSnapshot,
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
        Batch queue <span className="chip">parallel × {DOWNLOAD_WORKERS}</span>
      </h2>
      <p className="hint">
        Paste one URL per line, hit Queue all. Each downloads at the best
        available video + audio (mp4). {DOWNLOAD_WORKERS} downloads run in
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
        <button className="btn" onClick={queueAll} disabled={!urlsInput.trim()}>
          Queue all
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

// =====================================================================
// Sidecar smoke test (0.1 baseline)
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
    <section className="card-box">
      <h2>
        Sidecar smoke test <span className="chip">0.1 baseline</span>
      </h2>
      <p className="hint">
        Spawns <code>yt-dlp --version</code> and <code>ffmpeg -version</code> via the Rust backend.
      </p>
      <div>
        <button className="btn btn-secondary" onClick={runSmokeTest} disabled={loading}>
          {loading ? "Running…" : "Run smoke test"}
        </button>
      </div>
      {err && (
        <div className="msg-row err">
          <span className="label">error</span>
          <code>{err}</code>
        </div>
      )}
      {results && (
        <ul className="queue-list" style={{ marginTop: 4 }}>
          {results.map((r) => (
            <li key={r.name} className={"msg-row " + (r.ok ? "ok" : "err")}>
              <span className="label">{r.name}</span>
              <code>{r.ok ? r.version : r.error ?? "(unknown error)"}</code>
              <span className="mono faint">{r.ok ? "ok" : "fail"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
