/**
 * In-app scrubber preview (0.6 Phase D).
 *
 * Streams the source URL directly via yt-dlp's `-g` flag — no
 * download required to scrub. The HTML5 <video> element handles
 * playback; we layer transport controls + In/Out markers on top.
 *
 * Keyboard shortcuts (active whenever the scrubber is mounted and
 * no text input has focus):
 *   Space       play/pause
 *   ← / →       frame-step (1/fps second, fallback 1/30)
 *   Shift + ←/→ skip 1 second
 *   I           mark In at current time
 *   O           mark Out at current time
 *
 * Fallback: if the stream URL fails to resolve or the <video> can't
 * play it (CORS, missing codec, etc.), we surface an error chip and
 * the parent's text-input row remains the way to set In/Out.
 *
 * Why "scrub the source URL" not "download a proxy first":
 * - Zero bandwidth spent until the user commits to the segment
 * - Most YouTube formats stream fine in the webview (MP4 ≤720p
 *   resolves to a CDN URL the browser can request with Range)
 * - For the formats that DON'T stream well, we fall back to a
 *   downloaded proxy in a future polish session (see NOTES.md
 *   "scratch-preview tier") — not blocking 0.6
 */

import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { fmtDuration } from "../lib/format";
import { useSettings } from "../lib/settings";
import type { FormatOption, Segment, Storyboard, Chapter } from "../lib/types";

type StreamUrl = { url: string; has_audio: boolean };

type ScrubberProps = {
  /** The original YouTube URL — used to resolve the direct stream. */
  sourceUrl: string;
  /** EXPERIMENT (exp/preview-proxy) — video id, used to fetch + cache a
   *  small local proxy we swap in for smoother scrubbing. */
  videoId?: string | null;
  /** EXPERIMENT — fetched formats, used to estimate the proxy download
   *  size so "auto" picks the highest quality that stays under the cap. */
  formats?: FormatOption[];
  /** Total duration in seconds (from metadata fetch). Optional — we
   *  also read video.duration once the element loads metadata. */
  durationHint: number | null;
  /** FPS hint for frame-step granularity. Falls back to 30. */
  fpsHint: number | null;
  /** Tier 1 — sprite-sheet thumbnails for hover-scrubbing the bar. */
  storyboard?: Storyboard | null;
  /** YouTube chapters/markers — shown as bar ticks + a jump list. */
  chapters?: Chapter[];
  /** Committed segments. Empty array = full-video download.
   *  N entries = N segment trims from the same source. */
  segments: Segment[];
  /** Replace the whole segment list. The component drives all mutations
   *  through this single setter so the parent stays the source of truth. */
  onSegmentsChange: (segs: Segment[]) => void;
};

