/**
 * RtxEnhanceWindow (Phase 2) — the review + staging window.
 *
 * Layout: a large viewer on the left, a single clip list + ONE context-aware
 * settings card on the right (only the selected clip's — or the defaults —
 * show at a time, so it stays readable).
 *
 * Flow:
 *   - Drop clips (external via the OS channel, library via the HTML5 MIME) →
 *     they land in "Setting up" (staged), nothing renders yet.
 *   - Select a staged clip → the viewer plays the SOURCE; scrub to a frame and
 *     hit "Preview frame" to render a ~1.5s slice through the real worker and
 *     see the actual before/after before committing.
 *   - Tune settings, then Start (one or all) → the clip moves to "Rendering".
 *   - A finished clip shows the full before/after.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Icon } from "../lib/icons";
import {
  MH_FILE_MIME,
  rtxOutputPath,
  useRtxEnhance,
  type EnqueueOpts,
  type PrecleanOpts,
  type RtxJob,
} from "../lib/rtxEnhance";

const FRAME = 1 / 30; // assumed fps for frame-step / align nudge
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Unified viewer. Always shows the "before" video with a full transport +
 * zoom/pan. When `afterPath` is set it overlays the enhanced video behind a
 * draggable divider (compare mode); when it isn't, it's a plain source player
 * with a "Preview frame" button (source mode).
 */
