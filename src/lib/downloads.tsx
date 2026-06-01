/**
 * Downloads context (1.1.3) — owns ALL active download/transcode work
 * so it survives route navigation.
 *
 * Background
 * ----------
 * Before this module, both `MetadataCard` (single-URL download) and
 * `QueueCard` (batch queue) held their in-flight state in component-local
 * useState. Navigate to Library → components unmount → React state gone.
 * Meanwhile the Rust-spawned yt-dlp/ffmpeg children kept running,
 * untethered from the UI. Symptoms a tester reported (2026-05-25):
 *   - Single-URL download "disappeared" after nav, then ffmpeg ate CPU
 *     after closing the app (orphaned child process)
 *   - Queue rows showed as frozen "downloading" with no progress on
 *     return, because progress is too churny to persist and only lived
 *     in component state
 *
 * Design
 * ------
 * One provider mounted at App.tsx, above the Router. It owns:
 *   - `queueJobs[]`         — the multi-URL queue (replaces QueueCard local)
 *   - `singleDownload`      — the at-most-one active single-URL download
 *                              (replaces MetadataCard's progress/phase/err
 *                              state for the duration of an in-flight DL)
 *   - The download/transcode event listeners (attached once at mount,
 *     survive all route navs)
 *   - `workerLoop()` for the queue (runs in the provider — single source
 *     of truth, never re-spawned by component re-mount)
 *
 * Components become thin presenters. They `useDownloads()` for state +
 * dispatch actions (enqueue, startSingle, cancel, retry, clear).
 *
 * The provider also exposes `activeCount` for a global topbar indicator
 * so the user always sees download activity regardless of route.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { extFromPath } from "./format";
import { detectPlatform } from "./platforms";
import {
  attachLocalThumbnail,
  audioCodecFor,
  attachLocalWaveform,
  recordInLibrary,
  videoCodecFor,
} from "./library";
import type {
  DownloadResult,
  FormatOption,
  ProgressEvent,
  Segment,
  TranscodePreset,
  TranscodeProgress,
  TranscodeResult,
  VideoMetadata,
} from "./types";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export const SINGLE_URL_JOB_ID = "single-url";

export type QueueStatus =
  | "queued"
  | "fetching"
  | "downloading"
  | "transcoding"
  | "done"
  | "failed"
  | "canceled";

export type QueueJob = {
  id: string;
  url: string;
  status: QueueStatus;
  transcodePreset: TranscodePreset;
  /** Project id captured at enqueue time. NULL = Library. Locked at
   *  enqueue so changing the active scope mid-batch doesn't reroute
   *  already-queued jobs. */
  projectId: string | null;
  /** 1.2.0 — when set, the queue worker downloads audio-only via
   *  yt-dlp's `-x --audio-format` and skips the transcode step.
   *  Locked at enqueue (mirrors transcodePreset). UI: when the user
   *  enqueues from MetadataCard while Audio tab is active, every
   *  resulting job inherits the chosen format. */
  audioFormat?: AudioFormat | null;
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

export type SinglePhase = "idle" | "downloading" | "transcoding";

/**
 * Active single-URL download. At most one exists at a time. While
 * `phase !== "idle"`, the topbar indicator counts this. After the
 * download completes (phase back to "idle"), result/error stays for
 * the UI to display until the user starts a new download (which
 * resets fields) or explicitly dismisses.
 */
export type SingleDownload = {
  jobId: string;
  url: string;
  title?: string;
  thumbnailUrl?: string | null;
  phase: SinglePhase;
  progress: ProgressEvent | null;
  transcodeProgress: TranscodeProgress | null;
  error: string | null;
  result: DownloadResult | null;
  downloadedPaths: string[];
};