export function Scrubber(props: ScrubberProps) {
  const {
    sourceUrl,
    videoId,
    formats,
    durationHint,
    fpsHint,
    storyboard,
    chapters,
    segments,
    onSegmentsChange,
  } = props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // EXPERIMENT (exp/preview-proxy) — local proxy. We play the remote
  // stream immediately, then swap to this local file when it lands so
  // seeks have no network round-trip. `playable` = whatever the <video>
  // can use right now (proxy preferred). lastTimeRef preserves the
  // playhead across the swap; pendingSeekRef re-seeks after the new src
  // loads metadata.
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [proxyState, setProxyState] = useState<
    "idle" | "preparing" | "ready" | "failed"
  >("idle");
  const lastTimeRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  // EXPERIMENT (Tier 3) — frame-exact overlay. When paused, we cut a
  // short all-intra window around the playhead and show it on top of the
  // (keyframe-snappy) proxy so the displayed/stepped frame is exact.
  const fineRef = useRef<HTMLVideoElement>(null);
  const [fineUrl, setFineUrl] = useState<string | null>(null);
  const [fineStart, setFineStart] = useState(0);
  const [fineDur, setFineDur] = useState(0);
  // Live mirror of the current window so the jog drag (a closure captured
  // at mousedown) can read the latest window without going stale.
  const fineWinRef = useRef<{ url: string | null; start: number; dur: number }>({
    url: null,
    start: 0,
    dur: 0,
  });
  const FINE_RADIUS = 3; // seconds each side of the pause point
  // AE-style cache line: time ranges that have a frame-exact window
  // prepared (rendered blue on the bar; the rest reads red = not cached).
  const [cachedWindows, setCachedWindows] = useState<
    Array<{ start: number; end: number }>
  >([]);
  // Tier 1 — storyboard hover preview. Tracks the pointer over the bar.
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  // The HTML5 element reports playback state through events; we
  // mirror it into React state so the UI reflects it.
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Volume + mute. Default to 0.5 because YouTube source URLs are
  // mastered loud and 1.0 will deafen anyone wearing headphones.
  // Persist across sessions — once the user finds their preferred
  // level, they shouldn't re-set it every paste. localStorage write
  // is cheap (<1ms) so we do it on every change.
  const [volume, setVolume] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("mh.scrubber.volume.v1");
      const n = raw == null ? 0.5 : Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
    } catch {
      return 0.5;
    }
  });
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mh.scrubber.muted.v1") === "1";
    } catch {
      return false;
    }
  });
  // Element's own duration takes precedence once it loads. We
  // fall back to the hint while waiting.
  const [duration, setDuration] = useState<number>(durationHint ?? 0);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  // Draft In time — set when the user hits `I` (or Set In). Cleared
  // when `O` commits a segment, or when the user clears manually.
  // The "I then scrub then O" flow every NLE supports.
  const [draftIn, setDraftIn] = useState<number | null>(null);
  // Transient warning flash for invalid marks (Out before In, etc.).
  // Auto-clears after ~2s.
  const [markWarning, setMarkWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!markWarning) return;
    const id = setTimeout(() => setMarkWarning(null), 1800);
    return () => clearTimeout(id);
  }, [markWarning]);

  const fps = Math.max(1, Math.min(120, Math.round(fpsHint ?? 30)));
  const frameSec = 1 / fps;

  // Reset everything when the source URL changes.
  useEffect(() => {
    setStreamUrl(null);
    setStreamErr(null);
    setCurrentTime(0);
    setDuration(durationHint ?? 0);
    setPlaying(false);
    setVideoErr(null);
    setDraftIn(null);
    if (!sourceUrl.trim()) return;
    setResolving(true);
    invoke<StreamUrl>("yt_resolve_stream_url", { url: sourceUrl })
      .then((res) => setStreamUrl(res.url))
      .catch((e) => setStreamErr(String(e)))
      .finally(() => setResolving(false));
  }, [sourceUrl, durationHint]);

  // EXPERIMENT — fetch a local proxy in the background and swap to it.
  // Runs in parallel with the stream resolve above; on success we swap
  // the <video> source to the local file (instant seeks) preserving the
  // current playhead. Failure is silent — we just stay on the stream.
  //
  // Quality comes from settings.preview_quality. "auto" picks the
  // highest quality whose ESTIMATED proxy download stays under a cap
  // (sizes come from the fetched formats), so a tiny 360p proxy is used
  // even for very long videos, and we only stream (skip the proxy) when
  // even 360p would be too big. 360p of a 6.5h video is ~500 MB, so this
  // almost always lands on a real proxy.
  const GB = 1024 * 1024 * 1024;
  const CAP_720 = 1.5 * GB;
  const CAP_360 = 3 * GB;
  function estimateProxyBytes(maxH: number): number | null {
    if (!formats || formats.length === 0) return null;
    const sized = formats.filter((f) => (f.filesize_bytes ?? 0) > 0);
    if (sized.length === 0) return null;
    const vids = sized.filter((f) => f.has_video && (f.height ?? 1e9) <= maxH);
    if (vids.length === 0) return null;
    // Mirror the backend spec: prefer avc1/mp4, pick the one closest to
    // the target height (largest ≤ maxH).
    const avc = vids.filter(
      (f) => f.ext === "mp4" && (f.vcodec ?? "").toLowerCase().startsWith("avc1"),
    );
    const pool = avc.length ? avc : vids;
    const vid = pool.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a));
    let bytes = vid.filesize_bytes ?? 0;
    if (!vid.has_audio) {
      const auds = sized.filter((f) => f.has_audio && !f.has_video);
      if (auds.length > 0) {
        const aud = auds.reduce((a, b) =>
          (b.filesize_bytes ?? 0) < (a.filesize_bytes ?? 0) ? b : a,
        );
        bytes += aud.filesize_bytes ?? 0;
      }
    }
    return bytes;
  }
  function autoHeight(): number | null {
    const e720 = estimateProxyBytes(720);
    const e360 = estimateProxyBytes(360);
    if (e720 != null && e720 <= CAP_720) return 720;
    if (e360 != null && e360 <= CAP_360) return 360;
    if (e360 == null) {
      // Unknown sizes — fall back to a duration heuristic (360p is small
      // enough to allow even multi-hour clips).
      const d = durationHint ?? 0;
      if (d === 0) return 720;
      if (d <= 25 * 60) return 720;
      if (d <= 8 * 60 * 60) return 360;
      return null;
    }
    return null; // even 360p over the cap → stream only
  }
  const previewHeight = ((): number | null => {
    const q = settings.preview_quality ?? "auto";
    if (q === "off") return null;
    if (q === "auto") return autoHeight();
    const n = parseInt(q, 10);
    return Number.isFinite(n) && n > 0 ? n : autoHeight();
  })();
  useEffect(() => {
    setProxyUrl(null);
    setProxyState("idle");
    if (!sourceUrl.trim() || !videoId || previewHeight == null) return;
    let cancelled = false;
    setProxyState("preparing");
    invoke<{ path: string; cached: boolean }>("preview_proxy", {
      url: sourceUrl,
      videoId,
      maxHeight: previewHeight,
    })
      .then((res) => {
        if (cancelled) return;
        pendingSeekRef.current = lastTimeRef.current;
        setProxyUrl(convertFileSrc(res.path));
        setProxyState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[preview-proxy] failed:", e);
        setProxyState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl, videoId, previewHeight]);

  // The source the <video> actually uses right now: the local proxy when
  // ready, else the remote stream (Tier 0 fallback).
  const playable = proxyUrl ?? streamUrl;

  // EXPERIMENT (Tier 3) — frame-exact overlay is active only when paused
  // and the current time falls inside a prepared all-intra window.
  const fineActive =
    !playing &&
    fineUrl != null &&
    currentTime >= fineStart &&
    currentTime <= fineStart + fineDur;

  // Reset the fine window + cache line when the source changes.
  useEffect(() => {
    setFineUrl(null);
    setFineStart(0);
    setFineDur(0);
    fineWinRef.current = { url: null, start: 0, dur: 0 };
    setCachedWindows([]);
  }, [sourceUrl, videoId]);

  // When paused on a point (and we have a local proxy), cut a short
  // all-intra window around it in the background. Debounced so dragging
  // doesn't spam ffmpeg; skipped if the current window already covers
  // the playhead. Never blocks the proxy/stream playback.
  useEffect(() => {
    if (playing || proxyState !== "ready" || !videoId || previewHeight == null) {
      return;
    }
    const t = currentTime;
    if (fineUrl && t >= fineStart && t <= fineStart + fineDur) return; // covered
    const id = window.setTimeout(() => {
      invoke<{ path: string; start_sec: number; dur_sec: number }>(
        "preview_intra_window",
        { videoId, maxHeight: previewHeight, centerSec: t, radiusSec: FINE_RADIUS },
      )
        .then((res) => {
          // Cache-bust per window-start so the element reloads the new file.
          const fineSrc = convertFileSrc(res.path) + `#w${res.start_sec}`;
          setFineStart(res.start_sec);
          setFineDur(res.dur_sec);
          setFineUrl(fineSrc);
          fineWinRef.current = {
            url: fineSrc,
            start: res.start_sec,
            dur: res.dur_sec,
          };
          // Record the range for the cache line (dedupe by start).
          setCachedWindows((prev) =>
            prev.some((w) => w.start === res.start_sec)
              ? prev
              : [...prev, { start: res.start_sec, end: res.start_sec + res.dur_sec }],
          );
        })
        .catch((e) => console.warn("[intra-window] failed:", e));
    }, 350);
    return () => window.clearTimeout(id);
  }, [playing, currentTime, proxyState, videoId, previewHeight, fineUrl, fineStart, fineDur]);

  // Keep the overlay frame in sync with the global playhead while active.
  useEffect(() => {
    const fv = fineRef.current;
    if (!fv || !fineActive) return;
    const local = Math.max(0, Math.min(fineDur, currentTime - fineStart));
    try {
      fv.currentTime = local;
    } catch {
      /* not loaded yet — the loadeddata handler will re-seek */
    }
  }, [fineActive, currentTime, fineStart, fineDur]);

  /**
   * Mark functions. `I` and the Set In button → markIn; `O` and Set
   * Out button → markOut. markOut commits the segment immediately when
   * draftIn is set; otherwise warns the user to set In first.
   */
  function markIn() {
    const v = videoRef.current;
    if (!v) return;
    setDraftIn(v.currentTime);
    setMarkWarning(null);
  }
  function markOut() {
    const v = videoRef.current;
    if (!v) return;
    const out = v.currentTime;
    if (draftIn == null) {
      setMarkWarning("Set In (I) first");
      return;
    }
    if (out <= draftIn) {
      setMarkWarning("Out must be after In");
      return;
    }
    onSegmentsChange([...segments, { inSec: draftIn, outSec: out }]);
    setDraftIn(null);
  }
  function clearDraft() {
    setDraftIn(null);
    setMarkWarning(null);
  }
  function removeSegment(index: number) {
    onSegmentsChange(segments.filter((_, i) => i !== index));
  }
  function clearAll() {
    onSegmentsChange([]);
    setDraftIn(null);
  }

  /**
   * Jog scrub — Resolve-style fine-scrub control. The main bar is
   * "position = whole video" so on long sources each pixel is many
   * seconds. The jog converts mouse-drag distance into a SMALL time
   * delta (~1 second per 80px) so users can hunt for a specific frame
   * by hand without needing keyboard arrow-step.
   *
   * On mousedown we capture the starting mouseX and currentTime.
   * On mousemove we compute the delta and seek directly. On mouseup
   * we end the drag. The disc visually returns to center — it's not
   * a slider where the dot tracks position, it's a "scrub wheel"
   * where the dot is just the grab handle.
   *
   * Pauses while jogging (same as main bar drag) so we don't fight
   * the playhead. Resumes on release if it was playing.
   */
  // Sensitivity comes from settings (0.9.D). Multiplier of 1.0 = 80px
  // drag per second (the original tuned value). 0.5 = coarser, 2.0 =
  // finer. Reactive — changing it in Settings updates live without a
  // scrubber remount.
  const jogSensitivity =
    settings.jog_sensitivity > 0 ? settings.jog_sensitivity : 1.0;
  const SECONDS_PER_PIXEL = (1 / 80) * jogSensitivity;
  const jogDiscRef = useRef<HTMLDivElement>(null);
  const [jogActive, setJogActive] = useState(false);

  function onJogMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startTime = v.currentTime;
    const wasPlaying = !v.paused;
    v.pause();
    setJogActive(true);

    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * SECONDS_PER_PIXEL;
      const next = Math.max(0, Math.min(duration, startTime + delta));
      // Direct seek — different from the main bar's deferred seek.
      // The whole point of jog is real-time fine control, and the
      // delta-per-pixel is so small that we're not requesting wildly
      // different ranges; CDN handles this gracefully.
      v.currentTime = next;
      // If the target lands inside a prepared all-intra window, drive the
      // frame-exact overlay imperatively here instead of waiting on the
      // throttled timeupdate→state→effect path. That path only fires a
      // few times a second, which is what makes the jog look like it
      // skips frames even when a window is cached. Every frame in the
      // window is a keyframe, so this seek is exact and instant.
      const win = fineWinRef.current;
      const fv = fineRef.current;
      if (fv && win.url && next >= win.start && next <= win.start + win.dur) {
        try {
          fv.currentTime = next - win.start;
          fv.style.opacity = "1";
        } catch {
          /* not loaded yet */
        }
      } else if (fv) {
        fv.style.opacity = "0";
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setJogActive(false);
      if (wasPlaying) void v.play();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function jogStep(direction: 1 | -1) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + direction * frameSec));
  }

  // Wire <video> events to React state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      lastTimeRef.current = v.currentTime;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoaded = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
      }
      // EXPERIMENT — after swapping to the proxy, restore the playhead.
      if (pendingSeekRef.current != null) {
        const t = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (Number.isFinite(t) && t > 0) {
          try {
            v.currentTime = t;
          } catch {
            /* element not ready — ignore */
          }
        }
      }
    };
    const onError = () => {
      // The video element's error is opaque (codes 1-4 mapping to
      // generic categories: aborted / network / decode / src not
      // supported). Most of what we see in practice is "seeked past
      // a not-yet-buffered range and CDN choked" — recoverable by
      // re-loading the same URL.
      setVideoErr("playback failed — retry or use manual entry below");
    };
    const onCanPlay = () => {
      // Recovered from a previous error (e.g. user clicked Retry
      // or the network blip cleared). Drop the message.
      setVideoErr(null);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("error", onError);
    v.addEventListener("canplay", onCanPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("error", onError);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [playable]);

  /**
   * Re-attempt playback after an error. Two recovery paths:
   *   1. Same URL — cheapest, handles transient network blips. We
   *      call v.load() to reset the element's state machine and
   *      let it re-request the URL.
   *   2. Re-resolve URL — when the signed URL has expired (rare in
   *      under an hour but possible). Forces a new `yt-dlp -g`.
   *
   * Try #1 first; if the error fires again on the same URL within
   * a few seconds, the user can hit Retry again to force #2.
   */
  const retryAttemptRef = useRef(0);
  function retryPlayback() {
    setVideoErr(null);
    retryAttemptRef.current++;
    const v = videoRef.current;
    if (retryAttemptRef.current >= 2) {
      // Second retry — re-resolve the stream URL from scratch.
      retryAttemptRef.current = 0;
      setStreamUrl(null);
      setResolving(true);
      invoke<StreamUrl>("yt_resolve_stream_url", { url: sourceUrl })
        .then((res) => setStreamUrl(res.url))
        .catch((e) => setStreamErr(String(e)))
        .finally(() => setResolving(false));
      return;
    }
    // First retry — just reload the existing source.
    if (v) {
      v.load();
      void v.play().catch(() => {
        // Autoplay can fail without user interaction — that's fine,
        // the user just clicked Retry so they'll click play next.
      });
    }
  }

  // Global keyboard shortcuts. We deliberately listen on document
  // (not the video element) so the user can keep the URL input
  // focused for paste-paste-paste workflows and still control the
  // scrubber. But we skip when the active element is a text input
  // — otherwise Space inserts a space in the URL bar.
  useEffect(() => {
    if (!playable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      const editing =
        t === "INPUT" ||
        t === "TEXTAREA" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (editing) return;
      const v = videoRef.current;
      if (!v) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (v.paused) v.play();
        else v.pause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        v.pause();
        v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 1 : frameSec));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        v.pause();
        v.currentTime = Math.min(duration, v.currentTime + (e.shiftKey ? 1 : frameSec));
      } else if (e.code === "KeyI") {
        e.preventDefault();
        markIn();
      } else if (e.code === "KeyO") {
        e.preventDefault();
        markOut();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // markIn / markOut close over current state via setDraftIn /
    // onSegmentsChange; they're stable across renders, so we don't
    // need them as deps. But we DO want streamUrl + frameSec + draftIn
    // + segments updates to refresh the listener so the next keypress
    // sees current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable, frameSec, duration, draftIn, segments]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  // Apply React-state volume to the actual element whenever either
  // changes, including on first load before the user touches the
  // slider. Persist on every change.
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
    try {
      localStorage.setItem("mh.scrubber.volume.v1", String(volume));
      localStorage.setItem("mh.scrubber.muted.v1", muted ? "1" : "0");
    } catch {
      // localStorage quota / disabled — fine, just don't persist this tick
    }
  }, [volume, muted, playable]);

  function toggleMute() {
    setMuted((m) => !m);
  }

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, sec));
  }

  function onScrubBarMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const bar = scrubBarRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    // Pause while dragging so we don't fight the playback head.
    const v = videoRef.current;
    const wasPlaying = v && !v.paused;
    v?.pause();

    const seek = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekTo(ratio * duration);
    };
    seek(e.clientX);

    const onMove = (ev: MouseEvent) => seek(ev.clientX);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (wasPlaying) v?.play();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Position helpers for the markers (% of bar width).
  const posPct = (s: number | null): string | null =>
    s == null || duration <= 0 ? null : `${Math.max(0, Math.min(100, (s / duration) * 100))}%`;

  // Tier 1 — map a timestamp to a sprite tile in the storyboard sheets.
  // Each fragment is one sheet of rows*cols tiles. Prefer per-fragment
  // durations (yt-dlp provides them); fall back to an even split over
  // the video duration if they're missing.
  function storyTile(time: number) {
    if (!storyboard || storyboard.fragments.length === 0 || duration <= 0) {
      return null;
    }
    const { tile_w, tile_h, rows, cols, fragments } = storyboard;
    const perSheet = rows * cols;
    if (perSheet <= 0) return null;
    const totalDur = fragments.reduce((a, f) => a + (f.duration > 0 ? f.duration : 0), 0);
    let fragIndex = 0;
    let localFrac = 0;
    if (totalDur > 0) {
      let acc = 0;
      for (let i = 0; i < fragments.length; i++) {
        const d = fragments[i].duration > 0 ? fragments[i].duration : 0;
        if (time < acc + d || i === fragments.length - 1) {
          fragIndex = i;
          localFrac = d > 0 ? (time - acc) / d : 0;
          break;
        }
        acc += d;
      }
    } else {
      const totalTiles = fragments.length * perSheet;
      const gi = Math.min(totalTiles - 1, Math.floor((time / duration) * totalTiles));
      fragIndex = Math.floor(gi / perSheet);
      localFrac = (gi % perSheet) / perSheet;
    }
    localFrac = Math.max(0, Math.min(0.999, localFrac));
    const tileIndex = Math.min(perSheet - 1, Math.floor(localFrac * perSheet));
    const row = Math.floor(tileIndex / cols);
    const col = tileIndex % cols;
    return {
      url: fragments[fragIndex].url,
      bgX: -(col * tile_w),
      bgY: -(row * tile_h),
      sheetW: cols * tile_w,
      sheetH: rows * tile_h,
      tile_w,
      tile_h,
    };
  }

  // Chapters → add the whole chapter as a download segment in one click.
  function addChapterSegment(ch: Chapter) {
    const inSec = Math.max(0, ch.start_sec);
    const end = ch.end_sec > ch.start_sec ? ch.end_sec : duration || ch.start_sec;
    const outSec = duration > 0 ? Math.min(duration, end) : end;
    if (outSec <= inSec) return;
    onSegmentsChange([...segments, { inSec, outSec }]);
  }

  const chapterList = chapters ?? [];

  // Which chapter the hover (or playhead) falls in, plus its span on the
  // bar — drives the YouTube-style highlight + the title in the bubble.
  function chapterAt(time: number) {
    if (chapterList.length === 0) return null;
    let idx = -1;
    for (let i = 0; i < chapterList.length; i++) {
      if (chapterList[i].start_sec <= time + 0.001) idx = i;
      else break;
    }
    if (idx < 0) return null;
    const ch = chapterList[idx];
    const end = idx + 1 < chapterList.length ? chapterList[idx + 1].start_sec : duration;
    return { idx, title: ch.title, start: ch.start_sec, end };
  }
  const hoverChapter = hover ? chapterAt(hover.time) : null;

  // Compute on-bar regions for each committed segment. Multiple bands
  // can render side-by-side or even overlap (we don't validate
  // overlapping segments — user can do what they want).
  const segmentRegions = duration > 0
    ? segments.map((seg, i) => ({
        index: i,
        left: posPct(seg.inSec) ?? "0%",
        width: `${Math.max(0, ((seg.outSec - seg.inSec) / duration) * 100)}%`,
        seg,
      }))
    : [];

  // Draft region — visible from draftIn to the current playhead so
  // the user gets live feedback on the segment they're marking.
  // Renders in a lighter tint to distinguish from committed bands.
  const draftRegion =
    draftIn != null && duration > 0 && currentTime >= draftIn
      ? {
          left: posPct(draftIn) ?? "0%",
          width: `${Math.max(0, ((currentTime - draftIn) / duration) * 100)}%`,
        }
      : null;

  // Position of the playhead on the bar (current % of duration).
  const currentPct = posPct(currentTime) ?? "0%";

  return (
    <div className="scrubber">
      {/* Player */}
      <div className="scrubber-player">
        {/* EXPERIMENT — proxy status pill (top-left of the player) */}
        {proxyState === "preparing" && (
          <div className="scrubber-proxy-badge">preparing smooth preview…</div>
        )}
        {proxyState === "ready" && (
          <div className="scrubber-proxy-badge ready">⚡ smooth preview</div>
        )}
        {/* EXPERIMENT (Tier 3) — frame-exact overlay. Sits on top of the
            proxy and shows the precise frame when paused inside a window. */}
        {fineUrl && (
          <video
            ref={fineRef}
            src={fineUrl}
            muted
            preload="auto"
            playsInline
            onLoadedData={() => {
              const fv = fineRef.current;
              if (!fv) return;
              fv.currentTime = Math.max(
                0,
                Math.min(fineDur, lastTimeRef.current - fineStart),
              );
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#000",
              opacity: fineActive ? 1 : 0,
              transition: "opacity 80ms linear",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        )}
        {fineActive && (
          <div className="scrubber-proxy-badge ready" style={{ left: "auto", right: 8 }}>
            ◆ frame-exact
          </div>
        )}
        {playable ? (
          <video
            ref={videoRef}
            src={playable}
            preload="metadata"
            // No native controls — we provide our own + keyboard shortcuts.
            // Muting is the user's call; default unmuted so editorial
            // judgment of segment-start beat is possible.
            playsInline
          />
        ) : (
          <div className="scrubber-player-placeholder">
            {resolving
              ? "Resolving stream…"
              : streamErr
                ? `Stream unavailable — ${streamErr}`
                : "Fetch metadata to enable scrubbing."}
          </div>
        )}
        {videoErr && (
          <div className="scrubber-error">
            <span>{videoErr}</span>
            <button type="button" className="scrubber-error-retry" onClick={retryPlayback}>
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Transport bar */}
      <div className="scrubber-transport">
        <button
          className="ic-btn"
          onClick={togglePlay}
          disabled={!playable}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor">
              <rect x="4" y="3" width="3" height="10" rx="0.5" />
              <rect x="9" y="3" width="3" height="10" rx="0.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor">
              <path d="M4 3l9 5-9 5z" />
            </svg>
          )}
        </button>
        <span className="scrubber-time mono">
          {fmtDuration(currentTime)} / {fmtDuration(duration || null)}
        </span>
        <span className="scrubber-fps mono faint">{fps} fps</span>

        {/* Volume controls — speaker icon toggles mute, slider sets
            level 0..1. Both persist to localStorage. Default 0.5 so
            first-paste doesn't blow eardrums on YouTube source URLs. */}
        <div className="scrubber-volume">
          <button
            type="button"
            className="ic-btn"
            onClick={toggleMute}
            disabled={!playable}
            title={muted || volume === 0 ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? (
              <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h2l3-2.5v9L5 10H3V6z" fill="currentColor" />
                <path d="M11 6l4 4M15 6l-4 4" />
              </svg>
            ) : volume < 0.5 ? (
              <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h2l3-2.5v9L5 10H3V6z" fill="currentColor" />
                <path d="M11 6.5a2.5 2.5 0 0 1 0 3" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h2l3-2.5v9L5 10H3V6z" fill="currentColor" />
                <path d="M11 6.5a2.5 2.5 0 0 1 0 3" />
                <path d="M13 5a4.5 4.5 0 0 1 0 6" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              // Dragging the slider away from zero un-mutes implicitly.
              // Dragging it to zero also leaves "muted" false — the
              // explicit mute button is the only way to set it.
              if (muted && v > 0) setMuted(false);
            }}
            disabled={!playable}
            aria-label="Volume"
            title={`${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </div>

        {/* Compact jog control — DaVinci-style. Drag the disc for
            fine scrub (1s per ~80px). Arrows = single-frame step,
            mirroring the keyboard ← / → for mouse-only users. */}
        <div className="scrubber-jog">
          <button
            type="button"
            className="scrubber-jog-step"
            onClick={() => jogStep(-1)}
            disabled={!playable}
            title="Step back 1 frame (←)"
            aria-label="Step back one frame"
          >
            <svg viewBox="0 0 16 16" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4L6 8l4 4" />
            </svg>
          </button>
          <div
            ref={jogDiscRef}
            className={"scrubber-jog-track" + (jogActive ? " active" : "")}
            onMouseDown={onJogMouseDown}
            role="slider"
            aria-label="Fine scrub"
            title="Drag for fine scrub · 1s per ~80px"
          >
            <div className="scrubber-jog-disc" />
          </div>
          <button
            type="button"
            className="scrubber-jog-step"
            onClick={() => jogStep(1)}
            disabled={!playable}
            title="Step forward 1 frame (→)"
            aria-label="Step forward one frame"
          >
            <svg viewBox="0 0 16 16" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>

        <span className="scrubber-spacer" />
        <button
          className={"btn btn-secondary" + (draftIn != null ? " btn-active" : "")}
          onClick={markIn}
          disabled={!playable}
          title="Mark In at current position (I)"
        >
          Set In <span className="kbd">I</span>
        </button>
        <button
          className="btn btn-secondary"
          onClick={markOut}
          disabled={!playable || draftIn == null}
          title={draftIn == null ? "Set In first" : "Mark Out + commit segment (O)"}
        >
          Set Out <span className="kbd">O</span>
        </button>
        {(segments.length > 0 || draftIn != null) && (
          <button
            className="btn btn-ghost"
            onClick={clearAll}
            title="Clear all segments + draft"
          >
            Clear
          </button>
        )}
      </div>

      {/* Scrub bar — committed segments + draft region + playhead */}
      <div
        className="scrubber-bar"
        ref={scrubBarRef}
        onMouseDown={onScrubBarMouseDown}
        onMouseMove={(e) => {
          const bar = scrubBarRef.current;
          if (!bar || duration <= 0) return;
          const rect = bar.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setHover({ x: ratio * rect.width, time: ratio * duration });
        }}
        onMouseLeave={() => setHover(null)}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div className="scrubber-bar-track" />
        {/* Tier 1 — chapter hover highlight (YouTube-style): the chapter
            under the cursor lifts + brightens so it's clear which one
            you're pointing at. */}
        {duration > 0 && hoverChapter && (
          <div
            key={hoverChapter.idx}
            className="scrubber-bar-chapterhover"
            style={{
              left: posPct(hoverChapter.start) ?? "0%",
              width: `${Math.max(0, ((hoverChapter.end - hoverChapter.start) / duration) * 100)}%`,
            }}
          />
        )}
        {/* Tier 1 — chapter ticks. */}
        {duration > 0 &&
          chapterList.map((ch, i) => (
            <div
              key={`ck${i}`}
              className="scrubber-bar-chaptertick"
              style={{ left: posPct(ch.start_sec) ?? "0%" }}
              title={ch.title}
            />
          ))}
        {/* Tier 1 — storyboard hover thumbnail + time bubble. */}
        {hover &&
          (() => {
            const tile = storyTile(hover.time);
            const bubble = (
              <div
                className="scrubber-hover-time mono"
                style={{ left: hover.x }}
              >
                {fmtDuration(hover.time)}
                {hoverChapter && (
                  <span className="scrubber-hover-chapter">{hoverChapter.title}</span>
                )}
              </div>
            );
            if (!tile) return bubble;
            return (
              <>
                <div
                  className="scrubber-hover-thumb"
                  style={{
                    left: hover.x,
                    width: tile.tile_w,
                    height: tile.tile_h,
                    backgroundImage: `url("${tile.url}")`,
                    backgroundPosition: `${tile.bgX}px ${tile.bgY}px`,
                    backgroundSize: `${tile.sheetW}px ${tile.sheetH}px`,
                  }}
                />
                {bubble}
              </>
            );
          })()}
        {/* AE-style cache line: red = not frame-exact cached, blue = a
            prepared all-intra window covers that range. */}
        {duration > 0 && (
          <div
            className={"scrubber-cacheline" + (proxyState === "ready" ? " proxy" : "")}
          >
            {cachedWindows.map((w, i) => (
              <div
                key={i}
                className="scrubber-cacheline-seg"
                style={{
                  left: `${Math.max(0, (w.start / duration) * 100)}%`,
                  width: `${Math.max(0, ((w.end - w.start) / duration) * 100)}%`,
                }}
              />
            ))}
          </div>
        )}
        {segmentRegions.map((r) => (
          <div
            key={r.index}
            className="scrubber-bar-region"
            style={{ left: r.left, width: r.width }}
            title={`Segment ${r.index + 1}: ${fmtDuration(r.seg.inSec)} → ${fmtDuration(r.seg.outSec)}`}
          />
        ))}
        {draftRegion && (
          <div
            className="scrubber-bar-region scrubber-bar-region--draft"
            style={draftRegion}
            title="Drafting — hit O to commit"
          />
        )}
        <div className="scrubber-bar-playhead" style={{ left: currentPct }} />
        {draftIn != null && (
          <div
            className="scrubber-bar-marker scrubber-bar-marker--in"
            style={{ left: posPct(draftIn) ?? "0%" }}
          >
            <span className="scrubber-bar-marker-label mono">IN</span>
          </div>
        )}
      </div>

      {/* Tier 1 — chapters / markers pulled from YouTube. Click a row to
          jump; the + button drops the whole chapter in as a segment. */}
      {chapterList.length > 0 && (
        <div className="scrubber-chapters">
          <div className="scrubber-chapters-head mono faint">
            {chapterList.length} chapter{chapterList.length === 1 ? "" : "s"}
          </div>
          <div className="scrubber-chapters-list">
            {chapterList.map((ch, i) => (
              <div key={`cr${i}`} className="scrubber-chapter-row mono">
                <button
                  type="button"
                  className="scrubber-chapter-jump"
                  onClick={() => seekTo(ch.start_sec)}
                  title="Jump to chapter"
                >
                  <span className="faint">{fmtDuration(ch.start_sec)}</span>
                  <span className="scrubber-chapter-title">{ch.title}</span>
                </button>
                <span className="scrubber-spacer" />
                <button
                  className="ic-btn"
                  onClick={() => addChapterSegment(ch)}
                  disabled={!playable}
                  title="Add this chapter as a segment"
                  aria-label="Add chapter as segment"
                >
                  <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Segments list + summary */}
      <div className="scrubber-segments">
        {markWarning && <div className="scrubber-warn mono">{markWarning}</div>}
        {draftIn != null && (
          <div className="scrubber-segment-row scrubber-segment-row--draft mono">
            <span className="idx">draft</span>
            <span>
              <span className="label">in</span> {fmtDuration(draftIn)}
            </span>
            <span className="faint">scrub then hit <span className="kbd">O</span> to commit</span>
            <span className="scrubber-spacer" />
            <button
              className="ic-btn"
              onClick={clearDraft}
              title="Cancel draft"
            >
              <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
        {segments.length === 0 && draftIn == null && (
          <div className="scrubber-segment-empty mono faint">
            No segments marked — Download will grab the full video. Hit{" "}
            <span className="kbd">I</span> to start marking.
          </div>
        )}
        {segments.map((seg, i) => (
          <div key={i} className="scrubber-segment-row mono">
            <span className="idx">#{i + 1}</span>
            <button
              type="button"
              className="scrubber-segment-times"
              onClick={() => seekTo(seg.inSec)}
              title="Seek to this segment's In"
            >
              {fmtDuration(seg.inSec)} → {fmtDuration(seg.outSec)}
              <span className="faint">  ({fmtDuration(seg.outSec - seg.inSec)})</span>
            </button>
            <span className="scrubber-spacer" />
            <button
              className="ic-btn"
              onClick={() => removeSegment(i)}
              title="Remove segment"
            >
              <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Keyboard hint footer */}
      <div className="scrubber-summary mono">
        <span className="faint">
          <span className="kbd">Space</span> play ·{" "}
          <span className="kbd">←</span>
          <span className="kbd">→</span> frame ·{" "}
          <span className="kbd">⇧</span>+arrows = 1s ·{" "}
          <span className="kbd">I</span>
          <span className="kbd">O</span> mark segment (multi: hit I again after O)
        </span>
      </div>
    </div>
  );
}