function Viewer({
  beforePath,
  afterPath,
  afterLabel,
  onPreview,
  previewBusy,
}: {
  beforePath: string;
  afterPath?: string;
  afterLabel?: string;
  onPreview?: (timeSec: number) => void;
  previewBusy?: boolean;
}) {
  const beforeSrc = useMemo(() => convertFileSrc(beforePath), [beforePath]);
  const afterSrc = useMemo(() => (afterPath ? convertFileSrc(afterPath) : null), [afterPath]);
  const compare = !!afterSrc;

  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState(0);

  const applyTimes = useCallback(
    (time: number) => {
      const b = beforeRef.current;
      const a = afterRef.current;
      if (b) b.currentTime = time;
      if (a) a.currentTime = Math.max(0, time + offset);
    },
    [offset],
  );

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration || Infinity, time));
      setT(clamped);
      applyTimes(clamped);
    },
    [duration, applyTimes],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const b = beforeRef.current;
      const a = afterRef.current;
      if (b) {
        setT(b.currentTime);
        if (a && Math.abs(a.currentTime - (b.currentTime + offset)) > 0.05) {
          a.currentTime = Math.max(0, b.currentTime + offset);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, offset]);

  function togglePlay() {
    const b = beforeRef.current;
    if (!b) return;
    const a = afterRef.current;
    if (playing) {
      b.pause();
      a?.pause();
      setPlaying(false);
      applyTimes(b.currentTime);
    } else {
      if (a) a.currentTime = Math.max(0, b.currentTime + offset);
      void b.play();
      void a?.play();
      setPlaying(true);
    }
  }
  function stepFrame(dir: 1 | -1) {
    if (playing) togglePlay();
    seek(t + dir * FRAME);
  }
  function nudgeOffset(dir: 1 | -1) {
    setOffset((o) => {
      const next = Math.round((o + dir * FRAME) * 1000) / 1000;
      const a = afterRef.current;
      const b = beforeRef.current;
      if (a && b) a.currentTime = Math.max(0, b.currentTime + next);
      return next;
    });
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  const dragMode = useRef<null | "divider" | "pan">(null);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  // Divider position is a % of the VIEWPORT (screen space), independent of the
  // video zoom/pan — so the handle stays a constant size and stays grabbable
  // however far you've zoomed in.
  function moveDivider(clientX: number) {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }
  function onViewportMouseDown(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    const onDivider = el.closest(".rtxw-divider") || el.closest(".rtxw-handle");
    // Grab the divider from its handle at ANY zoom; a plain click on the video
    // moves it only when not zoomed (when zoomed, a plain drag pans instead).
    if (compare && (onDivider || zoom === 1)) {
      dragMode.current = "divider";
      moveDivider(e.clientX);
    } else if (zoom > 1) {
      dragMode.current = "pan";
      panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    } else {
      return;
    }
    const onMove = (ev: MouseEvent) => {
      if (dragMode.current === "divider") moveDivider(ev.clientX);
      else if (dragMode.current === "pan") {
        // Clamp pan so the scaled video can't be dragged off the viewport —
        // max travel is half the overflow ((zoom-1) * size / 2) on each axis.
        const el = viewportRef.current;
        const maxX = el ? (el.clientWidth * (zoom - 1)) / 2 : Infinity;
        const maxY = el ? (el.clientHeight * (zoom - 1)) / 2 : Infinity;
        const nx = panStart.current.px + (ev.clientX - panStart.current.x);
        const ny = panStart.current.py + (ev.clientY - panStart.current.y);
        setPan({
          x: Math.max(-maxX, Math.min(maxX, nx)),
          y: Math.max(-maxY, Math.min(maxY, ny)),
        });
      }
    };
    const onUp = () => {
      dragMode.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const offsetFrames = Math.round(offset / FRAME);
  // Zoom/pan lives on the video elements only; the divider overlay stays put.
  const vstyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` };

  return (
    <div className="rtxw-viewer">
      <div
        className="rtxw-compare"
        ref={viewportRef}
        onWheel={onWheel}
        onMouseDown={onViewportMouseDown}
        style={{ cursor: zoom > 1 ? "grab" : compare ? "ew-resize" : "default" }}
      >
        <div className="rtxw-layer">
          <video
            ref={beforeRef}
            className="rtxw-vid"
            src={beforeSrc}
            muted
            playsInline
            loop={!compare}
            preload="auto"
            style={vstyle}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              applyTimes(0);
            }}
          />
        </div>
        {compare && (
          <div className="rtxw-layer rtxw-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            <video ref={afterRef} className="rtxw-vid" src={afterSrc!} muted playsInline preload="auto" style={vstyle} />
          </div>
        )}
        {compare && (
          <div className="rtxw-divider" style={{ left: `${pos}%` }}>
            <span className="rtxw-handle">
              <Icon.chev width={12} height={12} style={{ transform: "rotate(90deg)" }} />
            </span>
          </div>
        )}
        <span className="rtxw-tag rtxw-tag-l">{compare ? "BEFORE" : "SOURCE"}</span>
        {compare && <span className="rtxw-tag rtxw-tag-r">{afterLabel ?? "AFTER"}</span>}
        {previewBusy && (
          <div className="rtxw-busy">
            <span className="rtxw-spin" /> Rendering preview…
          </div>
        )}
      </div>

      <div className="rtxw-transport">
        <button className="rtxw-tbtn" title="Previous frame" onClick={() => stepFrame(-1)}>
          <Icon.chev width={13} height={13} style={{ transform: "rotate(90deg)" }} />
        </button>
        <button className="rtxw-tbtn rtxw-play" title={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="rtxw-tbtn" title="Next frame" onClick={() => stepFrame(1)}>
          <Icon.chev width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
        </button>
        <input
          className="rtxw-scrub"
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={t}
          onChange={(e) => {
            if (playing) togglePlay();
            seek(Number(e.target.value));
          }}
        />
        <span className="rtxw-time mono">
          {fmtTime(t)} / {fmtTime(duration)}
        </span>

        {compare && (
          <>
            <div className="rtxw-tsep" />
            <span className="rtxw-tlabel">Align</span>
            <button className="rtxw-tbtn" title="Nudge AFTER back a frame" onClick={() => nudgeOffset(-1)}>
              −
            </button>
            <span className="rtxw-time mono" style={{ minWidth: 30 }}>
              {offsetFrames > 0 ? `+${offsetFrames}` : offsetFrames}f
            </span>
            <button className="rtxw-tbtn" title="Nudge AFTER forward a frame" onClick={() => nudgeOffset(1)}>
              +
            </button>
          </>
        )}

        <div className="rtxw-tsep" />
        <button className="rtxw-tbtn" title="Zoom out" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.4))}>
          −
        </button>
        <span className="rtxw-time mono" style={{ minWidth: 30 }}>
          {zoom.toFixed(1)}×
        </span>
        <button className="rtxw-tbtn" title="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.4))}>
          +
        </button>

        {onPreview && !compare && (
          <>
            <div className="rtxw-tsep" />
            <button
              className="rtxw-preview-btn"
              disabled={previewBusy}
              title="Render a short slice at this frame to compare before/after"
              onClick={() => onPreview(t)}
            >
              {previewBusy ? "Rendering…" : "◐ Preview frame"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Parse a numeric input, keeping the previous value if it's not a number. */
function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pre-clean tuning panel (deblock/deband). Deliberately bare — this is a rig
 * for dialing in values on real footage, not a polished control. The raw box
 * lets you paste any ffmpeg `-vf` chain, which overrides everything above it.
 */
function PrecleanFields({
  value,
  onChange,
  title = "Pre-clean (deblock / deband)",
}: {
  value: PrecleanOpts;
  onChange: (p: PrecleanOpts) => void;
  title?: string;
}) {
  const set = (patch: Partial<PrecleanOpts>) => onChange({ ...value, ...patch });
  return (
    <div className="rtxw-preclean">
      <label className="rtxw-toggle">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>{title}</span>
      </label>
      {value.enabled && (
        <div className="rtxw-preclean-body">
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.deblock} onChange={(e) => set({ deblock: e.target.checked })} />
            <span>Deblock</span>
          </label>
          {value.deblock && (
            <div className="rtxw-pc-grid">
              <label>
                filter
                <select
                  value={value.deblockFilter}
                  onChange={(e) => set({ deblockFilter: e.target.value as "weak" | "strong" })}
                >
                  <option value="weak">weak</option>
                  <option value="strong">strong</option>
                </select>
              </label>
              <label>
                block
                <input type="number" step={8} min={4} max={32} value={value.block} onChange={(e) => set({ block: num(e.target.value, 8) })} />
              </label>
              <label>
                alpha
                <input type="number" step={0.01} value={value.alpha} onChange={(e) => set({ alpha: num(e.target.value, 0) })} />
              </label>
              <label>
                beta
                <input type="number" step={0.01} value={value.beta} onChange={(e) => set({ beta: num(e.target.value, 0) })} />
              </label>
              <label>
                gamma
                <input type="number" step={0.01} value={value.gamma} onChange={(e) => set({ gamma: num(e.target.value, 0) })} />
              </label>
              <label>
                delta
                <input type="number" step={0.01} value={value.delta} onChange={(e) => set({ delta: num(e.target.value, 0) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.deband} onChange={(e) => set({ deband: e.target.checked })} />
            <span>Deband</span>
          </label>
          {value.deband && (
            <div className="rtxw-pc-grid">
              <label>
                thr
                <input type="number" step={0.001} value={value.debandThr} onChange={(e) => set({ debandThr: num(e.target.value, 0.008) })} />
              </label>
              <label>
                range
                <input type="number" step={1} min={1} max={64} value={value.debandRange} onChange={(e) => set({ debandRange: num(e.target.value, 16) })} />
              </label>
              <label className="rtxw-pc-cb">
                blur
                <input type="checkbox" checked={value.debandBlur} onChange={(e) => set({ debandBlur: e.target.checked })} />
              </label>
              <label className="rtxw-pc-cb">
                coupling
                <input type="checkbox" checked={value.debandCoupling} onChange={(e) => set({ debandCoupling: e.target.checked })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.spp} onChange={(e) => set({ spp: e.target.checked })} />
            <span>Strong deblock (spp)</span>
          </label>
          {value.spp && (
            <div className="rtxw-pc-grid">
              <label>
                strength
                <input type="number" step={1} min={0} max={6} value={value.sppStrength} onChange={(e) => set({ sppStrength: num(e.target.value, 4) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.uspp} onChange={(e) => set({ uspp: e.target.checked })} />
            <span>Ultra deblock (uspp — strongest, slow)</span>
          </label>
          {value.uspp && (
            <div className="rtxw-pc-grid">
              <label>
                quality
                <input type="number" step={1} min={0} max={8} value={value.usppStrength} onChange={(e) => set({ usppStrength: num(e.target.value, 3) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.libplacebo} onChange={(e) => set({ libplacebo: e.target.checked })} />
            <span>libplacebo deband + dither (GPU)</span>
          </label>
          {value.libplacebo && (
            <div className="rtxw-pc-grid">
              <label>
                iterations
                <input type="number" step={1} min={1} max={8} value={value.lpIterations} onChange={(e) => set({ lpIterations: num(e.target.value, 3) })} />
              </label>
              <label>
                threshold
                <input type="number" step={1} value={value.lpThreshold} onChange={(e) => set({ lpThreshold: num(e.target.value, 6) })} />
              </label>
              <label>
                radius
                <input type="number" step={1} value={value.lpRadius} onChange={(e) => set({ lpRadius: num(e.target.value, 24) })} />
              </label>
              <label>
                grain
                <input type="number" step={1} value={value.lpGrain} onChange={(e) => set({ lpGrain: num(e.target.value, 6) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.denoise} onChange={(e) => set({ denoise: e.target.checked })} />
            <span>Edge denoise (nlmeans GPU — kills mosquito, fast)</span>
          </label>
          {value.denoise && (
            <div className="rtxw-pc-grid">
              <label>
                strength
                <input type="number" step={0.5} min={0} max={100} value={value.denoiseStrength} onChange={(e) => set({ denoiseStrength: num(e.target.value, 3) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.cas} onChange={(e) => set({ cas: e.target.checked })} />
            <span>CAS sharpen (last)</span>
          </label>
          {value.cas && (
            <div className="rtxw-pc-grid">
              <label>
                strength
                <input type="number" step={0.05} min={0} max={1} value={value.casStrength} onChange={(e) => set({ casStrength: num(e.target.value, 0.4) })} />
              </label>
            </div>
          )}
          <label className="rtxw-toggle sub">
            <input type="checkbox" checked={value.presmooth} onChange={(e) => set({ presmooth: e.target.checked })} />
            <span>Pre-smooth for VSR (gblur — de-staircases edges)</span>
          </label>
          {value.presmooth && (
            <div className="rtxw-pc-grid">
              <label>
                sigma
                <input type="number" step={0.1} min={0} max={3} value={value.presmoothSigma} onChange={(e) => set({ presmoothSigma: num(e.target.value, 0.6) })} />
              </label>
            </div>
          )}
          <label className="rtxw-pc-raw">
            <span>Raw -vf override</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="(optional) replaces the chain above"
              value={value.raw}
              onChange={(e) => set({ raw: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** One settings control set (Quality / Scale / Pre-clean / Post-clean), reused for a clip or the defaults. */
function SettingsFields({
  quality,
  scale,
  preclean,
  postclean,
  onChange,
}: {
  quality: number;
  scale: number;
  preclean: PrecleanOpts;
  postclean: PrecleanOpts;
  onChange: (opts: EnqueueOpts) => void;
}) {
  return (
    <>
      <div className="rtxw-field">
        <span className="rtxw-field-label">Quality</span>
        <select className="rtxw-select" value={quality} onChange={(e) => onChange({ quality: Number(e.target.value) })}>
          <option value={4}>Ultra</option>
          <option value={3}>High</option>
          <option value={2}>Medium</option>
          <option value={1}>Low</option>
        </select>
      </div>
      <div className="rtxw-field">
        <span className="rtxw-field-label">Scale</span>
        <select className="rtxw-select" value={scale} onChange={(e) => onChange({ scale: Number(e.target.value) })}>
          <option value={4}>4× upscale</option>
          <option value={2}>2× upscale</option>
          <option value={1}>Decompress only (1×)</option>
        </select>
      </div>
      <PrecleanFields value={preclean} onChange={(p) => onChange({ preclean: p })} />
      <PrecleanFields
        value={postclean}
        title="Post-clean (after VSR)"
        onChange={(p) => onChange({ postclean: p })}
      />
    </>
  );
}

/** A live preview session: one raw slice, re-filtered in place; VSR on demand. */
type Slice = { key: string; startSec: number; before: string; cleaned: string };

export function RtxEnhanceWindow() {
  const {
    jobs,
    windowJobId,
    openWindow,
    closeWindow,
    removeJob,
    cancelJob,
    enqueuePaths,
    setJobOptions,
    applyToStaged,
    startJob,
    startAllStaged,
    defaultQuality,
    setDefaultQuality,
    defaultScale,
    setDefaultScale,
    defaultPreclean,
    setDefaultPreclean,
    defaultPostclean,
    setDefaultPostclean,
    capability,
  } = useRtxEnhance();

  const isOpen = windowJobId !== null;
  const [dropHover, setDropHover] = useState(false);
  // Live preview session for the selected staged clip: a raw slice extracted
  // once, re-filtered live, with VSR rendered only when toggled on.
  const [slice, setSlice] = useState<Slice | null>(null);
  const [vsrPath, setVsrPath] = useState<string | null>(null);
  const [vsrOn, setVsrOn] = useState(false);
  // Difference map (where VSR changed the frame) — needs VSR rendered first.
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffOn, setDiffOn] = useState(false);
  const [busy, setBusy] = useState<null | "extract" | "filter" | "vsr" | "post" | "diff">(null);
  const regenSeq = useRef(0);
  // Cache of the RAW VSR slice, keyed by (frame + pre-clean + quality + scale).
  // Tuning ONLY the post-clean reuses this → the slow VSR pass doesn't re-run.
  const vsrCache = useRef<{ sig: string; raw: string } | null>(null);

  // OS drag-drop channel — external files dropped onto the open window.
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const fn = await getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") setDropHover(true);
          else if (p.type === "leave") setDropHover(false);
          else if (p.type === "drop") {
            setDropHover(false);
            const paths = (p as { paths?: string[] }).paths;
            if (paths && paths.length) enqueuePaths(paths);
          }
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch (err) {
        console.warn("[rtx] drag-drop subscribe failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isOpen, enqueuePaths]);

  const staged = useMemo(() => jobs.filter((j) => j.status === "staged"), [jobs]);
  const rendering = useMemo(() => jobs.filter((j) => j.status !== "staged"), [jobs]);

  const selected = useMemo(
    () =>
      jobs.find((j) => j.id === windowJobId) ??
      [...rendering].reverse().find((j) => j.status === "done") ??
      staged[0] ??
      rendering[rendering.length - 1] ??
      null,
    [jobs, windowJobId, rendering, staged],
  );

  // Extract the chosen frame's raw slice once; the live effect below fills in
  // the cleaned (and optionally VSR) versions right after.
  const pickFrame = useCallback(async (job: RtxJob, timeSec: number) => {
    const key = `${job.id}-${Date.now()}`;
    setBusy("extract");
    setVsrPath(null);
    setVsrOn(false);
    setDiffPath(null);
    setDiffOn(false);
    try {
      const before = await invoke<string>("rtx_slice_extract", {
        path: job.filePath,
        startSec: timeSec,
        key,
      });
      setSlice({ key, startSec: timeSec, before, cleaned: before });
    } catch (e) {
      console.warn("[rtx] slice extract failed:", e);
      setBusy(null);
    }
  }, []);

  const clearSlice = useCallback(() => {
    setSlice(null);
    setVsrPath(null);
    setVsrOn(false);
    setDiffPath(null);
    setDiffOn(false);
    setBusy(null);
    vsrCache.current = null;
  }, []);

  // Editing a staged clip's settings no longer wipes the preview — the live
  // effect re-renders it in place instead.
  const editStaged = useCallback(
    (id: string, opts: EnqueueOpts) => setJobOptions(id, opts),
    [setJobOptions],
  );

  // Re-apply cleanup (and VSR when toggled) for the current slice. Debounced by
  // the effect below; a sequence guard drops stale async results so a fast
  // slider drag always ends on the latest values.
  const regen = useCallback(
    async (job: RtxJob, before: string, key: string, useVsr: boolean, useDiff: boolean) => {
      const seq = ++regenSeq.current;
      setBusy("filter");
      try {
        // Unique per render (seq) so the output path CHANGES each time — the
        // webview caches asset URLs, so a stable filename shows a stale frame.
        const cleaned = await invoke<string>("rtx_slice_filter", {
          before,
          preclean: job.preclean,
          key: `${key}-c${seq}`,
        });
        if (seq !== regenSeq.current) return;
        setSlice((s) => (s && s.key === key ? { ...s, cleaned } : s));
        if (!useVsr) {
          setVsrPath(null);
          setDiffPath(null);
          return;
        }
        // Reuse the cached RAW VSR when only post-clean changed; otherwise run it.
        const vsrSig = `${key}|${JSON.stringify(job.preclean)}|${job.quality}|${job.scale}`;
        let rawVsr: string;
        if (vsrCache.current && vsrCache.current.sig === vsrSig) {
          rawVsr = vsrCache.current.raw;
        } else {
          setBusy("vsr");
          rawVsr = await invoke<string>("rtx_slice_vsr", {
            cleaned,
            quality: job.quality,
            scale: job.scale,
            hdr: job.hdr,
            key: `${key}-v${seq}`,
          });
          if (seq !== regenSeq.current) return;
          vsrCache.current = { sig: vsrSig, raw: rawVsr };
        }
        // Post-clean is the cheap step re-run on every tweak (VSR reused above).
        setBusy("post");
        const finalPath = await invoke<string>("rtx_slice_post", {
          vsr: rawVsr,
          postclean: job.postclean,
          key: `${key}-p${seq}`,
        });
        if (seq !== regenSeq.current) return;
        setVsrPath(finalPath);
        if (useDiff) {
          setBusy("diff");
          const diff = await invoke<string>("rtx_slice_diff", {
            before,
            after: rawVsr,
            key: `${key}-d${seq}`,
          });
          if (seq !== regenSeq.current) return;
          setDiffPath(diff);
        } else {
          setDiffPath(null);
        }
      } catch (e) {
        console.warn("[rtx] preview regen failed:", e);
      } finally {
        if (seq === regenSeq.current) setBusy(null);
      }
    },
    [],
  );

  const sel = selected && selected.status === "staged" ? selected : null;
  const precleanSig = sel ? JSON.stringify(sel.preclean) : "";
  const postcleanSig = sel ? JSON.stringify(sel.postclean) : "";
  // Reset the preview whenever the selected clip changes.
  useEffect(() => {
    clearSlice();
  }, [selected?.id, clearSlice]);
  // Live update: debounce settings changes into a single regen pass.
  useEffect(() => {
    if (!sel || !slice) return;
    const h = setTimeout(() => void regen(sel, slice.before, slice.key, vsrOn, diffOn), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precleanSig, postcleanSig, sel?.quality, sel?.scale, vsrOn, diffOn, slice?.key, slice?.before, regen]);

  if (!isOpen) return null;

  const editTarget = selected && selected.status === "staged" ? selected : null;

  function onHtml5Drop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData(MH_FILE_MIME);
    if (!raw) return;
    e.preventDefault();
    setDropHover(false);
    try {
      const paths = JSON.parse(raw) as string[];
      if (Array.isArray(paths) && paths.length) enqueuePaths(paths);
    } catch {
      /* malformed payload — ignore */
    }
  }
  function onHtml5DragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(MH_FILE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dropHover) setDropHover(true);
    }
  }

  // Decide what the viewer shows for the selected clip.
  function renderMain() {
    if (!selected) {
      return (
        <div className="rtxw-placeholder">
          <p className="faint">
            Drop videos here to set them up — or right-click a clip →
            “Upscale (NVIDIA RTX Video)”.
          </p>
        </div>
      );
    }
    const label = selected.scale <= 1 ? "AFTER · RTX clean" : "AFTER · RTX";
    if (selected.status === "done") {
      return (
        <Viewer
          key={`done-${selected.id}`}
          beforePath={selected.filePath}
          afterPath={rtxOutputPath(selected.filePath, selected.scale)}
          afterLabel={label}
        />
      );
    }
    if (selected.status === "staged") {
      if (slice) {
        const showVsr = vsrOn && !!vsrPath;
        const showDiff = diffOn && showVsr && !!diffPath;
        // Diff mode wipes VSR-result vs. the change heatmap (same res); else
        // raw vs. cleaned/VSR.
        const beforePath = showDiff ? vsrPath! : slice.before;
        const afterPath = showDiff ? diffPath! : showVsr ? vsrPath! : slice.cleaned;
        const afterLbl = showDiff ? "DIFF · where VSR acted" : showVsr ? label : "CLEANED";
        const busyLbl =
          busy === "vsr"
            ? " · rendering VSR…"
            : busy === "post"
              ? " · post…"
              : busy === "filter"
                ? " · cleaning…"
                : busy === "diff"
                  ? " · diffing…"
                  : "";
        return (
          <>
            <Viewer
              // Stable key per slice so re-filtering swaps the src WITHOUT
              // remounting — zoom/pan/divider position survive live updates.
              key={`prev-${slice.key}`}
              beforePath={beforePath}
              afterPath={afterPath}
              afterLabel={afterLbl}
              previewBusy={busy !== null}
            />
            <div className="rtxw-prevbar">
              <button className="rtxw-newframe" onClick={clearSlice}>
                ◀ Pick another frame
              </button>
              <label className="rtxw-vsrtoggle" title="Run RTX VSR on this frame (slower)">
                <input
                  type="checkbox"
                  checked={vsrOn}
                  onChange={(e) => {
                    setVsrOn(e.target.checked);
                    if (!e.target.checked) setDiffOn(false);
                  }}
                />
                <span>Show VSR{busyLbl}</span>
              </label>
              <label
                className={"rtxw-vsrtoggle" + (vsrOn ? "" : " disabled")}
                title="Highlight where VSR changed the frame (needs VSR on)"
              >
                <input
                  type="checkbox"
                  checked={diffOn}
                  disabled={!vsrOn}
                  onChange={(e) => setDiffOn(e.target.checked)}
                />
                <span>Diff map</span>
              </label>
            </div>
          </>
        );
      }
      return (
        <Viewer
          key={`src-${selected.id}`}
          beforePath={selected.filePath}
          onPreview={(t) => pickFrame(selected, t)}
          previewBusy={busy === "extract"}
        />
      );
    }
    // running / queued / failed → status card
    return (
      <div className="rtxw-placeholder">
        {selected.status === "failed" ? (
          <p>
            Enhance failed.
            <br />
            <span className="faint">{selected.error}</span>
          </p>
        ) : (
          <p>
            {selected.title}
            <br />
            <span className="faint">
              {selected.status === "running" ? `Enhancing… ${selected.percent.toFixed(0)}%` : "Queued"}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rtxw-overlay"
      // Close ONLY on a direct press of the backdrop. Using mousedown+target
      // check (not click) means a pan/divider drag that starts on the video and
      // happens to release over the backdrop can't accidentally close the window.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeWindow();
      }}
    >
      <div
        className={"rtxw" + (dropHover ? " drop-hover" : "")}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onHtml5DragOver}
        onDragLeave={() => setDropHover(false)}
        onDrop={onHtml5Drop}
      >
        <div className="rtxw-head">
          <Icon.video width={15} height={15} />
          <span className="rtxw-title">NVIDIA RTX Video — Enhance</span>
          <span className="rtxw-spacer" />
          <button className="rtxw-close" onClick={closeWindow} title="Close">
            <Icon.x width={14} height={14} />
          </button>
        </div>

        <div className="rtxw-body">
          <div className="rtxw-main">
            {renderMain()}
            {dropHover && <div className="rtxw-droplabel">Drop to add</div>}
          </div>

          <aside className="rtxw-side">
            <div className="rtxw-side-scroll">
              {/* STAGE 1 — Setting up. */}
              {staged.length > 0 && (
                <div className="rtxw-group">
                  <div className="rtxw-group-head">
                    <span>Setting up · {staged.length}</span>
                    <span className="rtxw-spacer" />
                    <button className="rtxw-startall" onClick={startAllStaged} title="Start all">
                      ▶ Start all
                    </button>
                  </div>
                  {staged.map((j) => (
                    <div
                      key={j.id}
                      className={`rtxw-row ${selected?.id === j.id ? "sel" : ""}`}
                      onClick={() => openWindow(j.id)}
                    >
                      <span className="rtxw-row-title" title={j.title}>
                        {j.title}
                      </span>
                      <span className="rtxw-row-meta">
                        {j.quality === 4 ? "Ultra" : j.quality === 3 ? "High" : j.quality === 2 ? "Med" : "Low"} ·{" "}
                        {j.scale <= 1 ? "1×" : "2×"}
                      </span>
                      <button
                        className="rtxw-startone"
                        title="Start this clip"
                        onClick={(e) => {
                          e.stopPropagation();
                          startJob(j.id);
                        }}
                      >
                        ▶
                      </button>
                      <button
                        className="rtxw-row-x"
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeJob(j.id);
                        }}
                      >
                        <Icon.x width={13} height={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* STAGE 2 — Rendering / done. */}
              <div className="rtxw-group">
                <div className="rtxw-group-head">
                  <span>Rendering</span>
                </div>
                {rendering.length === 0 && <div className="rtxw-empty faint">Nothing rendering yet</div>}
                {rendering.map((j) => (
                  <div
                    key={j.id}
                    className={`rtxw-row ${selected?.id === j.id ? "sel" : ""}`}
                    onClick={() => openWindow(j.id)}
                  >
                    <span className="rtxw-row-title" title={j.title}>
                      {j.title}
                    </span>
                    <span className={`rtxw-row-status s-${j.status}`}>
                      {j.status === "running" ? `${j.percent.toFixed(0)}%` : j.status}
                    </span>
                    <button
                      className="rtxw-row-x"
                      title={j.status === "running" ? "Stop" : "Remove"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (j.status === "running") cancelJob(j.id);
                        else removeJob(j.id);
                      }}
                    >
                      <Icon.x width={13} height={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ONE settings card — the selected staged clip, or the defaults. */}
            <div className="rtxw-settings">
              {editTarget ? (
                <>
                  <div className="rtxw-settings-head">
                    <span className="rtxw-settings-title" title={editTarget.title}>
                      {editTarget.title}
                    </span>
                  </div>
                  <SettingsFields
                    quality={editTarget.quality}
                    scale={editTarget.scale}
                    preclean={editTarget.preclean}
                    postclean={editTarget.postclean}
                    onChange={(opts) => editStaged(editTarget.id, opts)}
                  />
                  <div className="rtxw-settings-actions">
                    <button
                      className="rtxw-linkbtn"
                      title="Apply this clip's settings to every staged clip"
                      onClick={() => {
                        applyToStaged({
                          quality: editTarget.quality,
                          scale: editTarget.scale,
                          hdr: editTarget.hdr,
                          preclean: editTarget.preclean,
                          postclean: editTarget.postclean,
                        });
                      }}
                    >
                      Apply to all
                    </button>
                    <span className="rtxw-spacer" />
                    <button className="rtxw-startall" onClick={() => startJob(editTarget.id)}>
                      ▶ Start
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rtxw-settings-head">
                    <span className="rtxw-settings-title">Defaults</span>
                    <span className="rtxw-settings-sub faint">new drops &amp; right-click</span>
                  </div>
                  <SettingsFields
                    quality={defaultQuality}
                    scale={defaultScale}
                    preclean={defaultPreclean}
                    postclean={defaultPostclean}
                    onChange={(opts) => {
                      if (opts.quality != null) setDefaultQuality(opts.quality);
                      if (opts.scale != null) setDefaultScale(opts.scale);
                      if (opts.preclean != null) setDefaultPreclean(opts.preclean);
                      if (opts.postclean != null) setDefaultPostclean(opts.postclean);
                    }}
                  />
                </>
              )}
              {capability?.gpu_name && <div className="rtxw-note faint">{capability.gpu_name}</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
