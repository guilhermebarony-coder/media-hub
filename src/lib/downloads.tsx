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
import { detectPlatform, isDirectMediaUrl, prettyDirectTitle } from "./platforms";
import {
  attachBestThumbnail,
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

/** 1.12.x — fully-specified download carried by a queue job. Present when
 *  the job came from the Download card's "Download" button: the card
 *  already fetched metadata and the user already picked format/segments/
 *  transcode, so the queue worker must NOT re-decide any of it. Slim by
 *  design (no VideoMetadata — its formats[] array is huge and this gets
 *  persisted to localStorage). Segments are Rust-shaped [in,out] tuples. */
export type QueueJobSpec = {
  formatSpec: string;
  mergeContainer: string | null;
  totalBytesHint: number | null;
  videoId: string;
  segments: Array<[number, number]> | null;
  metaTitle: string;
  metaChannel: string | null;
  metaDuration: number | null;
  pfVcodec: string | null;
  pfWidth: number | null;
  pfHeight: number | null;
  pfFps: number | null;
};

/** 1.13.x — a queue job that transcodes an EXISTING library asset (not a
 *  download). Runs media_transcode on the asset's file, records the
 *  output as a new library row, and — when replaceOriginal — moves the
 *  source row to the in-app Trash so the library shows only the
 *  transcoded version. Carried metadata seeds the new row. */
export type QueueTranscodeSpec = {
  assetId: string;
  srcPath: string;
  preset: TranscodePreset;
  replaceOriginal: boolean;
  title: string;
  sourceUrl: string;
  platform: string;
  videoId: string | null;
  channel: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  thumbnailUrl: string | null;
  projectId: string | null;
};

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
  /** 1.13.x — per-job max-quality override (from the extension quick
   *  menu). When set, wins over the global Settings max-quality for this
   *  job only. Numeric height string ("1080") or "" for best. */
  maxQualityOverride?: string;
  /** 1.13.x — per-job title override (extension "rename" field). Used
   *  for the library row's title instead of the fetched metadata title. */
  titleOverride?: string;
  /** 1.13.x — which media items of a multi-item post to fetch (an X
   *  tweet with its own video + a quoted one, an Instagram carousel).
   *  yt-dlp's 1-based comma list, passed as --playlist-items, so the
   *  button you clicked downloads the video you were looking at.
   *  1.13.4 widened this from a single index; jobs persisted before then
   *  hold a bare number, hence the union. */
  mediaIndex?: number | string;
  title?: string;
  channel?: string;
  thumbnail?: string | null;
  duration_sec?: number | null;
  progress?: ProgressEvent;
  transcodeProgress?: TranscodeProgress;
  resultPath?: string;
  resultBytes?: number | null;
  error?: string;
  /** 1.12.x — see QueueJobSpec. Absent on plain URL-only queue jobs. */
  spec?: QueueJobSpec;
  /** 1.13.x — set for library-asset transcode jobs (no download). */
  transcodeSpec?: QueueTranscodeSpec;
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
  /** 1.13.4 — which items of a multi-item post to download, as yt-dlp's
   *  1-based comma list ("3", "1,3,5"). Set by the card's picker; leave
   *  undefined to download every item of the post. */
  mediaItems?: string | null;
};

/** Audio container we ship to yt-dlp's `--audio-format`. Each maps to
 *  a sensible default bitrate (MP3 → 320 CBR, M4A → 256 AAC, FLAC
 *  lossless) chosen server-side; no bitrate picker in the UI. */
export type AudioFormat = "mp3" | "m4a" | "flac";

/** 1.3.x — Arguments for the direct-download fallback. The URL
 *  itself is the only thing yt-dlp would've given us anyway; we
 *  guess the title from the filename so the library card has
 *  something readable until the user renames it. */
export type StartDirectArgs = {
  url: string;
  /** Optional override for the library row's title. When omitted,
   *  startDirectDownload uses prettyDirectTitle() to build a
   *  source-aware label like "Pinterest pin · 93a0607e…". */
  title?: string;
  projectId: string | null;
};

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

