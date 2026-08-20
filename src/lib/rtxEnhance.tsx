/**
 * RTX enhance context (Phase 1–2) — owns the "Upscale with NVIDIA RTX Video"
 * queue so it survives route navigation, mirroring downloads.tsx.
 *
 * One provider at App root. It owns:
 *   - `jobs[]`        — the enhance queue (one GPU job runs at a time)
 *   - the `rtx:progress` listener (attached once, survives nav)
 *   - a single sequential worker `pump()` (GPU saturates at 1 job)
 *   - `capability` / `workerReady` from the backend gate commands
 *   - the before/after window's open state + default HDR setting
 *
 * Components are thin presenters: `useRtxEnhance()` → state + actions.
 * The enhanced clip is registered by the Rust side as a sibling of the
 * original (same source_url), so it just appears in the library on done.
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

// "staged" = in the window's "Setting up" area, configurable, NOT yet running.
// "queued" = committed to the GPU pump. The two-stage flow lets you drop a
// batch, tune each one (or all at once), then Start them together.
export type RtxStatus = "staged" | "queued" | "running" | "done" | "failed" | "canceled";

export type RtxJob = {
  /** Frontend job id (queue identity). */
  id: string;
  /**
   * Progress key the backend emits `rtx:progress` on. For a library job
   * it's the original asset id; for a dropped-in path job it's the job id.
   */
  assetId: string;
  /**
   * How the job is dispatched: "asset" → `rtx_enhance(assetId)`, a library
   * clip; "path" → `rtx_enhance_path(filePath)`, an external / dragged-in file.
   */
  source: "asset" | "path";
  /** Original file on disk (used to load the before/after preview). */
  filePath: string;
  title: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  hdr: boolean;
  /** VSR quality level 1–4 (4 = Ultra). */
  quality: number;
  /** Output scale: 2 = 2× upscale, 1 = decompress only (same resolution). */
  scale: number;
  /** Optional ffmpeg deblock/deband pre-clean pass (before VSR). */
  preclean: PrecleanOpts;
  /** Optional ffmpeg clean pass AFTER VSR (cleans VSR's leftovers). */
  postclean: PrecleanOpts;
  /** 1.14.0 — CodecClean compression-residue filter, run inside the worker
   *  on luma at INPUT resolution, before VSR. Off by default. */
  cc: boolean;
  /** Filter strength 0.00-1.00. 1.00 is the tuned dose; 0.00 is an exact
   *  bypass (which still requires the weights to load). */
  ccStrength: number;
  /** Output quality preset: lossless | master | entrega | previa.
   *  Deliberately NOT called `quality` — that name is already VSR's 1-4. */
  encPreset: string;
  status: RtxStatus;
  percent: number;
  fps: number;
  eta: string;
  /** Set on success — the new sibling asset's id. */
  newId?: string;
  error?: string;
};

/** Mirror of the Rust `RtxCapability`. */
export type RtxCapability = {
  supported: boolean;
  gpu_name: string;
  driver_version: string;
  reason: string | null;
};

/** Minimal shape the queue needs from a library Asset. */
export type EnhanceSource = {
  id: string;
  filePath: string;
  title: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
};

type RtxProgressPayload = {
  asset_id: string;
  percent: number;
  frame: number;
  total: number;
  fps: number;
  eta: string;
};