/** Arguments to start a single-URL download (collected by MetadataCard). */
export type StartSingleArgs = {
  url: string;
  formatSpec: string;
  mergeContainer: string | null;
  totalBytesHint: number | null;
  videoId: string;
  segments: Segment[] | null;
  projectId: string | null;
  transcodePreset: TranscodePreset;
  // Metadata used for library recording after success
  meta: VideoMetadata;
  pickedFormat: FormatOption | null;
  /** 1.2.0 — when set, yt-dlp extracts audio and converts to this
   *  container instead of doing a video download. Skips transcode
   *  step entirely (audio assets don't need NLE intermediates) and
   *  generates a waveform PNG instead of a frame thumbnail. */
  audioFormat?: AudioFormat | null;
};

/** Audio container we ship to yt-dlp's `--audio-format`. Each maps to
 *  a sensible default bitrate (MP3 → 320 CBR, M4A → 256 AAC, FLAC
 *  lossless) chosen server-side; no bitrate picker in the UI. */
export type AudioFormat = "mp3" | "m4a" | "flac";

// ---------------------------------------------------------------------
// Module-level pieces — survive HMR + provider re-mounts
// ---------------------------------------------------------------------

// Concurrency semaphores. CPU and GPU encodes run in parallel with
// each other (disjoint hardware) but each saturates at 1 concurrent
// job. Module-level keeps semaphores singletons across remounts.
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

const cpuTranscodeSem = new Semaphore(1);
const gpuTranscodeSem = new Semaphore(1);

