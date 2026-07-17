import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../lib/icons";
import {
  fmtBytes,
  fmtDuration,
  fmtEta,
  fmtUploadDate,
  parseTimestamp,
} from "../lib/format";
import { revealFile } from "../lib/library";
import { useActiveProject } from "../lib/activeProject";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import {
  detectPlatform,
  isDirectMediaUrl,
  isLikelyVideoUrl,
  isUndownloadablePreviewUrl,
} from "../lib/platforms";
import {
  useDownloads,
  type QueueJob,
  type QueueStatus,
  type AudioFormat,
} from "../lib/downloads";
import { Scrubber } from "../components/Scrubber";
import type {
  DuplicateMatch,
  FormatOption,
  Segment,
  TranscodePreset,
  VideoMetadata,
} from "../lib/types";
import { TRANSCODE_PRESETS } from "../lib/types";

// 1.1 — cross-card event for handing playlist entries to the queue.
// MetadataCard's playlist picker dispatches; QueueCard listens and
// appends jobs. Window event = zero plumbing through component
// boundaries, no shared state to keep in sync. Both lifecycles
// (mount/unmount) are tied to the Download page so no leak risk.
const QUEUE_ENQUEUE_EVENT = "mh:queue:enqueue";
type QueueEnqueueDetail = {
  urls: string[];
  /** Project to capture for each enqueued job. Snapshotted at enqueue
   *  time (same rule as the textarea path) — switching scope mid-batch
   *  doesn't reroute jobs already in the queue. */
  projectId: string | null;
  /** Cosmetic only — labels the toast/log if we add one. */
  source?: string;
};

// 1.1.3 — SINGLE_URL_JOB_ID lives in lib/downloads.tsx now. This file
// no longer needs to reference it directly (cancel goes through the
// context's cancelSingleDownload, progress is filtered there too).

