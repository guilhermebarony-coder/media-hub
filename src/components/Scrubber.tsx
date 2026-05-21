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
import { invoke } from "@tauri-apps/api/core";
import { fmtDuration } from "../lib/format";

type StreamUrl = { url: string; has_audio: boolean };

type ScrubberProps = {
  /** The original YouTube URL — used to resolve the direct stream. */
  sourceUrl: string;
  /** Total duration in seconds (from metadata fetch). Optional — we
   *  also read video.duration once the element loads metadata. */
  durationHint: number | null;
  /** FPS hint for frame-step granularity. Falls back to 30. */
  fpsHint: number | null;
  /** Current In/Out markers, in seconds. null = unset. */
  inSec: number | null;
  outSec: number | null;
  /** Callbacks fired when user marks (I/O keys, Set In/Out buttons,
   *  or drags markers on the scrub bar). */
  onInChange: (sec: number | null) => void;
  onOutChange: (sec: number | null) => void;
};

export function Scrubber(props: ScrubberProps) {
  const { sourceUrl, durationHint, fpsHint, inSec, outSec, onInChange, onOutChange } =
    props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // The HTML5 element reports playback state through events; we
  // mirror it into React state so the UI reflects it.
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Element's own duration takes precedence once it loads. We
  // fall back to the hint while waiting.
  const [duration, setDuration] = useState<number>(durationHint ?? 0);
  const [videoErr, setVideoErr] = useState<string | null>(null);

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
    if (!sourceUrl.trim()) return;
    setResolving(true);
    invoke<StreamUrl>("yt_resolve_stream_url", { url: sourceUrl })
      .then((res) => setStreamUrl(res.url))
      .catch((e) => setStreamErr(String(e)))
      .finally(() => setResolving(false));
  }, [sourceUrl, durationHint]);

  // Wire <video> events to React state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoaded = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
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
  }, [streamUrl]);

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
    if (!streamUrl) return;
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
        onInChange(v.currentTime);
      } else if (e.code === "KeyO") {
        e.preventDefault();
        onOutChange(v.currentTime);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [streamUrl, frameSec, duration, onInChange, onOutChange]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
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

  const currentPct = posPct(currentTime) ?? "0%";
  const inPct = posPct(inSec);
  const outPct = posPct(outSec);

  // Region between In and Out — only when both are set and ordered.
  const regionStyle =
    inSec != null && outSec != null && outSec > inSec
      ? {
          left: posPct(inSec) ?? "0%",
          width: `${Math.max(0, ((outSec - inSec) / duration) * 100)}%`,
        }
      : null;

  return (
    <div className="scrubber">
      {/* Player */}
      <div className="scrubber-player">
        {streamUrl ? (
          <video
            ref={videoRef}
            src={streamUrl}
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
          disabled={!streamUrl}
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
        <span className="scrubber-spacer" />
        <button
          className="btn btn-secondary"
          onClick={() => onInChange(videoRef.current?.currentTime ?? null)}
          disabled={!streamUrl}
          title="Mark In at current position (I)"
        >
          Set In <span className="kbd">I</span>
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => onOutChange(videoRef.current?.currentTime ?? null)}
          disabled={!streamUrl}
          title="Mark Out at current position (O)"
        >
          Set Out <span className="kbd">O</span>
        </button>
        {(inSec != null || outSec != null) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              onInChange(null);
              onOutChange(null);
            }}
            title="Clear In/Out markers"
          >
            Clear
          </button>
        )}
      </div>

      {/* Scrub bar */}
      <div
        className="scrubber-bar"
        ref={scrubBarRef}
        onMouseDown={onScrubBarMouseDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div className="scrubber-bar-track" />
        {regionStyle && <div className="scrubber-bar-region" style={regionStyle} />}
        <div className="scrubber-bar-playhead" style={{ left: currentPct }} />
        {inPct && (
          <div className="scrubber-bar-marker scrubber-bar-marker--in" style={{ left: inPct }}>
            <span className="scrubber-bar-marker-label mono">IN</span>
          </div>
        )}
        {outPct && (
          <div className="scrubber-bar-marker scrubber-bar-marker--out" style={{ left: outPct }}>
            <span className="scrubber-bar-marker-label mono">OUT</span>
          </div>
        )}
      </div>

      {/* In/Out summary */}
      <div className="scrubber-summary mono">
        <span>
          <span className="label">in</span> {inSec != null ? fmtDuration(inSec) : "—"}
        </span>
        <span>
          <span className="label">out</span> {outSec != null ? fmtDuration(outSec) : "—"}
        </span>
        <span>
          <span className="label">dur</span>{" "}
          {inSec != null && outSec != null && outSec > inSec
            ? fmtDuration(outSec - inSec)
            : "—"}
        </span>
        <span className="scrubber-spacer" />
        <span className="faint">
          <span className="kbd">Space</span> play ·{" "}
          <span className="kbd">←</span>
          <span className="kbd">→</span> frame ·{" "}
          <span className="kbd">⇧</span>+arrows = 1s ·{" "}
          <span className="kbd">I</span>
          <span className="kbd">O</span> mark
        </span>
      </div>
    </div>
  );
}