type RtxContextValue = {
  jobs: RtxJob[];
  capability: RtxCapability | null;
  workerReady: boolean;
  /** 1.14.0 — the bundle is installed but predates the build this app
   *  expects. The old worker still upscales; what it does NOT do is the
   *  CodecClean filter, which it accepts and ignores without a word. */
  workerOutdated: boolean;
  /** Install or update the worker bundle. Resolves when it's current;
   *  safe (and instant) to call when it already is. */
  ensureWorker: () => Promise<void>;
  /** True when a clip can be enhanced (always — 4K+ falls back to 1× clean). */
  canEnhanceHeight: (height: number | null) => boolean;
  /** Enqueue a library clip to run NOW (right-click fast path). */
  enqueue: (asset: EnhanceSource, opts?: EnqueueOpts) => void;
  /** Add a library clip to the window's staging area (configure, then Start). */
  stageAsset: (asset: EnhanceSource, opts?: EnqueueOpts) => void;
  /** Stage raw file paths (dropped-in external files or library drags). */
  enqueuePaths: (paths: string[], opts?: EnqueueOpts) => void;
  /** Edit a staged job's settings before it runs. */
  setJobOptions: (id: string, opts: EnqueueOpts) => void;
  /** Apply the same settings to every staged job at once. */
  applyToStaged: (opts: EnqueueOpts) => void;
  /** Commit a single staged job to the render queue. */
  startJob: (id: string) => void;
  /** Commit every staged job to the render queue. */
  startAllStaged: () => void;
  removeJob: (id: string) => void;
  /** Stop a job: kills the worker if running, drops it if still queued. */
  cancelJob: (id: string) => void;
  clearFinished: () => void;
  activeCount: number;
  /** How many jobs are staged (in "Setting up", not yet started). */
  stagedCount: number;
  // Before/after window
  windowJobId: string | null;
  openWindow: (jobId?: string) => void;
  closeWindow: () => void;
  // Default HDR (TrueHDR) for future enqueues — off by default.
  defaultHdr: boolean;
  setDefaultHdr: (v: boolean) => void;
  // Default VSR quality (1–4, 4 = Ultra) for future enqueues.
  defaultQuality: number;
  setDefaultQuality: (n: number) => void;
  // Default output scale (2 = 2× upscale, 1 = decompress only).
  defaultScale: number;
  setDefaultScale: (n: number) => void;
  // 1.14.0 — CodecClean filter defaults. Off unless the user asks for it.
  defaultCc: boolean;
  setDefaultCc: (v: boolean) => void;
  defaultCcStrength: number;
  setDefaultCcStrength: (n: number) => void;
  // Output quality preset (the worker's `--quality`).
  defaultEncPreset: string;
  setDefaultEncPreset: (v: string) => void;
  // Default pre-clean (deblock/deband) settings for new enqueues.
  defaultPreclean: PrecleanOpts;
  setDefaultPreclean: (p: PrecleanOpts) => void;
  // Default post-clean (after VSR) settings for new enqueues.
  defaultPostclean: PrecleanOpts;
  setDefaultPostclean: (p: PrecleanOpts) => void;
};

/**
 * ffmpeg pre-clean pass (deblock/deband) run before VSR — mirrors the Rust
 * `PrecleanOpts`. Every value is editable so presets can be tuned on real
 * footage; a non-empty `raw` overrides the generated `-vf` chain entirely.
 */
export type PrecleanOpts = {
  enabled: boolean;
  deblock: boolean;
  deblockFilter: "weak" | "strong";
  block: number;
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
  deband: boolean;
  debandThr: number;
  debandRange: number;
  debandBlur: boolean;
  debandCoupling: boolean;
  // Strong DCT deblock (spp) — much stronger than the weak `deblock` filter.
  spp: boolean;
  sppStrength: number;
  // Ultra-strong DCT deblock (uspp) — strongest, but much slower than spp.
  uspp: boolean;
  usppStrength: number;
  // libplacebo GPU deband + dither (the research-winning post-clean).
  libplacebo: boolean;
  lpIterations: number;
  lpThreshold: number;
  lpRadius: number;
  lpGrain: number;
  // CAS contrast-adaptive sharpen (applied last).
  cas: boolean;
  casStrength: number;
  // Edge-preserving GPU denoise (Vulkan nlmeans) — cleans mosquito around
  // lines. `denoiseStrength` maps to nlmeans_vulkan's `s` (0–100).
  denoise: boolean;
  denoiseStrength: number;
  // Tiny gaussian pre-smooth (gblur) — de-staircases edges before VSR.
  presmooth: boolean;
  presmoothSigma: number;
  raw: string;
};

/** Starting point — off, with the conservative "light" preset from testing. */
export const DEFAULT_PRECLEAN: PrecleanOpts = {
  enabled: false,
  deblock: true,
  deblockFilter: "weak",
  block: 8,
  alpha: 0.06,
  beta: 0.03,
  gamma: 0.03,
  delta: 0.03,
  deband: true,
  debandThr: 0.008,
  debandRange: 16,
  debandBlur: true,
  debandCoupling: true,
  spp: false,
  sppStrength: 4,
  uspp: false,
  usppStrength: 3,
  libplacebo: false,
  lpIterations: 3,
  lpThreshold: 6,
  lpRadius: 24,
  lpGrain: 6,
  cas: false,
  casStrength: 0.4,
  denoise: false,
  denoiseStrength: 3,
  presmooth: false,
  presmoothSigma: 0.6,
  raw: "",
};