// =====================================================================
// Page wrapper
// =====================================================================
export default function DownloadPage() {
  const { scope } = useActiveProject();
  const t = useT();
  const target =
    scope.kind === "library" ? t("topbar.library") : `${t("dl.projectPrefix")}${scope.name}`;
  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">{t("dl.title")}</div>
        <span className="ch-meta">
          {t("dl.savingTo")} <strong style={{ color: "var(--text-0)" }}>{target}</strong>
        </span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          {t("dl.scopeHint")}
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
 * Pick the "best" format from a metadata response for auto-selection.
 *
 * Heuristic, in priority order:
 *   1. Highest-resolution format that has video. Video-only formats
 *      are fine because composeFormatSpec() auto-promotes them to
 *      `<id>+bestaudio` so yt-dlp muxes audio in. The user effectively
 *      gets "best video + best audio" with a single Download click.
 *   2. If multiple formats tie on resolution, prefer `mp4` ext
 *      (broadest NLE compatibility), then higher filesize_bytes
 *      (better bitrate at the same resolution).
 *   3. Fall back to the largest audio-only format (when the URL is
 *      audio-only, e.g. a Twitter audio clip).
 *
 * Returns null only when the format list is empty.
 */
function pickBestFormat(formats: FormatOption[]): FormatOption | null {
  if (formats.length === 0) return null;
  const score = (f: FormatOption): number => {
    // Strongly prefer formats with video. Audio-only fallbacks rank
    // way below any video format.
    if (!f.has_video) return (f.filesize_bytes ?? 0) / 1_000_000_000; // tiny tiebreaker
    const res = (f.width ?? 0) * (f.height ?? 0);
    // mp4 nudges ahead of webm at the same resolution.
    const containerBonus = f.ext === "mp4" ? 1 : 0;
    // Filesize is a useful tiebreaker for "same res but different bitrate"
    // — bigger usually means better bitrate.
    const sizeNudge = (f.filesize_bytes ?? 0) / 1_000_000_000;
    return res * 10 + containerBonus + sizeNudge;
  };
  return formats.reduce<FormatOption | null>((best, f) => {
    if (best == null) return f;
    return score(f) > score(best) ? f : best;
  }, null);
}

// 1.3.x — `isLikelyVideoUrl` and `detectPlatform` moved to lib/platforms.ts
// so the download orchestrator can stamp each library row with the
// correct source instead of hardcoding "youtube". See that module for
// the actual logic + the registry of supported hosts.

/**
 * 1.1 — Classify a YouTube URL by what the user probably meant.
 *
 * Critical UX rule: a `/watch?v=X&list=Y` URL means "I clicked a video
 * that happens to be in a playlist." The user almost always wants just
 * X. We treat it as `watch_with_list` so the default flow is single-
 * video, but we surface a chip ("expand to playlist of N videos?") so
 * the user can opt in when they actually want the whole list.
 *
 * `/playlist?list=Y` means "I clicked through to the playlist page" —
 * here the playlist IS the intent, so we default to picker mode.
 *
 * Channel URLs (`/@channel/videos`, `/c/.../videos`, `/channel/.../videos`)
 * are effectively unbounded; refuse with a helpful message rather than
 * accidentally enumerating thousands of videos.
 */
// 1.1 — shapes returned by the Rust yt_fetch_playlist command.
type PlaylistEntry = {
  id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail: string | null;
  url: string;
  unavailable: boolean;
};
type PlaylistInfo = {
  id: string;
  title: string;
  uploader: string | null;
  entry_count: number;
  entries: PlaylistEntry[];
  truncated: boolean;
};

type YouTubeUrlKind =
  | "single"           // /watch?v=X, /shorts/X, youtu.be/X — no list param
  | "watch_with_list"  // /watch?v=X&list=Y — single by default, expandable
  | "pure_playlist"    // /playlist?list=Y — picker by default
  | "channel"          // unbounded, refuse
  | "unknown";         // not a recognizable YT URL

function classifyYouTubeUrl(url: string): YouTubeUrlKind {
  const t = url.trim();
  if (!t) return "unknown";
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return "unknown";
  }
  const host = u.hostname.toLowerCase();
  if (
    !host.endsWith("youtube.com") &&
    !host.endsWith("youtu.be") &&
    !host.endsWith("youtube-nocookie.com")
  ) {
    return "unknown";
  }
  const path = u.pathname.toLowerCase();
  const params = u.searchParams;

  // Channel: /@handle/videos, /c/Name/videos, /channel/UC.../videos,
  // /user/Name/videos. Also bare channel home URLs.
  if (
    /^\/@[^/]+(\/|$)/.test(path) ||
    /^\/c\/[^/]+/.test(path) ||
    /^\/channel\/[^/]+/.test(path) ||
    /^\/user\/[^/]+/.test(path)
  ) {
    return "channel";
  }

  if (path === "/playlist" && params.has("list")) {
    return "pure_playlist";
  }

  if (path === "/watch" && params.has("v")) {
    return params.has("list") ? "watch_with_list" : "single";
  }

  // youtu.be/ID
  if (host.endsWith("youtu.be") && /^\/[A-Za-z0-9_-]{6,}$/.test(path)) {
    return params.has("list") ? "watch_with_list" : "single";
  }

  // /shorts/ID
  if (/^\/shorts\/[A-Za-z0-9_-]+/.test(path)) {
    return "single";
  }

  return "unknown";
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

/** 1.2.0 — Audio format card metadata. Server-side bitrate defaults
 *  (see lib.rs yt_download audio mode); displayed here purely for the
 *  user's workflow decision ("which app/device am I feeding?"). */
const AUDIO_FORMAT_META: Record<AudioFormat, { hint: string; specs: string }> = {
  mp3: { hint: "Universal compatibility", specs: "320 kbps CBR" },
  m4a: { hint: "Apple ecosystem friendly", specs: "AAC 256 kbps" },
  flac: { hint: "Lossless archival", specs: "lossless · larger files" },
};

function MetadataCard() {
  const { scope } = useActiveProject();
  const { settings, save: saveSettings } = useSettings();
  const t = useT();
  const overrideLibrary = useLibraryOverride();
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");

  // Auto-focus the URL input when the Download page mounts (0.9 UX
  // win #3). The most common reason to navigate here is "I want to
  // paste a URL" — landing with focus already in the input means the
  // user can paste immediately (Ctrl+V → URL → Fetch) without
  // needing a click. No-op on subsequent re-renders.
  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  // Track URLs we've already auto-fetched so the same URL doesn't
  // re-fire (e.g. user pastes → auto-fetches → edits something else
  // → reverts to the original URL). Also acts as the "manual Fetch
  // already happened" memory.
  const autoFetchedUrlRef = useRef<string>("");

  const [meta, setMeta] = useState<VideoMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Show the format table by default (0.9 UX win #8). Combined with
  // the auto-best-pick (#2), users land on Download with a sensible
  // default selected AND visible — overriding is one row click away
  // instead of one toggle + one row click.
  const [showFormats, setShowFormats] = useState(true);
  // If we already have this URL in the library, show a yellow chip
  // so the user knows they're about to re-download. We don't BLOCK —
  // sometimes you want a different quality / segment / transcode.
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);

  const [selectedFormat, setSelectedFormat] = useState<FormatOption | null>(null);
  // 1.2.0 — Video | Audio mode tabs. Audio mode swaps the format
  // picker for three big buttons (MP3 / M4A / FLAC), forces
  // transcode preset to "none" (irrelevant for audio), and skips
  // pickedFormat entirely on submit (Rust picks bestaudio).
  const [downloadMode, setDownloadMode] = useState<"video" | "audio">("video");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");
  // 1.1.3 — downloading/dlErr/dlResult/progress/transcodeProgress/phase/
  // downloadedPaths now live in DownloadsContext (see useDownloads()
  // call below). (The old `submitting` double-click gate is gone —
  // 1.12.x enqueues synchronously, so there's no async tick to guard.)
  // 0.6.1: list of segments to trim from the single source download.
  // Empty = full video. N = N independent clip files on disk after
  // ffmpeg trims. The scrubber drives this entirely.
  const [segments, setSegments] = useState<Segment[]>([]);
  // 1.1 — playlist mode state. `kind` mirrors what classifyYouTubeUrl
  // returned for the current URL; `playlist` is the enumeration result
  // when we've fetched one; `playlistLoading` covers the spinner.
  // null kind means we haven't classified yet (empty input).
  const [urlKind, setUrlKind] = useState<YouTubeUrlKind | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistErr, setPlaylistErr] = useState<string | null>(null);
  // Manual text-entry mode — when the scrubber's stream fails (age-
  // gated, region-locked, etc.) or the user wants exact-second
  // precision. Currently single-segment only; for multi-segment
  // users should rely on the scrubber. Worth-its-keep fallback.
  const [manualMode, setManualMode] = useState(false);
  const [inStr, setInStr] = useState("");
  const [outStr, setOutStr] = useState("");
  // 1.1.3 — downloadedPaths now lives in singleDownload.
  // Client-side validation errors (bad timestamps, etc.) shown before
  // a download even starts. Cleared on next attempt or URL change.
  // These never reach the provider — they're purely form errors.
  const [validationErr, setValidationErr] = useState<string | null>(null);

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
  // 1.1.3 — single-URL download state moved to DownloadsContext so it
  // survives route navigation. Local names below are projections off
  // singleDownload for render compatibility; setters are gone (the
  // download() function calls into the provider's startSingleDownload
  // and the provider drives the state from there).
  const {
    singleDownload,
    enqueueSingleSpec,
    startDirectDownload,
    cancelSingleDownload,
    resetSingleDownload,
  } = useDownloads();
  // 1.12.x — brief "added to queue" confirmation after the Download
  // button hands the job to the queue (which is now instant).
  const [queuedFlash, setQueuedFlash] = useState(false);
  const queuedFlashTimer = useRef<number | null>(null);
  const progress = singleDownload?.progress ?? null;
  const transcodeProgress = singleDownload?.transcodeProgress ?? null;
  const phase: "idle" | "downloading" | "transcoding" =
    singleDownload?.phase ?? "idle";
  // Combine form-side validation errors with download errors so the
  // existing single error-row UI keeps working without a second render
  // branch. Validation errors take precedence (they're newer).
  const dlErr = validationErr ?? singleDownload?.error ?? null;
  const dlResult = singleDownload?.result ?? null;
  const downloadedPaths = singleDownload?.downloadedPaths ?? [];
  // `downloading` now only reflects the direct-download fallback (the
  // regular card download enqueues into the queue and never blocks).
  const downloading = phase !== "idle";

  // 1.1 — keep urlKind in sync with the input. Classification is
  // cheap (regex + URL parse), no debounce needed. Cleared playlist
  // state when the URL changes so a stale picker doesn't leak across
  // pastes. We don't auto-clear `meta` here — that's the metadata
  // fetch's job, and clearing it eagerly would flicker the existing
  // card off-screen as the user types in the next URL.
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlKind(null);
      setPlaylist(null);
      setPlaylistErr(null);
      return;
    }
    const kind = classifyYouTubeUrl(trimmed);
    setUrlKind(kind);
    // When user starts typing a new URL, drop any previous playlist
    // enumeration. Auto-fetch below will refresh if needed.
    setPlaylist(null);
    setPlaylistErr(null);
  }, [url]);

  // Auto-fetch on paste (0.9 UX win #5 + 1.1 playlist routing). When
  // the URL input changes and looks like something we can act on, fire
  // the appropriate fetch after a 350ms debounce:
  //   - "single" / "watch_with_list" / unknown-but-video → metadata
  //   - "pure_playlist" → playlist enumeration (picker mode)
  //   - "channel" → no auto-fetch; the UI shows a refusal chip instead
  //
  // The watch_with_list case still defaults to single-video metadata
  // (user-intent rule: clicking a video in a playlist context usually
  // means "I want this one video"). The "expand to playlist of N"
  // chip is the explicit opt-in.
  //
  // Skips when:
  //   - already loading (avoid concurrent fetches)
  //   - same URL we already auto-fetched (no re-fire on edit-and-revert)
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (loading || playlistLoading) return;
    if (autoFetchedUrlRef.current === trimmed) return;
    const kind = urlKind ?? classifyYouTubeUrl(trimmed);
    // Channel URLs never auto-fetch — the inline refusal chip is the
    // entire UX. Unknown URLs that don't even pattern-match a video
    // shape (e.g. partial paste) also skip.
    if (kind === "channel") return;
    if (kind === "unknown" && !isLikelyVideoUrl(trimmed)) return;
    const handle = setTimeout(() => {
      autoFetchedUrlRef.current = trimmed;
      if (kind === "pure_playlist") {
        void fetchPlaylist();
      } else {
        void fetchMetadata();
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, urlKind]);

  async function fetchMetadata(e?: FormEvent) {
    e?.preventDefault();
    if (!url.trim()) return;
    // Track manual fetches in the same ref so the auto-fetch effect
    // won't re-fire after a manual click on the same URL.
    autoFetchedUrlRef.current = url.trim();
    // 1.3.x — Pinterest's lightbox right-click hands the user a
    // `blob:https://…` URL that only exists inside the originating
    // tab. yt-dlp can't fetch those. Catch it up-front with a
    // useful message so users know to grab the real pin URL.
    if (isUndownloadablePreviewUrl(url)) {
      setErr(
        "That looks like a preview URL from an in-page lightbox " +
          "(Pinterest, X, etc.). Open the post in its own tab and " +
          "copy the URL from the address bar instead.",
      );
      return;
    }
    setLoading(true);
    setErr(null);
    setMeta(null);
    setShowFormats(true);
    setSelectedFormat(null);
    // 1.1.3 — clear any prior single-URL download result so the success
    // panel from the previous download doesn't linger when fetching
    // metadata for a new URL.
    resetSingleDownload();
    setDuplicate(null);
    setSegments([]);
    setInStr("");
    setOutStr("");
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
      // Format auto-selection priority (0.9 UX win):
      //   1. Sticky format for this platform (0.8.C — user's last pick)
      //   2. Best-available pick from the new metadata (fallback)
      //
      // The fallback means a returning-user-on-a-new-platform OR a
      // first-time download both get a sensible pre-selection, so the
      // most common path (paste URL → click Download) skips the
      // "but wait, which format?" step entirely. User can still click
      // the format table to override.
      const platform = detectPlatform(url);
      const stickyId = settings.last_formats?.[platform];
      const sticky = stickyId
        ? out.formats.find((f) => f.id === stickyId) ?? null
        : null;
      const auto = sticky ?? pickBestFormat(out.formats);
      if (auto) setSelectedFormat(auto);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // 1.1 — fetch playlist entries. Triggered both by the auto-fetch
  // effect (when the URL is a pure_playlist) and by the
  // "expand to playlist" chip on watch_with_list URLs. Independent of
  // fetchMetadata — they can co-exist when the user is on a
  // watch+list URL and explicitly expanded.
  async function fetchPlaylist() {
    if (!url.trim()) return;
    autoFetchedUrlRef.current = url.trim();
    setPlaylistLoading(true);
    setPlaylistErr(null);
    setPlaylist(null);
    try {
      const out = await invoke<PlaylistInfo>("yt_fetch_playlist", { url });
      setPlaylist(out);
    } catch (e) {
      setPlaylistErr(String(e));
    } finally {
      setPlaylistLoading(false);
    }
  }

  // 1.1 — enqueue handler called from the playlist picker. Dispatches
  // a window event the queue listens for; snapshot the active project
  // scope here so the jobs route the same way the textarea path does.
  function enqueuePlaylistEntries(entries: PlaylistEntry[]) {
    if (entries.length === 0) return;
    const projectId =
      !overrideLibrary && scope.kind === "project" ? scope.id : null;
    const detail: QueueEnqueueDetail = {
      urls: entries.map((e) => e.url),
      projectId,
      source: playlist?.title,
    };
    window.dispatchEvent(
      new CustomEvent<QueueEnqueueDetail>(QUEUE_ENQUEUE_EVENT, { detail }),
    );
  }

  // Compose `-f` spec — video-only picks auto-promote to <id>+bestaudio
  // with container hygiene (MP4 → MP4, WebM → WebM, else MKV).
  //
  // 1.13.1 — the fallback chain must NEVER degrade to bare `bestaudio`:
  // on Pinterest (HLS) the audio tracks are ext=mp4, so
  // `<id>+bestaudio[ext=m4a]` matched nothing, the whole first
  // alternative failed, and yt-dlp fell through to `bestaudio` —
  // silently downloading an AUDIO-ONLY file for a video pick (which
  // then broke transcode with "Stream map 0:v:0 matches no streams").
  // Correct degradation: exact audio container → any audio → the video
  // alone (silent) → best. The user's chosen VIDEO stays in every
  // alternative except the final catch-all.
  function composeFormatSpec(f: FormatOption): { spec: string; mergeContainer: string | null } {
    if (!f.has_video || f.has_audio) return { spec: f.id, mergeContainer: null };
    if (f.ext === "mp4")
      return { spec: `${f.id}+bestaudio[ext=m4a]/${f.id}+bestaudio/${f.id}/best`, mergeContainer: "mp4" };
    if (f.ext === "webm")
      return { spec: `${f.id}+bestaudio[ext=webm]/${f.id}+bestaudio/${f.id}/best`, mergeContainer: "webm" };
    return { spec: `${f.id}+bestaudio/${f.id}/best`, mergeContainer: "mkv" };
  }

  async function download() {
    if (!url.trim() || !meta) return;
    // 1.2.0 — video mode requires a picked format; audio mode picks
    // "bestaudio/best" server-side and ignores the table.
    if (downloadMode === "video" && !selectedFormat) return;
    setValidationErr(null);
    const { spec, mergeContainer } =
      downloadMode === "audio"
        ? { spec: "bestaudio/best", mergeContainer: null as string | null }
        : composeFormatSpec(selectedFormat!);

    // Resolve effective segment list. Manual mode wins when on (single
    // segment). Otherwise the scrubber's committed list is the source
    // of truth. Empty list = full-video download.
    let effectiveSegments: Segment[] = segments;
    if (manualMode) {
      const i = parseTimestamp(inStr);
      const o = parseTimestamp(outStr);
      if (inStr.trim() !== "" && i == null) {
        setValidationErr(`Invalid In timestamp: "${inStr}"`);
        return;
      }
      if (outStr.trim() !== "" && o == null) {
        setValidationErr(`Invalid Out timestamp: "${outStr}"`);
        return;
      }
      if ((i == null) !== (o == null)) {
        setValidationErr("Specify both In and Out, or neither (for full video)");
        return;
      }
      effectiveSegments = i != null && o != null ? [{ inSec: i, outSec: o }] : [];
    }

    // Per-segment validation: in < out, out within duration if known.
    for (const seg of effectiveSegments) {
      if (seg.outSec <= seg.inSec) {
        setValidationErr(
          `Invalid segment: Out (${seg.outSec.toFixed(1)}s) must be after In (${seg.inSec.toFixed(1)}s)`,
        );
        return;
      }
      if (meta.duration_sec != null && seg.outSec > meta.duration_sec) {
        setValidationErr(
          `Segment Out (${seg.outSec.toFixed(1)}s) exceeds video duration (${Math.floor(meta.duration_sec)}s)`,
        );
        return;
      }
    }

    const bytesHint = selectedFormat?.filesize_bytes ?? null;
    const targetProjectId =
      !overrideLibrary && scope.kind === "project" ? scope.id : null;

    // 0.8.C: remember this format pick for the platform. Fire-and-forget.
    // Audio mode doesn't pick a video format so nothing to persist;
    // the audio container choice is local UI state (user re-picks per
    // download since it's a workflow decision, not a quality default).
    if (downloadMode === "video" && selectedFormat) {
      const platform = detectPlatform(url);
      const fmtId = selectedFormat.id;
      void saveSettings((s) => ({
        ...s,
        last_formats: { ...(s.last_formats ?? {}), [platform]: fmtId },
      })).catch(() => {});
    }

    // 1.12.x — hand the fully-specified job to the QUEUE instead of the
    // blocking single-URL runner. Enqueue is synchronous: the card frees
    // immediately, so the user can fetch/download the next URL while
    // this one runs in the queue panel below (progress renders there).
    enqueueSingleSpec({
      url,
      formatSpec: spec,
      mergeContainer,
      // In audio mode we don't know exact bytes (yt-dlp picks "best"
      // and the post-extract converts container) — the progress bar
      // shows live-bytes without percent until done. Fine for audio.
      totalBytesHint: downloadMode === "audio" ? null : bytesHint,
      videoId: meta.id ?? "",
      segments: effectiveSegments.length > 0 ? effectiveSegments : null,
      projectId: targetProjectId,
      transcodePreset,
      meta,
      pickedFormat: downloadMode === "audio" ? null : selectedFormat,
      audioFormat: downloadMode === "audio" ? audioFormat : null,
    });
    if (queuedFlashTimer.current != null) window.clearTimeout(queuedFlashTimer.current);
    setQueuedFlash(true);
    queuedFlashTimer.current = window.setTimeout(() => setQueuedFlash(false), 2600);
  }

  // 1.1.3 — delegated to context. Keeping the wrapper so the cancel
  // button's onClick stays a stable, named function (cheap readability).
  async function cancelSingleUrlDownload() {
    await cancelSingleDownload();
  }

  const videoFormats = meta?.formats.filter((f) => f.has_video) ?? [];
  const audioOnly = meta?.formats.filter((f) => !f.has_video && f.has_audio) ?? [];

  return (
    <section className="card-box">
      <h2>
        {t("dl.sec.title")} <span className="chip">{t("dl.sec.chip")}</span>
      </h2>
      <p className="hint">{t("dl.sec.intro")}</p>

      <form
        className="field"
        onSubmit={(e) => {
          // 1.1 — submit routes by URL kind so the user's intent
          // (single video vs whole playlist) doesn't get crossed.
          e.preventDefault();
          if (urlKind === "pure_playlist") void fetchPlaylist();
          else void fetchMetadata();
        }}
      >
        <input
          ref={urlInputRef}
          className="field-input"
          type="text"
          placeholder={t("dl.urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn"
          disabled={loading || playlistLoading || !url.trim() || urlKind === "channel"}
        >
          {loading || playlistLoading
            ? t("dl.fetching")
            : urlKind === "pure_playlist"
              ? t("dl.listPlaylist")
              : t("dl.fetch")}
        </button>
      </form>

      {/* 1.1 — channel-URL refusal. Surfaced inline rather than as an
          error after a yt-dlp call because channels are unbounded and
          we don't want to even try. */}
      {urlKind === "channel" && (
        <div className="msg-row err">
          <span className="label">channel URL</span>
          <span style={{ flex: 1 }}>
            Channel URLs aren't supported — they can have thousands of
            videos. Paste a specific video URL, a <code>/playlist?list=…</code>{" "}
            URL, or queue specific URLs in the batch panel below.
          </span>
        </div>
      )}

      {/* 1.1 — "expand to playlist" chip for watch?v=…&list=… URLs.
          Defaults to single-video mode (the user's likely intent
          when clicking a video in a playlist context). One-click
          escape hatch when they actually want the whole playlist. */}
      {urlKind === "watch_with_list" && !playlist && !playlistLoading && (
        <div className="msg-row" style={{ background: "var(--bg-2)" }}>
          <span className="label">playlist</span>
          <span style={{ flex: 1 }}>{t("dl.playlistNote")}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void fetchPlaylist()}
            disabled={playlistLoading}
          >
            {t("dl.seeAllPlaylist")}
          </button>
        </div>
      )}

      {playlistLoading && (
        <div className="msg-row" style={{ background: "var(--bg-2)" }}>
          <span className="label">loading</span>
          <span style={{ flex: 1 }}>{t("dl.enumerating")}</span>
        </div>
      )}

      {playlistErr && (
        <div className="msg-row err">
          <span className="label">playlist error</span>
          <code style={{ flex: 1 }}>{playlistErr}</code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void fetchPlaylist()}
          >
            <Icon.retry width={11} height={11} /> Retry
          </button>
        </div>
      )}

      {playlist && (
        <PlaylistPicker
          playlist={playlist}
          onEnqueue={(entries) => {
            enqueuePlaylistEntries(entries);
            // After enqueuing, dismiss the picker so the user can
            // see / track the queue. The URL stays in the input in
            // case they want to re-pick a different subset.
            setPlaylist(null);
          }}
          onDismiss={() => setPlaylist(null)}
        />
      )}

      {err && (
        <div className="msg-row err">
          <span className="label">error</span>
          <code style={{ flex: 1 }}>{err}</code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              // Bypass the auto-fetch dedup so a retry on the same URL
              // actually re-fires (otherwise lastFetchedUrl would match).
              autoFetchedUrlRef.current = "";
              void fetchMetadata();
            }}
            disabled={loading}
          >
            <Icon.retry width={11} height={11} /> Retry
          </button>
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

          {/* 1.2.0 — Video | Audio mode tabs. Audio swaps the format
              picker for three big format buttons and silences the
              transcode row. */}
          <div className="dl-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={downloadMode === "video"}
              className={"dl-mode-tab" + (downloadMode === "video" ? " active" : "")}
              onClick={() => setDownloadMode("video")}
            >
              <Icon.video width={12} height={12} />
              {t("dl.video")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={downloadMode === "audio"}
              className={"dl-mode-tab" + (downloadMode === "audio" ? " active" : "")}
              onClick={() => setDownloadMode("audio")}
            >
              <Icon.music width={12} height={12} />
              {t("dl.audio")}
            </button>
          </div>

          {downloadMode === "video" && (
            <button className="meta-toggle" onClick={() => setShowFormats((s) => !s)}>
              {showFormats ? "▾" : "▸"} {showFormats ? t("dl.hide") : t("dl.show")} {t("dl.formatList")} ({meta.formats.length})
            </button>
          )}

          {duplicate && (
            <div className="msg-row dupe">
              <span className="label">{t("dl.dupeLabel")}</span>
              <code style={{ flex: 1 }}>
                "{duplicate.title}" — <strong>{duplicate.scope_label}</strong>
              </code>
              <button
                className="btn btn-secondary"
                onClick={() => revealFile(duplicate.file_path)}
              >
                <Icon.folder width={11} height={11} /> {t("dl.openExisting")}
              </button>
            </div>
          )}

          {downloadMode === "audio" && (
            <div className="dl-audio-formats">
              {(["mp3", "m4a", "flac"] as const).map((fmt) => {
                const fmtMeta = AUDIO_FORMAT_META[fmt];
                const sel = audioFormat === fmt;
                return (
                  <button
                    key={fmt}
                    type="button"
                    className={"dl-audio-card" + (sel ? " active" : "")}
                    onClick={() => setAudioFormat(fmt)}
                  >
                    <div className="dl-audio-name mono">{fmt.toUpperCase()}</div>
                    <div className="dl-audio-hint">{fmtMeta.hint}</div>
                    <div className="dl-audio-meta faint">{fmtMeta.specs}</div>
                  </button>
                );
              })}
            </div>
          )}

          {downloadMode === "video" && showFormats && (
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
            videoId={meta.id}
            formats={meta.formats}
            durationHint={meta.duration_sec}
            fpsHint={selectedFormat?.fps ?? null}
            storyboard={meta.storyboard}
            chapters={meta.chapters}
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

          {/* Transcode row hidden in audio mode — NLE intermediates
              don't apply. Could grow audio-specific presets later
              (normalize to -14 LUFS, convert to WAV, etc.). */}
          {downloadMode === "video" && (
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
          )}

          <div className="dlbar">
            <div className="dlbar-info">
              {downloadMode === "audio" ? (
                <>
                  <span className="label">audio</span>
                  <code>bestaudio → .{audioFormat}</code>
                  <span className="hint-chip">{AUDIO_FORMAT_META[audioFormat].specs}</span>
                  <span className="dlbar-dest">
                    →{" "}
                    {overrideLibrary
                      ? "Library (override)"
                      : scope.kind === "project"
                        ? `Projects/${scope.name}/`
                        : "Library/"}
                  </span>
                </>
              ) : selectedFormat ? (
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
                  {t("dl.clickFormat")}{" "}
                  <span className="mono">{t("dl.holdCtrl")}</span>
                </span>
              )}
            </div>
            <button
              className={"btn" + (overrideLibrary ? " btn-override" : "")}
              onClick={download}
              disabled={(downloadMode === "video" && !selectedFormat) || downloading}
              title={overrideLibrary ? "Send to Library (Ctrl held)" : undefined}
            >
              <Icon.download width={13} height={13} />
              {downloading
                ? t("dl.downloading")
                : downloadMode === "audio"
                  ? overrideLibrary
                    ? `${t("dl.download")} ${audioFormat.toUpperCase()} → ${t("topbar.library")}`
                    : `${t("dl.download")} ${audioFormat.toUpperCase()}`
                  : overrideLibrary
                    ? segments.length > 1
                      ? `${t("dl.download")} ${segments.length} → ${t("topbar.library")}`
                      : `${t("dl.download")} → ${t("topbar.library")}`
                    : segments.length > 1
                      ? `${t("dl.download")} ${segments.length} ${t("dl.segmentsWord")}`
                      : t("dl.download")}
            </button>
            {/* 1.12.x — download now enqueues instead of blocking; this
                transient chip points the user at the queue below. */}
            {queuedFlash && (
              <span className="dl-queued-flash mono" role="status">
                ✓ {t("dl.queuedFlash")}
              </span>
            )}
          </div>

          {/* 1.3.x — Direct-download fallback. Shows whenever yt-dlp
              came back with zero usable formats AND the URL itself
              looks like a direct media file. Bypasses yt-dlp,
              streams the bytes via HTTP with platform-aware Referer
              (Pinterest CDN etc.). Same progress channel, lands in
              the same scope as a normal download. */}
          {meta != null &&
            meta.formats.length === 0 &&
            isDirectMediaUrl(url) &&
            !downloading && (
              <div className="dlbar dlbar-fallback">
                <div className="dlbar-summary">
                  <span className="hint-chip">no formats — using direct HTTP</span>
                  <span className="faint mono">
                    yt-dlp couldn't enumerate this URL, but it ends in a media
                    extension so we can stream it directly. No metadata or
                    transcode — just the file.
                  </span>
                </div>
                <button
                  className={"btn" + (overrideLibrary ? " btn-override" : "")}
                  onClick={() =>
                    void startDirectDownload({
                      url: url.trim(),
                      // Title omitted — let the orchestrator's
                      // prettyDirectTitle() build a source-aware
                      // label from the URL.
                      projectId:
                        !overrideLibrary && scope.kind === "project"
                          ? scope.id
                          : null,
                    })
                  }
                  title={
                    overrideLibrary
                      ? "Save direct to Library (Ctrl held)"
                      : "Save the file as-is, no yt-dlp"
                  }
                >
                  <Icon.download width={13} height={13} />
                  {overrideLibrary ? "Download as-is → Library" : "Download as-is"}
                </button>
              </div>
            )}

          {downloading && phase === "downloading" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
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
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => void cancelSingleUrlDownload()}
                title="Stop this download — partial file (if any) stays on disk"
                style={{ marginTop: 2 }}
              >
                {t("dl.cancel")}
              </button>
            </div>
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
              <code style={{ flex: 1 }}>{dlErr}</code>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void download()}
                disabled={downloading || !selectedFormat}
              >
                <Icon.retry width={11} height={11} /> Retry
              </button>
            </div>
          )}

          {dlResult && downloadedPaths.length <= 1 && (
            <div className="msg-row ok">
              <span className="label">{t("dl.downloadedLabel")}</span>
              <code>{dlResult.path}</code>
              <button className="btn-secondary btn" onClick={() => revealFile(dlResult.path)}>
                <Icon.folder width={12} height={12} /> {t("dl.open")}
              </button>
            </div>
          )}
          {downloadedPaths.length > 1 && (
            <div className="msg-row ok" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <span className="label">{t("dl.downloadedLabel")}</span>
                <span className="mono" style={{ flex: 1 }}>
                  {downloadedPaths.length} {t("dl.segmentsWord")}
                </span>
                <button
                  className="btn-secondary btn"
                  onClick={() => revealFile(downloadedPaths[0])}
                >
                  <Icon.folder width={12} height={12} /> {t("dl.openFolder")}
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

// =====================================================================
// 1.1 — Playlist picker
// =====================================================================
//
// Renders below the URL input when MetadataCard has a PlaylistInfo to
// show. Lets the user multi-select entries and enqueue them as
// individual jobs in the batch queue. Defaults to "all selected" so
// the common "give me everything" path is one click.
//
// Local state only (selectedIds set). On Enqueue, calls the parent's
// onEnqueue with the filtered entry list; the parent owns the
// dispatch to QueueCard and dismissing the picker.

function PlaylistPicker({
  playlist,
  onEnqueue,
  onDismiss,
}: {
  playlist: PlaylistInfo;
  onEnqueue: (entries: PlaylistEntry[]) => void;
  onDismiss: () => void;
}) {
  // Default selection: all available entries (skip unavailable —
  // they'd just fail at queue time).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(playlist.entries.filter((e) => !e.unavailable).map((e) => e.id)),
  );

  const availableCount = playlist.entries.filter((e) => !e.unavailable).length;
  const selectedAvailableEntries = playlist.entries.filter(
    (e) => selectedIds.has(e.id) && !e.unavailable,
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(
      new Set(playlist.entries.filter((e) => !e.unavailable).map((e) => e.id)),
    );
  }
  function selectNone() {
    setSelectedIds(new Set());
  }
  function selectFirst(n: number) {
    setSelectedIds(
      new Set(
        playlist.entries
          .filter((e) => !e.unavailable)
          .slice(0, n)
          .map((e) => e.id),
      ),
    );
  }

  return (
    <section
      className="card-box"
      style={{ marginTop: 12, padding: 14 }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>
        Playlist: {playlist.title}
        <span className="chip" style={{ marginLeft: 8 }}>
          {availableCount} of {playlist.entry_count}
          {playlist.truncated ? " (truncated)" : ""}
        </span>
      </h3>
      {playlist.uploader && (
        <div className="hint" style={{ marginBottom: 8 }}>
          by {playlist.uploader}
        </div>
      )}
      {playlist.truncated && (
        <div className="msg-row" style={{ background: "var(--bg-2)" }}>
          <span className="label">truncated</span>
          <span style={{ flex: 1, fontSize: 12 }}>
            Showing first 500 entries. Larger playlists aren't supported
            in 1.1 — slice the playlist on YouTube and re-paste if you
            need more.
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
          margin: "8px 0",
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={selectAll}>
          Select all
        </button>
        <button type="button" className="btn btn-secondary" onClick={selectNone}>
          Select none
        </button>
        {availableCount > 5 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => selectFirst(5)}
          >
            First 5
          </button>
        )}
        {availableCount > 10 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => selectFirst(10)}
          >
            First 10
          </button>
        )}
        <span className="mono faint" style={{ fontSize: 11, marginLeft: "auto" }}>
          {selectedAvailableEntries.length} selected
        </span>
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: 360,
          overflowY: "auto",
          border: "1px solid var(--border-1)",
          borderRadius: 4,
        }}
      >
        {playlist.entries.map((e, i) => {
          const checked = selectedIds.has(e.id);
          return (
            <li
              key={e.id || `idx-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderBottom: "1px solid var(--border-1)",
                opacity: e.unavailable ? 0.5 : 1,
                cursor: e.unavailable ? "not-allowed" : "pointer",
              }}
              onClick={() => !e.unavailable && toggle(e.id)}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={e.unavailable}
                onChange={() => toggle(e.id)}
                onClick={(ev) => ev.stopPropagation()}
              />
              {e.thumbnail ? (
                <img
                  src={e.thumbnail}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 80,
                    height: 45,
                    objectFit: "cover",
                    borderRadius: 2,
                    background: "var(--bg-2)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 80,
                    height: 45,
                    background: "var(--bg-2)",
                    borderRadius: 2,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {i + 1}. {e.title}
                  {e.unavailable && (
                    <span className="chip" style={{ marginLeft: 6 }}>
                      unavailable
                    </span>
                  )}
                </div>
                <div className="mono faint" style={{ fontSize: 11 }}>
                  {e.channel ?? "—"}
                  {e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 10,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn"
          disabled={selectedAvailableEntries.length === 0}
          onClick={() => onEnqueue(selectedAvailableEntries)}
        >
          <Icon.plus width={12} height={12} />
          Add {selectedAvailableEntries.length} to queue
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDismiss}>
          Cancel
        </button>
        <span className="hint faint" style={{ fontSize: 11, marginLeft: "auto" }}>
          Jobs land in the batch queue below.
        </span>
      </div>
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
// 1.1.3 — QueueJob, QueueStatus, Semaphore, cpuTranscodeSem, gpuTranscodeSem,
// NVENC_PRESETS, isGpuPreset, newJobId, QUEUE_STORAGE_KEY, loadQueueFromStorage,
// and the workerLoop itself all moved to lib/downloads.tsx (DownloadsProvider).
// QueueCard below is now a presenter; it consumes useDownloads() and
// dispatches actions.

function QueueCard() {
  const { scope } = useActiveProject();
  const { settings } = useSettings();
  const t = useT();
  const overrideLibrary = useLibraryOverride();
  const [urlsInput, setUrlsInput] = useState("");
  // 1.1.3 — queue state + workerLoop + event listeners moved to the
  // app-level DownloadsProvider so they survive route navigation. This
  // component is now a thin presenter that reads jobs and dispatches
  // user-initiated actions (enqueue / cancel / clear / retry).
  const {
    queueJobs: jobs,
    enqueueUrls,
    cancelQueueJob,
    clearCompletedJobs,
    retryFailedJobs,
  } = useDownloads();
  const [batchTranscode, setBatchTranscode] = useState<TranscodePreset>(
    () => (settings.default_transcode_preset as TranscodePreset) ?? "none",
  );
  // 1.2.0 — batch audio mode. "off" = video pipeline (existing).
  // mp3/m4a/flac = audio extraction, transcode ignored, every job
  // becomes an audio asset. Local state — workflow choice, not a
  // persistent setting.
  const [batchAudio, setBatchAudio] = useState<"off" | AudioFormat>("off");
  const batchPresetInitialized = useRef(false);
  useEffect(() => {
    if (batchPresetInitialized.current) return;
    if (settings.default_transcode_preset) {
      setBatchTranscode(settings.default_transcode_preset as TranscodePreset);
      batchPresetInitialized.current = true;
    }
  }, [settings.default_transcode_preset]);

  // Worker count is settings-driven (display only here — the actual
  // ceiling is enforced inside DownloadsProvider).
  const downloadWorkers = Math.max(1, Math.min(6, settings.download_concurrency));

  // 1.1 — listen for playlist-picker enqueue events. The picker
  // dispatches a CustomEvent with the list of selected URLs + the
  // captured project scope. Stays here because both the picker and
  // this listener belong to the Download page surface.
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent<QueueEnqueueDetail>).detail;
      if (!detail || !detail.urls || detail.urls.length === 0) return;
      enqueueUrls(detail.urls, {
        transcodePreset: batchTranscode,
        projectId: detail.projectId,
        audioFormat: batchAudio === "off" ? null : batchAudio,
      });
    }
    window.addEventListener(QUEUE_ENQUEUE_EVENT, handler);
    return () => window.removeEventListener(QUEUE_ENQUEUE_EVENT, handler);
  });

  // 1.1.3 — processOne / workerLoop / cancel / clear / retry all live
  // in DownloadsProvider now. We just call into the context.
  function queueAll() {
    const urls = urlsInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) return;
    const projectSnapshot =
      !overrideLibrary && scope.kind === "project" ? scope.id : null;
    enqueueUrls(urls, {
      transcodePreset: batchTranscode,
      projectId: projectSnapshot,
      audioFormat: batchAudio === "off" ? null : batchAudio,
    });
    setUrlsInput("");
  }
  // Aliases for the JSX below — keeps render-side names stable.
  const clearCompleted = clearCompletedJobs;
  const cancelJob = cancelQueueJob;
  const retryFailed = retryFailedJobs;

  const stats = (() => {
    if (jobs.length === 0) return "";
    const counts: Record<QueueStatus, number> = {
      queued: 0,
      fetching: 0,
      downloading: 0,
      transcoding: 0,
      done: 0,
      failed: 0,
      canceled: 0,
    };
    for (const j of jobs) counts[j.status]++;
    const active = counts.downloading + counts.transcoding + counts.fetching;
    const parts: string[] = [];
    if (active) parts.push(`${active} active`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    if (counts.canceled) parts.push(`${counts.canceled} canceled`);
    return parts.join(" · ");
  })();

  return (
    <section className="card-box">
      <h2>
        {t("dl.queue.title")} <span className="chip">parallel × {downloadWorkers}</span>
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
        <span className="label">audio mode</span>
        <select
          className="field-select"
          value={batchAudio}
          onChange={(e) => setBatchAudio(e.target.value as "off" | AudioFormat)}
        >
          <option value="off">Off (video)</option>
          <option value="mp3">MP3 · 320k</option>
          <option value="m4a">M4A · AAC 256k</option>
          <option value="flac">FLAC · lossless</option>
        </select>
        <span className="hint-text">
          {batchAudio === "off"
            ? "video downloads — transcode below applies"
            : `extract audio to .${batchAudio} (transcode ignored)`}
        </span>
      </div>

      {batchAudio === "off" && (
        <div className="bar" style={{ borderTop: 0, padding: "0 0 4px" }}>
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
      )}

      <div className="queue-actions">
        <button
          className={"btn" + (overrideLibrary ? " btn-override" : "")}
          onClick={queueAll}
          disabled={!urlsInput.trim()}
          title={overrideLibrary ? "Queue into Library (Ctrl held)" : undefined}
        >
          {overrideLibrary ? `${t("dl.queueAll")} → ${t("topbar.library")}` : t("dl.queueAll")}
        </button>
        <button className="btn btn-secondary" onClick={clearCompleted}>
          {t("dl.clearCompleted")}
        </button>
        {jobs.some((j) => j.status === "failed") && (
          <button className="btn btn-secondary" onClick={retryFailed}>
            <Icon.retry width={12} height={12} /> {t("dl.retryFailed")}
          </button>
        )}
        <span className="stats">{stats}</span>
      </div>

      {jobs.length > 0 && (
        <ul className="queue-list">
          {/* 1.3.x — newest-first: the queue's internal order stays
              append-only (so worker logic / cancellation indices keep
              their semantics), but the visible list reverses so a fresh
              add lands at the top — what testers expected. Slice first
              to avoid mutating the underlying jobs array. */}
          {jobs.slice().reverse().map((job) => (
            <QueueRow key={job.id} job={job} onCancel={cancelJob} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({ job, onCancel }: { job: QueueJob; onCancel: (id: string) => void }) {
  const t = useT();
  const pillClass =
    job.status === "done"
      ? "pill ok"
      : job.status === "failed"
        ? "pill err"
        : job.status === "canceled"
          ? "pill queued"
          : job.status === "queued"
            ? "pill queued"
            : "pill live";
  // Cancel is only meaningful while yt-dlp is fetching bytes. fetching
  // (metadata) and transcoding (ffmpeg) phases stay un-cancelable for
  // now — metadata is fast, transcode kill is a future polish item.
  const canCancel = job.status === "downloading";

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
        {job.status === "canceled" && (
          <div className="queue-error" style={{ color: "var(--text-3)" }}>
            {t("dl.canceledCleaned")}
          </div>
        )}
      </div>
      <div className="queue-status">
        <span className={pillClass}>{job.status}</span>
        {canCancel && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: 6, fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCancel(job.id)}
            title="Stop this download"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}

// Sidecar smoke test (0.1) lived here; removed once yt-dlp + ffmpeg
// versions stopped being interesting to verify daily. The Rust
// `binaries_version` command is still wired — re-add a tiny UI if we
// ever need it again (e.g. for a Settings → diagnostics panel).