export function newJobId(): string {
  return `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const QUEUE_STORAGE_KEY = "mh.queue.v1";

function loadQueueFromStorage(): QueueJob[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueJob[];
    // 1.1.3 — any "in-flight" row at boot is by definition orphaned
    // (the Rust process was killed when the app last closed; close
    // protection is best-effort but a crash can leave them). Reset
    // to "queued" so the worker picks them up; null out churn fields.
    return parsed.map((j) => {
      if (j.status === "fetching" || j.status === "downloading" || j.status === "transcoding") {
        return {
          ...j,
          status: "queued" as QueueStatus,
          progress: undefined,
          transcodeProgress: undefined,
        };
      }
      return { ...j, progress: undefined, transcodeProgress: undefined };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------

type DownloadsContextValue = {
  // Queue
  queueJobs: QueueJob[];
  enqueueUrls: (
    urls: string[],
    opts: {
      transcodePreset: TranscodePreset;
      projectId: string | null;
      /** 1.2.0 — when set, every enqueued job runs in audio mode
       *  with the chosen container. transcodePreset is ignored. */
      audioFormat?: AudioFormat | null;
    },
  ) => void;
  cancelQueueJob: (id: string) => Promise<void>;
  removeQueueJobs: (predicate: (j: QueueJob) => boolean) => void;
  retryFailedJobs: () => void;
  clearCompletedJobs: () => void;
  updateQueueJob: (id: string, patch: Partial<QueueJob>) => void;
  // Single-URL
  singleDownload: SingleDownload | null;
  startSingleDownload: (args: StartSingleArgs) => Promise<void>;
  cancelSingleDownload: () => Promise<void>;
  resetSingleDownload: () => void;
  // Computed
  activeCount: number;
  hasActiveWork: boolean;
};

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

// ---------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------

export function DownloadsProvider({
  children,
  downloadConcurrency,
}: {
  children: ReactNode;
  /** Mirrors settings.download_concurrency. Bumping it mid-session
   *  spawns more worker loops to consume the new headroom. */
  downloadConcurrency: number;
}) {
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>(() => loadQueueFromStorage());
  const [singleDownload, setSingleDownload] = useState<SingleDownload | null>(null);

  // Persist queue. Done state survives nav/reload; in-flight gets
  // re-queued on next boot via loadQueueFromStorage (above).
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueJobs));
    } catch {
      /* quota — skip */
    }
  }, [queueJobs]);

  const jobsRef = useRef<QueueJob[]>([]);
  jobsRef.current = queueJobs;
  const singleRef = useRef<SingleDownload | null>(null);
  singleRef.current = singleDownload;
  const claimedRef = useRef<Set<string>>(new Set());
  const activeWorkersRef = useRef(0);
  const workerCeilingRef = useRef(downloadConcurrency);
  workerCeilingRef.current = downloadConcurrency;

  const updateQueueJob = useCallback((id: string, patch: Partial<QueueJob>) => {
    setQueueJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  // Mutate the active single download in-place (safe via ref guard).
  function patchSingle(patch: Partial<SingleDownload>) {
    setSingleDownload((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // -----------------------------------------------------------------
  // Global event listeners (attached once at mount)
  // -----------------------------------------------------------------
  // These survive every route navigation — that's the whole point of
  // lifting state up here. Progress events route to either the matching
  // queue job or the single-URL download by job_id.
  useEffect(() => {
    let unlistenDl: UnlistenFn | null = null;
    let unlistenTx: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      const dl = await listen<ProgressEvent>("download:progress", (e) => {
        const id = e.payload.job_id;
        if (!id) return;
        if (id === SINGLE_URL_JOB_ID) {
          patchSingle({ progress: e.payload });
          return;
        }
        setQueueJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, progress: e.payload } : j)),
        );
      });
      const tx = await listen<TranscodeProgress>("transcode:progress", (e) => {
        const id = e.payload.job_id;
        if (!id) return;
        if (id === SINGLE_URL_JOB_ID) {
          patchSingle({ transcodeProgress: e.payload });
          return;
        }
        setQueueJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, transcodeProgress: e.payload } : j)),
        );
      });
      if (cancelled) {
        dl();
        tx();
      } else {
        unlistenDl = dl;
        unlistenTx = tx;
      }
    })();
    return () => {
      cancelled = true;
      unlistenDl?.();
      unlistenTx?.();
    };
  }, []);

  // -----------------------------------------------------------------
  // Queue worker loop (also persistent — never re-spawned)
  // -----------------------------------------------------------------
  /**
   * One worker. Pulls next unclaimed queued job, processes through
   * download + (optional) transcode, loops. Exits when no queued work.
   * Concurrency: N parallel workers; CPU vs GPU transcodes serialize
   * via dedicated semaphores.
   */
  const workerLoop = useCallback(async () => {
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
        updateQueueJob(next.id, { status: "failed", error: String(e) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processOne = useCallback(
    async (job: QueueJob) => {
      updateQueueJob(job.id, { status: "fetching" });
      let meta: VideoMetadata;
      try {
        meta = await invoke<VideoMetadata>("yt_fetch_metadata", { url: job.url });
      } catch (e) {
        updateQueueJob(job.id, { status: "failed", error: String(e) });
        return;
      }

      const bestVideo =
        meta.formats
          .filter((f) => f.has_video)
          .reduce<FormatOption | null>(
            (best, f) =>
              (f.filesize_bytes ?? 0) > (best?.filesize_bytes ?? 0) ? f : best,
            null,
          ) ?? null;

      updateQueueJob(job.id, {
        status: "downloading",
        title: meta.title,
        channel: meta.channel,
        thumbnail: meta.thumbnail,
        duration_sec: meta.duration_sec,
      });

      let dlRes: DownloadResult;
      const isAudio = !!job.audioFormat;
      try {
        const results = await invoke<DownloadResult[]>("yt_download", {
          url: job.url,
          // Audio jobs: bestaudio. Video jobs: best video + best audio
          // muxed into MP4 (queue's existing default).
          formatSpec: isAudio ? "bestaudio/best" : "bv*+ba/b",
          mergeContainer: isAudio ? null : "mp4",
          totalBytesHint: isAudio ? null : (bestVideo?.filesize_bytes ?? null),
          videoId: meta.id,
          segments: null,
          jobId: job.id,
          projectId: job.projectId,
          audioFormat: job.audioFormat ?? null,
        });
        dlRes = results[0];
      } catch (e) {
        const msg = String(e);
        if (
          msg.includes("__canceled__") ||
          jobsRef.current.find((j) => j.id === job.id)?.status === "canceled"
        ) {
          updateQueueJob(job.id, { status: "canceled", error: undefined });
          return;
        }
        updateQueueJob(job.id, { status: "failed", error: msg });
        return;
      }

      // Audio jobs skip transcode (NLE intermediates make no sense
      // for an MP3). Mirrors the single-URL flow's behavior.
      const preset = isAudio ? "none" : job.transcodePreset;
      let finalPath = dlRes.path;
      let finalBytes = dlRes.bytes;
      let usedPreset: TranscodePreset = "none";

      if (preset !== "none") {
        const sem = isGpuPreset(preset) ? gpuTranscodeSem : cpuTranscodeSem;
        await sem.acquire();
        try {
          updateQueueJob(job.id, { status: "transcoding", resultPath: dlRes.path });
          const txRes = await invoke<TranscodeResult>("media_transcode", {
            srcPath: dlRes.path,
            preset,
            totalSecHint: meta.duration_sec ?? null,
            jobId: job.id,
          });
          finalPath = txRes.path;
          finalBytes = txRes.bytes;
          usedPreset = preset;
          updateQueueJob(job.id, {
            status: "done",
            resultPath: txRes.path,
            resultBytes: txRes.bytes,
          });
        } catch (e) {
          updateQueueJob(job.id, {
            status: "failed",
            resultPath: dlRes.path,
            resultBytes: dlRes.bytes,
            error: `transcode failed: ${String(e)} (source kept)`,
          });
        } finally {
          sem.release();
        }
      } else {
        updateQueueJob(job.id, {
          status: "done",
          resultPath: dlRes.path,
          resultBytes: dlRes.bytes,
        });
      }

      const assetId = await recordInLibrary({
        source_url: job.url,
        // 1.3.x — was hardcoded "youtube" for every source, which
        // mislabeled TikTok/X/Pinterest clips on library cards.
        // Same detector the Download page uses for sticky-format keys
        // so behavior stays consistent across both flows.
        platform: detectPlatform(job.url),
        video_id: meta.id,
        channel: meta.channel,
        title: meta.title,
        duration_sec: meta.duration_sec,
        in_sec: null,
        out_sec: null,
        file_path: finalPath,
        file_size: finalBytes,
        container: extFromPath(finalPath),
        codec_video: isAudio ? null : videoCodecFor(usedPreset, bestVideo?.vcodec),
        codec_audio: isAudio ? (job.audioFormat ?? null) : audioCodecFor(usedPreset, null),
        width: isAudio ? null : bestVideo?.width ?? null,
        height: isAudio ? null : bestVideo?.height ?? null,
        fps: isAudio ? null : bestVideo?.fps ?? null,
        transcoded_to: usedPreset === "none" ? null : usedPreset,
        thumbnail_url: meta.thumbnail,
        project_id: job.projectId ?? null,
        kind: isAudio ? "audio" : "video",
      });
      if (assetId) {
        if (isAudio) {
          void attachLocalWaveform(assetId, finalPath);
        } else {
          void attachLocalThumbnail(assetId, finalPath, meta.duration_sec ?? null);
        }
      }
    },
    [updateQueueJob],
  );

  // Spawn workers whenever there's queued work and we're below ceiling.
  useEffect(() => {
    const queuedUnclaimed = queueJobs.some(
      (j) => j.status === "queued" && !claimedRef.current.has(j.id),
    );
    if (!queuedUnclaimed) return;
    while (activeWorkersRef.current < workerCeilingRef.current) {
      activeWorkersRef.current++;
      void workerLoop().finally(() => {
        activeWorkersRef.current--;
      });
    }
  }, [queueJobs, downloadConcurrency, workerLoop]);

  // -----------------------------------------------------------------
  // Queue actions
  // -----------------------------------------------------------------
  const enqueueUrls = useCallback<DownloadsContextValue["enqueueUrls"]>(
    (urls, opts) => {
      if (urls.length === 0) return;
      const newJobs: QueueJob[] = urls.map((url) => ({
        id: newJobId(),
        url,
        status: "queued" as QueueStatus,
        transcodePreset: opts.transcodePreset,
        projectId: opts.projectId,
        audioFormat: opts.audioFormat ?? null,
      }));
      setQueueJobs((prev) => [...prev, ...newJobs]);
    },
    [],
  );

  const cancelQueueJob = useCallback<DownloadsContextValue["cancelQueueJob"]>(
    async (id) => {
      updateQueueJob(id, { status: "canceled" });
      try {
        await invoke<boolean>("yt_download_cancel", { jobId: id });
      } catch (e) {
        console.warn("[cancel] yt_download_cancel failed:", e);
      }
    },
    [updateQueueJob],
  );

  const removeQueueJobs = useCallback<DownloadsContextValue["removeQueueJobs"]>(
    (predicate) => {
      setQueueJobs((prev) => {
        const removed = prev.filter(predicate);
        for (const j of removed) claimedRef.current.delete(j.id);
        return prev.filter((j) => !predicate(j));
      });
    },
    [],
  );

  const retryFailedJobs = useCallback(() => {
    setQueueJobs((prev) =>
      prev.map((j) => {
        if (j.status !== "failed") return j;
        claimedRef.current.delete(j.id);
        return {
          ...j,
          status: "queued" as QueueStatus,
          error: undefined,
          progress: undefined,
          transcodeProgress: undefined,
        };
      }),
    );
  }, []);

  const clearCompletedJobs = useCallback(() => {
    setQueueJobs((prev) => {
      const terminal = (s: QueueStatus) =>
        s === "done" || s === "failed" || s === "canceled";
      const removed = prev.filter((j) => terminal(j.status));
      for (const j of removed) claimedRef.current.delete(j.id);
      return prev.filter((j) => !terminal(j.status));
    });
  }, []);

  // -----------------------------------------------------------------
  // Single-URL flow
  // -----------------------------------------------------------------
  const startSingleDownload = useCallback<DownloadsContextValue["startSingleDownload"]>(
    async (args) => {
      // Fresh slate.
      setSingleDownload({
        jobId: SINGLE_URL_JOB_ID,
        url: args.url,
        title: args.meta.title,
        thumbnailUrl: args.meta.thumbnail,
        phase: "downloading",
        progress: null,
        transcodeProgress: null,
        error: null,
        result: null,
        downloadedPaths: [],
      });
      try {
        // Rust expects [inSec, outSec] tuples, not Segment objects.
        const rustSegments = args.segments
          ? args.segments.map((s) => [s.inSec, s.outSec] as [number, number])
          : null;
        const results = await invoke<DownloadResult[]>("yt_download", {
          url: args.url,
          formatSpec: args.formatSpec,
          mergeContainer: args.mergeContainer,
          totalBytesHint: args.totalBytesHint,
          videoId: args.videoId,
          segments: rustSegments && rustSegments.length > 0 ? rustSegments : null,
          jobId: SINGLE_URL_JOB_ID,
          projectId: args.projectId,
          audioFormat: args.audioFormat ?? null,
        });

        // Audio mode forces preset to "none" — video transcode presets
        // would be nonsensical on an MP3/M4A/FLAC. We skip the whole
        // transcode block by overriding the preset locally.
        const preset = args.audioFormat ? "none" : args.transcodePreset;
        let finalPaths = results.map((r) => r.path);
        let usedPreset: TranscodePreset = "none";

        if (preset !== "none") {
          patchSingle({ phase: "transcoding" });
          const txResults: TranscodeResult[] = [];
          for (const r of results) {
            try {
              const txRes = await invoke<TranscodeResult>("media_transcode", {
                srcPath: r.path,
                preset,
                totalSecHint: args.meta.duration_sec ?? null,
                jobId: SINGLE_URL_JOB_ID,
              });
              txResults.push(txRes);
            } catch (e) {
              patchSingle({
                error: `Transcode failed: ${String(e)} (source download kept)`,
              });
              // Keep original path; abort transcode loop.
              break;
            }
          }
          if (txResults.length > 0) {
            finalPaths = txResults.map((t) => t.path);
            usedPreset = preset;
          }
        }

        // Record each final path in the library.
        for (let i = 0; i < finalPaths.length; i++) {
          const path = finalPaths[i];
          const original = results[i];
          const seg = args.segments?.[i] ?? null;
          const isAudio = !!args.audioFormat;
          const assetId = await recordInLibrary({
            source_url: args.url,
            // 1.3.x — see note in queue worker above. detectPlatform
            // covers YT / Twitter / TikTok / Pinterest, plus "other"
            // for anything yt-dlp can chew through without us caring.
            platform: detectPlatform(args.url),
            video_id: args.meta.id,
            channel: args.meta.channel,
            title: args.meta.title,
            duration_sec: args.meta.duration_sec,
            in_sec: seg?.inSec ?? null,
            out_sec: seg?.outSec ?? null,
            file_path: path,
            file_size: original?.bytes ?? null,
            container: extFromPath(path),
            // Audio assets: no video codec. codec_audio carries the
            // chosen audio container name ("mp3"/"m4a"/"flac") so the
            // library card can render a tidy chip.
            codec_video: isAudio ? null : videoCodecFor(usedPreset, args.pickedFormat?.vcodec),
            codec_audio: isAudio ? (args.audioFormat ?? null) : audioCodecFor(usedPreset, null),
            width: isAudio ? null : args.pickedFormat?.width ?? null,
            height: isAudio ? null : args.pickedFormat?.height ?? null,
            fps: isAudio ? null : args.pickedFormat?.fps ?? null,
            transcoded_to: usedPreset === "none" ? null : usedPreset,
            thumbnail_url: args.meta.thumbnail,
            project_id: args.projectId,
            kind: isAudio ? "audio" : "video",
          });
          if (assetId) {
            // Waveform PNG for audio, frame JPG for video. Both land
            // at _thumbnails/<asset_id>.{png,jpg} and the library
            // resolves either via thumbnailSrc().
            if (isAudio) {
              void attachLocalWaveform(assetId, path);
            } else {
              void attachLocalThumbnail(
                assetId,
                path,
                args.meta.duration_sec ?? null,
              );
            }
          }
        }

        setSingleDownload((prev) =>
          prev
            ? {
                ...prev,
                phase: "idle",
                result: { path: finalPaths[finalPaths.length - 1], bytes: null },
                downloadedPaths: finalPaths,
                progress: null,
                transcodeProgress: null,
              }
            : prev,
        );
      } catch (e) {
        const msg = String(e);
        setSingleDownload((prev) =>
          prev
            ? {
                ...prev,
                phase: "idle",
                error: msg.includes("__canceled__") ? "Canceled" : msg,
                progress: null,
                transcodeProgress: null,
              }
            : prev,
        );
      }
    },
    [],
  );

  const cancelSingleDownload = useCallback(async () => {
    try {
      await invoke<boolean>("yt_download_cancel", { jobId: SINGLE_URL_JOB_ID });
    } catch (e) {
      console.warn("[cancel] yt_download_cancel single failed:", e);
    }
  }, []);

  const resetSingleDownload = useCallback(() => setSingleDownload(null), []);

  // -----------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------
  const activeCount = useMemo(() => {
    let n = 0;
    for (const j of queueJobs) {
      if (j.status === "fetching" || j.status === "downloading" || j.status === "transcoding") n++;
    }
    if (singleDownload && singleDownload.phase !== "idle") n++;
    return n;
  }, [queueJobs, singleDownload]);

  const hasActiveWork = activeCount > 0;

  const value: DownloadsContextValue = {
    queueJobs,
    enqueueUrls,
    cancelQueueJob,
    removeQueueJobs,
    retryFailedJobs,
    clearCompletedJobs,
    updateQueueJob,
    singleDownload,
    startSingleDownload,
    cancelSingleDownload,
    resetSingleDownload,
    activeCount,
    hasActiveWork,
  };

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloads must be used inside <DownloadsProvider>");
  return ctx;
}