/** Per-enqueue overrides; anything omitted falls back to the saved defaults. */
export type EnqueueOpts = {
  hdr?: boolean;
  quality?: number;
  scale?: number;
  preclean?: PrecleanOpts;
  postclean?: PrecleanOpts;
  cc?: boolean;
  ccStrength?: number;
  encPreset?: string;
};

/**
 * MIME used to carry library file paths into the enhance window on an in-app
 * (HTML5) drag. The library sets this on the drag when the window is open;
 * the window reads it on drop. External-file drops come through Tauri's OS
 * drag-drop channel instead. Value is a JSON string array of absolute paths.
 */
export const MH_FILE_MIME = "application/x-mh-file";

/** Video extensions we accept for drag-in enhance. */
const VIDEO_EXTS = new Set([
  "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts",
]);

/** True if a path looks like a video file we can hand to the worker. */
export function isEnhanceableVideoPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTS.has(path.slice(dot + 1).toLowerCase());
}

/** Last path segment without extension — a friendly default title. */
function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const RtxEnhanceContext = createContext<RtxContextValue | null>(null);

function newJobId(): string {
  return `rtx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Derive the enhanced file path from the original. The backend writes
 * `<dir>/<stem>_rtx-vsr.mp4` (2× upscale) or `<stem>_rtx-clean.mp4`
 * (1× decompress) next to the source (see rtx.rs `out_suffix`), so we can
 * compute it here without a round-trip — used by the A/B preview.
 */
export function rtxOutputPath(original: string, scale = 2): string {
  const slash = Math.max(original.lastIndexOf("/"), original.lastIndexOf("\\"));
  const dir = original.slice(0, slash + 1);
  const name = original.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = scale <= 1 ? "_rtx-clean" : "_rtx-vsr";
  return `${dir}${stem}${suffix}.mp4`;
}

export function RtxEnhanceProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<RtxJob[]>([]);
  const [capability, setCapability] = useState<RtxCapability | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [workerOutdated, setWorkerOutdated] = useState(false);

  // 1.14.0 — the worker is a versioned bundle now, so "is it there?" and
  // "is it the build we expect?" are separate answers.
  const refreshWorker = useCallback(async () => {
    try {
      const st = await invoke<{ installed: boolean; up_to_date: boolean }>(
        "rtx_worker_status",
      );
      setWorkerReady(st.installed);
      setWorkerOutdated(st.installed && !st.up_to_date);
    } catch {
      setWorkerReady(false);
      setWorkerOutdated(false);
    }
  }, []);

  const ensureWorker = useCallback(async () => {
    await invoke("rtx_worker_ensure");
    await refreshWorker();
  }, [refreshWorker]);
  const [windowJobId, setWindowJobId] = useState<string | null>(null);
  // Default HDR persists across sessions — whatever you set in the window
  // becomes the default for the next right-click → upscale.
  const [defaultHdr, setDefaultHdr] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mh.rtx.hdr") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.hdr", defaultHdr ? "1" : "0");
    } catch {
      /* quota — skip */
    }
  }, [defaultHdr]);
  // VSR quality default persists too (1–4, 4 = Ultra).
  const [defaultQuality, setDefaultQuality] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("mh.rtx.quality"));
      return v >= 1 && v <= 4 ? v : 4;
    } catch {
      return 4;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.quality", String(defaultQuality));
    } catch {
      /* quota — skip */
    }
  }, [defaultQuality]);
  // Output scale default persists too (2 = 2× upscale, 1 = decompress only).
  const [defaultScale, setDefaultScale] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("mh.rtx.scale"));
      return v === 1 || v === 2 || v === 4 ? v : 2;
    } catch {
      return 2;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.scale", String(defaultScale));
    } catch {
      /* quota — skip */
    }
  }, [defaultScale]);
  // 1.14.0 — CodecClean. Off by default: it changes the picture, so it is
  // opt-in, and the choice sticks like every other RTX default.
  const [defaultCc, setDefaultCc] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mh.rtx.cc") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.cc", defaultCc ? "1" : "0");
    } catch {
      /* quota — skip */
    }
  }, [defaultCc]);
  const [defaultCcStrength, setDefaultCcStrength] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("mh.rtx.ccStrength"));
      return v >= 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.ccStrength", String(defaultCcStrength));
    } catch {
      /* quota — skip */
    }
  }, [defaultCcStrength]);
  const [defaultEncPreset, setDefaultEncPreset] = useState<string>(() => {
    try {
      return localStorage.getItem("mh.rtx.encPreset") || "entrega";
    } catch {
      return "entrega";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.encPreset", defaultEncPreset);
    } catch {
      /* quota — skip */
    }
  }, [defaultEncPreset]);
  // Pre-clean defaults persist too (stored as JSON; merged over the baseline so
  // new fields added later don't break an old saved blob).
  const [defaultPreclean, setDefaultPreclean] = useState<PrecleanOpts>(() => {
    try {
      const raw = localStorage.getItem("mh.rtx.preclean");
      return raw ? { ...DEFAULT_PRECLEAN, ...(JSON.parse(raw) as Partial<PrecleanOpts>) } : DEFAULT_PRECLEAN;
    } catch {
      return DEFAULT_PRECLEAN;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.preclean", JSON.stringify(defaultPreclean));
    } catch {
      /* quota — skip */
    }
  }, [defaultPreclean]);
  const [defaultPostclean, setDefaultPostclean] = useState<PrecleanOpts>(() => {
    try {
      const raw = localStorage.getItem("mh.rtx.postclean");
      return raw ? { ...DEFAULT_PRECLEAN, ...(JSON.parse(raw) as Partial<PrecleanOpts>) } : DEFAULT_PRECLEAN;
    } catch {
      return DEFAULT_PRECLEAN;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.rtx.postclean", JSON.stringify(defaultPostclean));
    } catch {
      /* quota — skip */
    }
  }, [defaultPostclean]);

  const jobsRef = useRef<RtxJob[]>([]);
  jobsRef.current = jobs;
  const runningRef = useRef(false);

  const patch = useCallback((id: string, p: Partial<RtxJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }, []);

  // Capability + worker presence, probed once at mount.
  useEffect(() => {
    void invoke<RtxCapability>("rtx_capability")
      .then(setCapability)
      .catch(() =>
        setCapability({
          supported: false,
          gpu_name: "",
          driver_version: "",
          reason: "RTX detection failed.",
        }),
      );
    void refreshWorker();
  }, []);

  // Live per-frame progress. Match on assetId (the backend key) and only
  // touch the currently-running job for that asset.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      const fn = await listen<RtxProgressPayload>("rtx:progress", (e) => {
        const { asset_id, percent, fps, eta } = e.payload;
        setJobs((prev) =>
          prev.map((j) =>
            j.assetId === asset_id && j.status === "running"
              ? { ...j, percent, fps, eta }
              : j,
          ),
        );
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Sequential worker — the GPU does one enhance at a time. Runs in the
  // provider so it's never re-spawned by a component re-mount.
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (true) {
        const next = jobsRef.current.find((j) => j.status === "queued");
        if (!next) break;
        patch(next.id, { status: "running", percent: 0 });
        try {
          // Library clip → rtx_enhance(assetId); dropped-in file → rtx_enhance_path(path).
          const newAssetId =
            next.source === "path"
              ? await invoke<string>("rtx_enhance_path", {
                  path: next.filePath,
                  hdr: next.hdr,
                  quality: next.quality,
                  scale: next.scale,
                  ccEnabled: next.cc,
                  ccStrength: next.ccStrength,
                  encPreset: next.encPreset,
                  preclean: next.preclean,
                  postclean: next.postclean,
                  jobId: next.id,
                  title: next.title,
                })
              : await invoke<string>("rtx_enhance", {
                  assetId: next.assetId,
                  hdr: next.hdr,
                  quality: next.quality,
                  scale: next.scale,
                  ccEnabled: next.cc,
                  ccStrength: next.ccStrength,
                  encPreset: next.encPreset,
                  preclean: next.preclean,
                  postclean: next.postclean,
                  jobId: next.id,
                });
          patch(next.id, { status: "done", percent: 100, newId: newAssetId });
        } catch (e) {
          const msg = String(e);
          if (msg.includes("__rtx_canceled__")) {
            patch(next.id, { status: "canceled", percent: 0 });
          } else {
            patch(next.id, { status: "failed", error: msg });
          }
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch]);

  useEffect(() => {
    if (jobs.some((j) => j.status === "queued")) void pump();
  }, [jobs, pump]);

  // RTX runs at any resolution now: below 4K it can 2× upscale; at 4K+ the
  // backend forces 1× (clean-only), running just the ffmpeg cleanup + filters
  // (VSR skips ≥1440p). So every video clip is enhanceable.
  const canEnhanceHeight = useCallback((_height: number | null) => true, []);

  // Shared job factory — captures the current defaults, overridable per call.
  const buildAssetJob = useCallback(
    (asset: EnhanceSource, opts: EnqueueOpts | undefined, status: RtxStatus): RtxJob => ({
      id: newJobId(),
      assetId: asset.id,
      source: "asset",
      filePath: asset.filePath,
      title: asset.title,
      thumbnail: asset.thumbnail,
      width: asset.width,
      height: asset.height,
      hdr: opts?.hdr ?? defaultHdr,
      quality: opts?.quality ?? defaultQuality,
      scale: opts?.scale ?? defaultScale,
      // 1.14.0 — the ffmpeg clean passes are off for now: they cost
      // real render time and the restoration research found pre-clean
      // actively hurts. DEFAULT_PRECLEAN is the disabled shape, used
      // instead of the stored defaults so a value persisted earlier
      // can't keep running behind a UI that no longer shows it.
      // Restoring the feature = put the two defaults back here.
      preclean: opts?.preclean ?? DEFAULT_PRECLEAN,
      postclean: opts?.postclean ?? DEFAULT_PRECLEAN,
      cc: opts?.cc ?? defaultCc,
      ccStrength: opts?.ccStrength ?? defaultCcStrength,
      encPreset: opts?.encPreset ?? defaultEncPreset,
      status,
      percent: 0,
      fps: 0,
      eta: "",
    }),
    [
      defaultHdr,
      defaultQuality,
      defaultScale,
      defaultPreclean,
      defaultPostclean,
      defaultCc,
      defaultCcStrength,
      defaultEncPreset,
    ],
  );

  // Right-click fast path — run the clip NOW with the saved defaults.
  const enqueue = useCallback<RtxContextValue["enqueue"]>(
    (asset, opts) => {
      setJobs((prev) => [...prev, buildAssetJob(asset, opts, "queued")]);
    },
    [buildAssetJob],
  );

  // Send a library clip to the window's staging area (configure, then Start).
  const stageAsset = useCallback<RtxContextValue["stageAsset"]>(
    (asset, opts) => {
      setJobs((prev) => [...prev, buildAssetJob(asset, opts, "staged")]);
      setWindowJobId((prev) => prev ?? "__latest__");
    },
    [buildAssetJob],
  );

  // Drop-in for raw paths — external files or clips dragged out of the library.
  // These land in STAGING so nothing renders until the user hits Start. Non-video
  // paths are ignored so a stray drop can't spawn junk.
  const enqueuePaths = useCallback<RtxContextValue["enqueuePaths"]>(
    (paths, opts) => {
      const videos = paths.filter(isEnhanceableVideoPath);
      if (videos.length === 0) return;
      setJobs((prev) => [
        ...prev,
        ...videos.map((p): RtxJob => {
          const id = newJobId();
          return {
            id,
            // Path jobs key progress on the job id (no library asset yet).
            assetId: id,
            source: "path",
            filePath: p,
            title: baseName(p),
            thumbnail: null,
            width: null,
            height: null,
            hdr: opts?.hdr ?? defaultHdr,
            quality: opts?.quality ?? defaultQuality,
            scale: opts?.scale ?? defaultScale,
            preclean: opts?.preclean ?? DEFAULT_PRECLEAN,
            postclean: opts?.postclean ?? DEFAULT_PRECLEAN,
            cc: opts?.cc ?? defaultCc,
            ccStrength: opts?.ccStrength ?? defaultCcStrength,
            encPreset: opts?.encPreset ?? defaultEncPreset,
            status: "staged",
            percent: 0,
            fps: 0,
            eta: "",
          };
        }),
      ]);
    },
    [defaultHdr, defaultQuality, defaultScale, defaultPreclean, defaultPostclean],
  );

  // Edit a staged job's settings (per-row overrides in the window).
  const setJobOptions = useCallback<RtxContextValue["setJobOptions"]>((id, opts) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id && j.status === "staged"
          ? {
              ...j,
              hdr: opts.hdr ?? j.hdr,
              quality: opts.quality ?? j.quality,
              scale: opts.scale ?? j.scale,
              preclean: opts.preclean ?? j.preclean,
              postclean: opts.postclean ?? j.postclean,
              cc: opts.cc ?? j.cc,
              ccStrength: opts.ccStrength ?? j.ccStrength,
              encPreset: opts.encPreset ?? j.encPreset,
            }
          : j,
      ),
    );
  }, []);

  // Apply one settings set to every staged job at once ("Apply to all").
  const applyToStaged = useCallback<RtxContextValue["applyToStaged"]>((opts) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "staged"
          ? {
              ...j,
              hdr: opts.hdr ?? j.hdr,
              quality: opts.quality ?? j.quality,
              scale: opts.scale ?? j.scale,
              preclean: opts.preclean ?? j.preclean,
              postclean: opts.postclean ?? j.postclean,
              cc: opts.cc ?? j.cc,
              ccStrength: opts.ccStrength ?? j.ccStrength,
              encPreset: opts.encPreset ?? j.encPreset,
            }
          : j,
      ),
    );
  }, []);

  // Commit staged → queued (the pump only ever picks up "queued").
  const startJob = useCallback<RtxContextValue["startJob"]>((id) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === id && j.status === "staged" ? { ...j, status: "queued" } : j)),
    );
  }, []);
  const startAllStaged = useCallback<RtxContextValue["startAllStaged"]>(() => {
    setJobs((prev) =>
      prev.map((j) => (j.status === "staged" ? { ...j, status: "queued" } : j)),
    );
  }, []);

  // Can't hard-remove a running job (use cancelJob to stop it first).
  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id || j.status === "running"));
  }, []);

  const cancelJob = useCallback<RtxContextValue["cancelJob"]>((id) => {
    const job = jobsRef.current.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "running") {
      // Kills the worker; the enhance invoke then rejects with
      // __rtx_canceled__, which the pump marks as "canceled".
      void invoke("rtx_enhance_cancel", { jobId: id }).catch((e) =>
        console.warn("[rtx] cancel failed:", e),
      );
    } else if (job.status === "queued") {
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: "canceled" as RtxStatus } : j)),
      );
    }
  }, []);

  const clearFinished = useCallback(() => {
    // Everything that is still ahead of you survives — including "staged",
    // which this used to drop. A staged batch is unfinished WORK (settings
    // you tuned by hand), not a finished result, and clearing results must
    // never take it with them.
    setJobs((prev) =>
      prev.filter(
        (j) => j.status === "staged" || j.status === "queued" || j.status === "running",
      ),
    );
  }, []);

  const openWindow = useCallback((jobId?: string) => {
    setWindowJobId((prev) => jobId ?? prev ?? "__latest__");
  }, []);
  const closeWindow = useCallback(() => setWindowJobId(null), []);

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running").length,
    [jobs],
  );
  const stagedCount = useMemo(
    () => jobs.filter((j) => j.status === "staged").length,
    [jobs],
  );

  const value: RtxContextValue = {
    jobs,
    capability,
    workerReady,
    workerOutdated,
    ensureWorker,
    defaultCc,
    setDefaultCc,
    defaultCcStrength,
    setDefaultCcStrength,
    defaultEncPreset,
    setDefaultEncPreset,
    canEnhanceHeight,
    enqueue,
    stageAsset,
    enqueuePaths,
    setJobOptions,
    applyToStaged,
    startJob,
    startAllStaged,
    removeJob,
    cancelJob,
    clearFinished,
    activeCount,
    stagedCount,
    windowJobId,
    openWindow,
    closeWindow,
    defaultHdr,
    setDefaultHdr,
    defaultQuality,
    setDefaultQuality,
    defaultScale,
    setDefaultScale,
    defaultPreclean,
    setDefaultPreclean,
    defaultPostclean,
    setDefaultPostclean,
  };

  return <RtxEnhanceContext.Provider value={value}>{children}</RtxEnhanceContext.Provider>;
}

export function useRtxEnhance(): RtxContextValue {
  const ctx = useContext(RtxEnhanceContext);
  if (!ctx) throw new Error("useRtxEnhance must be used inside <RtxEnhanceProvider>");
  return ctx;
}