/**
 * 1.3.x — Build a yt-dlp `-f` spec that respects a max-quality
 * preference. Used by the queue worker for video jobs that don't
 * carry an explicit format pick.
 *
 *   maxQuality = "1080" → `bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b`
 *   maxQuality = ""     → `bv*+ba/b`                       (no cap)
 *
 * The trailing `/bv*+ba/b` is a fallback: if no source variant matches
 * the height cap (e.g., the source maxes out at 480p), yt-dlp falls
 * through to "best of what's available" instead of failing the job.
 */
export function videoFormatSpecForMaxQuality(maxQuality: string): string {
  const trimmed = maxQuality.trim();
  if (!trimmed || trimmed === "source") return "bv*+ba/b";
  // Only digits, defensively — anything else falls through to no-cap.
  if (!/^\d+$/.test(trimmed)) return "bv*+ba/b";
  return `bv*[height<=${trimmed}]+ba/b[height<=${trimmed}]/bv*+ba/b`;
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
      /** 1.13.x — per-job overrides from the extension quick menu. */
      maxQuality?: string;
      titleOverride?: string;
      /** 1.13.x — 1-based media item for multi-video posts. */
      mediaIndex?: number;
    },
  ) => void;
  cancelQueueJob: (id: string) => Promise<void>;
  removeQueueJobs: (predicate: (j: QueueJob) => boolean) => void;
  retryFailedJobs: () => void;
  clearCompletedJobs: () => void;
  updateQueueJob: (id: string, patch: Partial<QueueJob>) => void;
  /** 1.12.x — enqueue the Download card's fully-specified download as a
   *  regular queue job (spec attached). Returns immediately: the card
   *  frees up for the next URL while the queue below runs this one. */
  enqueueSingleSpec: (args: StartSingleArgs) => void;
  /** 1.13.x — enqueue a transcode of an existing library asset. */
  enqueueTranscode: (spec: QueueTranscodeSpec) => void;
  // Single-URL
  singleDownload: SingleDownload | null;
  startSingleDownload: (args: StartSingleArgs) => Promise<void>;
  /** 1.3.x — fallback path when yt-dlp can't enumerate formats for
   *  a URL but the URL itself is a direct media file (CDN .mp4
   *  from Pinterest / sniffer, etc.). Bypasses yt-dlp and streams
   *  the bytes directly via HTTP with platform-aware Referer
   *  headers. Reuses the single-URL state + progress channel so
   *  the existing UI lights up unchanged. */
  startDirectDownload: (args: StartDirectArgs) => Promise<void>;
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
  preferredMaxQuality,
}: {
  children: ReactNode;
  /** Mirrors settings.download_concurrency. Bumping it mid-session
   *  spawns more worker loops to consume the new headroom. */
  downloadConcurrency: number;
  /** 1.3.x — mirrors settings.preferred_max_quality. Numeric height
   *  string ("1080" / "720" / "480") OR empty for "no cap". Applied
   *  to queue rows + bridge-enqueued jobs that don't carry their own
   *  format choice. Read at each processOne() so changing it mid-
   *  session affects subsequent jobs immediately. */
  preferredMaxQuality: string;
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
  // 1.3.x — queue worker reads the latest preferred quality every
  // iteration via this ref, so changing the Settings dropdown takes
  // effect on the next queued job without re-instantiating workers.
  const maxQualityRef = useRef(preferredMaxQuality);
  maxQualityRef.current = preferredMaxQuality;

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

  // 1.3.x — Direct-HTTP path for a queue row, used by processOne when
  // the URL is a raw media file (CDN .mp4 etc.). Same shape as the
  // single-URL direct path but writes its result into the queue row's
  // status instead of the singleDownload slot.
  const runQueueDirect = useCallback(
    async (job: QueueJob) => {
      updateQueueJob(job.id, {
        status: "downloading",
        title: job.url.split(/[?#]/)[0].split("/").pop() || job.url,
      });
      try {
        const result = await invoke<DownloadResult>("media_direct_download", {
          url: job.url,
          jobId: job.id,
          projectId: job.projectId,
        });
        const finalPath = result.path;
        const finalBytes = result.bytes;
        const ext = (extFromPath(finalPath) ?? "").toLowerCase();
        const audioExts = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"]);
        const isAudio = audioExts.has(ext);
        const assetId = await recordInLibrary({
          source_url: job.url,
          platform: detectPlatform(job.url),
          video_id: job.url.split("/").pop()?.split("?")[0] ?? job.url,
          channel: null,
          // Library-friendly title — "Pinterest pin · 93a0607e…"
          // beats raw hash filenames in the grid view. Falls back
          // to the filename for unrecognized sources.
          title: prettyDirectTitle(
            job.url,
            finalPath.split(/[\\/]/).pop() || job.url,
          ),
          duration_sec: null,
          in_sec: null,
          out_sec: null,
          file_path: finalPath,
          file_size: finalBytes,
          container: ext,
          codec_video: null,
          codec_audio: isAudio ? ext : null,
          width: null,
          height: null,
          fps: null,
          transcoded_to: null,
          thumbnail_url: null,
          project_id: job.projectId,
          kind: isAudio ? "audio" : "video",
        });
        if (assetId) {
          if (isAudio) {
            void attachLocalWaveform(assetId, finalPath);
          } else {
            void attachLocalThumbnail(assetId, finalPath, null);
          }
        }
        updateQueueJob(job.id, {
          status: "done",
          resultPath: finalPath,
          resultBytes: finalBytes ?? null,
        });
      } catch (e) {
        updateQueueJob(job.id, { status: "failed", error: String(e) });
      }
    },
    [updateQueueJob],
  );

  // 1.12.x — spec-driven queue path. Runs a job whose choices were made
  // in the Download card (exact format, segments, transcode). Skips the
  // metadata fetch entirely, honors multi-segment results (one library
  // row per cut) — mirroring startSingleDownload, but reporting through
  // the queue row instead of the blocking single-URL slot.
  const runQueueSpec = useCallback(
    async (job: QueueJob) => {
      const spec = job.spec!;
      const isAudio = !!job.audioFormat;
      updateQueueJob(job.id, { status: "downloading" });

      let results: DownloadResult[];
      try {
        results = await invoke<DownloadResult[]>("yt_download", {
          url: job.url,
          formatSpec: spec.formatSpec,
          mergeContainer: spec.mergeContainer,
          totalBytesHint: spec.totalBytesHint,
          videoId: spec.videoId,
          segments: spec.segments && spec.segments.length > 0 ? spec.segments : null,
          jobId: job.id,
          projectId: job.projectId,
          audioFormat: job.audioFormat ?? null,
          filenameOverride: null,
          mediaItems: job.mediaIndex == null ? null : String(job.mediaIndex),
        });
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

      const preset = isAudio ? "none" : job.transcodePreset;
      let finalPaths = results.map((r) => r.path);
      let usedPreset: TranscodePreset = "none";
      let txError: string | null = null;

      if (preset !== "none") {
        const sem = isGpuPreset(preset) ? gpuTranscodeSem : cpuTranscodeSem;
        await sem.acquire();
        try {
          updateQueueJob(job.id, { status: "transcoding", resultPath: results[0]?.path });
          const txResults: TranscodeResult[] = [];
          for (const r of results) {
            try {
              const txRes = await invoke<TranscodeResult>("media_transcode", {
                srcPath: r.path,
                preset,
                totalSecHint: spec.metaDuration ?? null,
                jobId: job.id,
              });
              txResults.push(txRes);
            } catch (e) {
              txError = `transcode failed: ${String(e)} (source kept)`;
              break;
            }
          }
          if (txResults.length > 0) {
            finalPaths = txResults.map((t) => t.path);
            usedPreset = preset;
          }
        } finally {
          sem.release();
        }
      }

      // Record every final path — multi-segment downloads produce one
      // library row per cut, each carrying its in/out marks.
      for (let i = 0; i < finalPaths.length; i++) {
        const path = finalPaths[i];
        const original = results[i];
        const seg = spec.segments?.[i] ?? null;
        const assetId = await recordInLibrary({
          source_url: job.url,
          platform: detectPlatform(job.url),
          video_id: spec.videoId,
          channel: spec.metaChannel,
          title: spec.metaTitle,
          duration_sec: spec.metaDuration,
          in_sec: seg?.[0] ?? null,
          out_sec: seg?.[1] ?? null,
          file_path: path,
          file_size: original?.bytes ?? null,
          container: extFromPath(path),
          codec_video: isAudio ? null : videoCodecFor(usedPreset, spec.pfVcodec ?? undefined),
          codec_audio: isAudio ? (job.audioFormat ?? null) : audioCodecFor(usedPreset, null),
          width: isAudio ? null : spec.pfWidth,
          height: isAudio ? null : spec.pfHeight,
          fps: isAudio ? null : spec.pfFps,
          transcoded_to: usedPreset === "none" ? null : usedPreset,
          thumbnail_url: job.thumbnail ?? null,
          project_id: job.projectId ?? null,
          kind: isAudio ? "audio" : "video",
        });
        if (assetId) {
          if (isAudio) {
            void attachLocalWaveform(assetId, path);
          } else {
            // Full video → platform art; segment cut → its own frame.
            void attachBestThumbnail(
              assetId,
              seg ? null : (job.thumbnail ?? null),
              path,
              spec.metaDuration ?? null,
            );
          }
        }
      }

      updateQueueJob(job.id, {
        status: txError ? "failed" : "done",
        error: txError ?? undefined,
        resultPath: finalPaths[finalPaths.length - 1],
        resultBytes: results[results.length - 1]?.bytes ?? null,
      });
    },
    [updateQueueJob],
  );

  // 1.13.x — transcode an existing library asset (no download). Runs
  // media_transcode, records the output as a new library row, and (when
  // replaceOriginal) moves the source row to the in-app Trash so the
  // grid shows only the transcoded copy.
  const runQueueTranscode = useCallback(
    async (job: QueueJob) => {
      const spec = job.transcodeSpec!;
      updateQueueJob(job.id, { status: "transcoding" });

      let txPath: string;
      let txBytes: number | null;
      try {
        const sem = isGpuPreset(spec.preset) ? gpuTranscodeSem : cpuTranscodeSem;
        await sem.acquire();
        try {
          const txRes = await invoke<TranscodeResult>("media_transcode", {
            srcPath: spec.srcPath,
            preset: spec.preset,
            totalSecHint: spec.durationSec ?? null,
            jobId: job.id,
          });
          txPath = txRes.path;
          txBytes = txRes.bytes;
        } finally {
          sem.release();
        }
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

      const assetId = await recordInLibrary({
        source_url: spec.sourceUrl,
        platform: spec.platform,
        video_id: spec.videoId,
        channel: spec.channel,
        title: spec.title,
        duration_sec: spec.durationSec,
        in_sec: null,
        out_sec: null,
        file_path: txPath,
        file_size: txBytes,
        container: extFromPath(txPath),
        codec_video: videoCodecFor(spec.preset, null),
        codec_audio: audioCodecFor(spec.preset, null),
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        transcoded_to: spec.preset,
        thumbnail_url: spec.thumbnailUrl,
        project_id: spec.projectId,
        kind: "video",
      });
      if (assetId) {
        void attachBestThumbnail(assetId, spec.thumbnailUrl, txPath, spec.durationSec ?? null);
      }

      // Replace: move the original library row to the in-app Trash
      // (recoverable — the source file goes to the OS recycle bin, the
      // transcoded copy stays). Best-effort; a failure here still leaves
      // the transcode recorded, so we surface it but keep status=done.
      if (spec.replaceOriginal) {
        try {
          await invoke("library_delete_many", { ids: [spec.assetId] });
        } catch (e) {
          console.warn("[transcode] replace-original trash failed:", e);
        }
      }

      updateQueueJob(job.id, { status: "done", resultPath: txPath, resultBytes: txBytes });
    },
    [updateQueueJob],
  );

  const processOne = useCallback(
    async (job: QueueJob) => {
      // 1.13.x — library-asset transcode: no download, just convert +
      // record + optionally replace the original.
      if (job.transcodeSpec) {
        await runQueueTranscode(job);
        return;
      }
      // 1.12.x — fully-specified card download: the card already fetched
      // metadata and the user already chose format/segments — don't
      // re-decide anything here.
      if (job.spec) {
        await runQueueSpec(job);
        return;
      }

      updateQueueJob(job.id, { status: "fetching" });

      // 1.3.x — Direct-download shortcut. If the queue row's URL is
      // itself a direct media file (CDN .mp4 etc.), skip the yt-dlp
      // metadata fetch entirely — yt-dlp's generic extractor often
      // returns zero formats for these and we'd just fail. Mirrors
      // the Download page's fallback button.
      if (isDirectMediaUrl(job.url)) {
        await runQueueDirect(job);
        return;
      }

      let meta: VideoMetadata;
      try {
        meta = await invoke<VideoMetadata>("yt_fetch_metadata", { url: job.url });
      } catch (e) {
        updateQueueJob(job.id, { status: "failed", error: String(e) });
        return;
      }

      // 1.3.x — Second-chance direct fallback: yt-dlp succeeded at
      // metadata fetch but returned no usable formats. Only useful
      // when the URL ends in a media extension — otherwise we have
      // nothing to give the HTTP client.
      if (meta.formats.length === 0 && isDirectMediaUrl(job.url)) {
        await runQueueDirect(job);
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
        title: job.titleOverride ?? meta.title,
        channel: meta.channel,
        thumbnail: meta.thumbnail,
        duration_sec: meta.duration_sec,
      });

      let dlRes: DownloadResult;
      const isAudio = !!job.audioFormat;
      try {
        const results = await invoke<DownloadResult[]>("yt_download", {
          url: job.url,
          // Audio jobs: bestaudio. Video jobs: best video + best
          // audio muxed into MP4, respecting Settings → Downloads →
          // Preferred max quality (1.3.x). A 1080p preference downloads
          // 1080p when available and falls back to the source's best
          // when not (e.g., a 480p-only Twitter clip).
          formatSpec: isAudio
            ? "bestaudio/best"
            : videoFormatSpecForMaxQuality(job.maxQualityOverride ?? maxQualityRef.current),
          mergeContainer: isAudio ? null : "mp4",
          totalBytesHint: isAudio ? null : (bestVideo?.filesize_bytes ?? null),
          videoId: meta.id,
          segments: null,
          jobId: job.id,
          projectId: job.projectId,
          audioFormat: job.audioFormat ?? null,
          // 1.13.x — extension "rename": also names the FILE on disk,
          // not just the library row.
          filenameOverride: job.titleOverride ?? null,
          mediaItems: job.mediaIndex == null ? null : String(job.mediaIndex),
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
        title: job.titleOverride ?? meta.title,
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
          // 1.12.x — prefer the platform's own art (frame-grab fallback).
          void attachBestThumbnail(assetId, meta.thumbnail ?? null, finalPath, meta.duration_sec ?? null);
        }
      }
    },
    [updateQueueJob, runQueueDirect, runQueueSpec, runQueueTranscode],
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
        maxQualityOverride: opts.maxQuality,
        titleOverride: opts.titleOverride,
        mediaIndex: opts.mediaIndex,
      }));
      setQueueJobs((prev) => [...prev, ...newJobs]);
    },
    [],
  );

  // 1.12.x — enqueue the card's fully-specified download. Title/thumb
  // land on the job immediately (the queue row renders them without a
  // fetch); the heavy VideoMetadata is slimmed into QueueJobSpec.
  const enqueueSingleSpec = useCallback<DownloadsContextValue["enqueueSingleSpec"]>(
    (args) => {
      const rustSegments = args.segments
        ? args.segments.map((s) => [s.inSec, s.outSec] as [number, number])
        : null;
      const job: QueueJob = {
        id: newJobId(),
        url: args.url,
        status: "queued",
        transcodePreset: args.transcodePreset,
        projectId: args.projectId,
        audioFormat: args.audioFormat ?? null,
        mediaIndex: args.mediaItems ?? undefined,
        title: args.meta.title,
        channel: args.meta.channel ?? undefined,
        thumbnail: args.meta.thumbnail ?? null,
        duration_sec: args.meta.duration_sec ?? null,
        spec: {
          formatSpec: args.formatSpec,
          mergeContainer: args.mergeContainer,
          totalBytesHint: args.totalBytesHint,
          videoId: args.videoId,
          segments: rustSegments && rustSegments.length > 0 ? rustSegments : null,
          metaTitle: args.meta.title,
          metaChannel: args.meta.channel ?? null,
          metaDuration: args.meta.duration_sec ?? null,
          pfVcodec: args.pickedFormat?.vcodec ?? null,
          pfWidth: args.pickedFormat?.width ?? null,
          pfHeight: args.pickedFormat?.height ?? null,
          pfFps: args.pickedFormat?.fps ?? null,
        },
      };
      setQueueJobs((prev) => [...prev, job]);
    },
    [],
  );

  // 1.13.x — enqueue a library-asset transcode. Title/thumb land on the
  // row immediately so the queue panel renders it without a fetch.
  const enqueueTranscode = useCallback<DownloadsContextValue["enqueueTranscode"]>(
    (spec) => {
      const job: QueueJob = {
        id: newJobId(),
        url: spec.sourceUrl,
        status: "queued",
        transcodePreset: spec.preset,
        projectId: spec.projectId,
        title: spec.title,
        thumbnail: spec.thumbnailUrl,
        duration_sec: spec.durationSec,
        transcodeSpec: spec,
      };
      setQueueJobs((prev) => [...prev, job]);
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
          filenameOverride: null,
          mediaItems: null,
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
              // Full video → platform art; segment cut → its own frame.
              void attachBestThumbnail(
                assetId,
                seg ? null : (args.meta.thumbnail ?? null),
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
  // 1.3.x — Direct download fallback
  // -----------------------------------------------------------------
  // When yt-dlp's extractor can't enumerate formats but we have a
  // direct media URL (.mp4/.mp3/etc), bypass yt-dlp entirely. Uses
  // the same single-URL state slot + progress event channel so
  // MetadataCard's existing progress bar reflects the direct
  // download with zero UI plumbing. Skips transcode (no preset
  // makes sense for an arbitrary CDN file — user can transcode
  // later via the library card if they want).
  const startDirectDownload = useCallback<DownloadsContextValue["startDirectDownload"]>(
    async (args) => {
      // Pretty title up-front so the in-progress "downloading…"
      // chip + the final library row read the same.
      const initialTitle =
        args.title ||
        prettyDirectTitle(
          args.url,
          args.url.split(/[?#]/)[0].split("/").pop() || args.url,
        );
      setSingleDownload({
        jobId: SINGLE_URL_JOB_ID,
        url: args.url,
        title: initialTitle,
        thumbnailUrl: null,
        phase: "downloading",
        progress: null,
        transcodeProgress: null,
        error: null,
        result: null,
        downloadedPaths: [],
      });
      try {
        const result = await invoke<DownloadResult>("media_direct_download", {
          url: args.url,
          jobId: SINGLE_URL_JOB_ID,
          projectId: args.projectId,
        });
        const finalPath = result.path;
        const finalBytes = result.bytes;
        const ext = (extFromPath(finalPath) ?? "").toLowerCase();
        // Best-effort kind detection from the URL/file extension.
        // Audio extensions go in as kind="audio" so the library
        // renders them with the waveform/music UI.
        const audioExts = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"]);
        const isAudio = audioExts.has(ext);

        const assetId = await recordInLibrary({
          source_url: args.url,
          platform: detectPlatform(args.url),
          // No video id from the CDN URL — use the filename stem
          // so dedupe still works against identical direct pastes.
          video_id: args.url.split("/").pop()?.split("?")[0] ?? args.url,
          channel: null,
          // Single-URL path may carry an explicit title from the
          // Download page (filename stem of the pasted URL). Fall
          // through to the platform-aware prettifier otherwise so
          // the row reads cleanly in the grid.
          title:
            args.title ||
            prettyDirectTitle(
              args.url,
              finalPath.split(/[\\/]/).pop() || args.url,
            ),
          duration_sec: null,
          in_sec: null,
          out_sec: null,
          file_path: finalPath,
          file_size: finalBytes,
          container: ext,
          codec_video: null,
          codec_audio: isAudio ? ext : null,
          width: null,
          height: null,
          fps: null,
          transcoded_to: null,
          thumbnail_url: null,
          project_id: args.projectId,
          kind: isAudio ? "audio" : "video",
        });
        if (assetId) {
          if (isAudio) {
            void attachLocalWaveform(assetId, finalPath);
          } else {
            void attachLocalThumbnail(assetId, finalPath, null);
          }
        }

        setSingleDownload((prev) =>
          prev
            ? {
                ...prev,
                phase: "idle",
                result: { path: finalPath, bytes: finalBytes ?? null },
                downloadedPaths: [finalPath],
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
                error: msg,
                progress: null,
                transcodeProgress: null,
              }
            : prev,
        );
      }
    },
    [],
  );

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
    enqueueSingleSpec,
    enqueueTranscode,
    cancelQueueJob,
    removeQueueJobs,
    retryFailedJobs,
    clearCompletedJobs,
    updateQueueJob,
    singleDownload,
    startSingleDownload,
    startDirectDownload,
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
