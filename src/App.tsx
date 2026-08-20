import { Suspense, useEffect, useRef, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Shell } from "./shell/Shell";
import { ActiveProjectProvider } from "./lib/activeProject";
import { SettingsProvider, useSettings } from "./lib/settings";
import { LanguageProvider } from "./lib/i18n";
import { DownloadsProvider, useDownloads } from "./lib/downloads";
import { RtxEnhanceProvider } from "./lib/rtxEnhance";
import { RtxQueueDock } from "./components/RtxQueueDock";
import { RtxEnhanceWindow } from "./components/RtxEnhanceWindow";
import { confirmDialog } from "./lib/dialog";
import { TRANSCODE_PRESETS } from "./lib/types";
import { DialogHost } from "./components/DialogHost";
import { ToolsGate } from "./components/ToolsGate";
import { lazy } from "react";
import "./App.css";

// Onboarding is a one-time-ever experience for new installs. After
// the user finishes/skips it, this code is dead weight on every
// subsequent launch — lazy-loading means it doesn't ship in the
// initial chunk. Wrapped in Suspense with null fallback so it
// renders nothing while the (tiny) chunk loads on the first launch.
const OnboardingGate = lazy(() =>
  import("./components/Onboarding").then((m) => ({ default: m.OnboardingGate })),
);

// 1.1.3 — page-level lazy imports moved to Shell.tsx so the keep-alive
// host can own them. Page chunks still split per-page (vite); each one
// loads on first visit and stays mounted thereafter so form state,
// scrubber video, library filters etc. survive route navigation.

/**
 * Default route — `/` redirect chooser (0.9 UX win #4).
 *
 * Empty library? Send the user to /download (their first task is
 * "get something"). Non-empty? /library (their natural workflow:
 * see what you have, click Download when you need more).
 *
 * Renders nothing while the count query is in flight — visually a
 * one-frame blank, but in practice the query is sub-millisecond on
 * a local SQLite and the redirect kicks in before paint.
 *
 * On lookup failure, defaults to /library (safer — non-destructive,
 * the page renders an empty state which is also fine for new installs).
 */
function HomeRedirect() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    invoke<number>("library_count", { scope: null })
      .then((n) => setTarget(n > 0 ? "/library" : "/download"))
      .catch(() => setTarget("/library"));
  }, []);
  if (target == null) return null;
  return <Navigate to={target} replace />;
}

/**
 * Router. HashRouter (not BrowserRouter) because Tauri serves the app
 * over `tauri://` in production and `http://localhost` in dev, and
 * we don't want to deal with serving routes from different origins.
 * Hash routes work the same in both environments.
 *
 * Default route is /library — the post-onboarding workflow is "open
 * app → see what you have → click Download when you need more."
 */
/**
 * Wrapper that reads the current download_concurrency from settings
 * and threads it into DownloadsProvider. Lives inside SettingsProvider
 * so the hook works; mounts above the Router so download state
 * survives every route navigation (1.1.3 — fixes the "downloads
 * disappear when you change tabs" bug).
 */
function DownloadsHost({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const concurrency = Math.max(1, Math.min(6, settings.download_concurrency));
  return (
    <DownloadsProvider
      downloadConcurrency={concurrency}
      preferredMaxQuality={settings.preferred_max_quality}
    >
      {/* 1.1.6 — CloseGuard removed. The component hooked
          getCurrentWindow().onCloseRequested to kill child processes
          before window destroy. Multiple iterations (with dialog,
          without dialog, async handler, sync handler) all left "X
          does nothing" symptoms — root cause turned out to be Tauri
          bug #7119: calling unlisten() ever (which our useEffect
          cleanup or the cancelled-race branch does) permanently
          breaks window close even for newly-registered listeners.
          Workaround: don't register the listener at all.
          Safety net: OrphanScanner on next boot catches any partial
          files left behind by killed-by-OS children. ffmpeg/yt-dlp
          orphan processes self-terminate within minutes when their
          stdout pipes break (the original "100% CPU forever" report
          was likely just a long transcode finishing). */}
      <OrphanScanner />
      {/* 1.2.2 — bridge listener routes browser-extension enqueues
          into the existing queue. Lives here so it has access to
          useDownloads inside the provider. */}
      <BridgeListener />
      {children}
    </DownloadsProvider>
  );
}

/**
 * 1.2.2 — listen for `bridge:enqueue` events emitted by the Rust
 * localhost HTTP server. Each event represents one URL the user
 * "sent to hub" via the browser extension (or a curl script). We
 * forward straight into the existing queue with the user's saved
 * defaults for transcode preset, so the extension never has to know
 * about transcode at all.
 *
 * Lives inside DownloadsProvider so `useDownloads` is available.
 * Single useEffect subscribes once on mount.
 */
function BridgeListener() {
  const { enqueueUrls } = useDownloads();
  const { settings } = useSettings();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    type BridgePayload = {
      url: string;
      audio_format: string | null;
      project_id: string | null;
      source: string;
      quality: string | null;
      transcode: string | null;
      rename: string | null;
      media_index: number | null;
    };
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const handle = (p: BridgePayload | null | undefined) => {
          if (!p || !p.url) return;
          // 1.13.x — honor the extension quick-menu overrides when present;
          // otherwise fall back to the user's Settings default.
          // Allowlist, because this arrives over the bridge from the
          // extension. Derived from the preset registry rather than
          // retyped — a hand-written copy silently dropped every new
          // preset (GIF was added in 1.13.5 and would have fallen back
          // to the Settings default without a word).
          const validPresets = TRANSCODE_PRESETS.map((p) => p.value) as string[];
          const transcodePreset = (
            p.transcode && validPresets.includes(p.transcode)
              ? p.transcode
              : (settings.default_transcode_preset ?? "none")
          ) as never;
          enqueueUrls([p.url], {
            transcodePreset,
            projectId: p.project_id ?? null,
            audioFormat:
              p.audio_format === "mp3" ||
              p.audio_format === "m4a" ||
              p.audio_format === "flac"
                ? p.audio_format
                : null,
            maxQuality: p.quality && /^\d+$/.test(p.quality) ? p.quality : undefined,
            titleOverride: p.rename && p.rename.trim() ? p.rename.trim() : undefined,
            mediaIndex:
              typeof p.media_index === "number" && p.media_index >= 1
                ? p.media_index
                : undefined,
          });
          console.log(`[bridge] enqueued from ${p.source}: ${p.url}`);
        };
        const fn = await listen<BridgePayload>("bridge:enqueue", (e) => handle(e.payload));
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        // 1.13.5 — tell Rust we're listening, and take whatever arrived
        // before we were. The bridge's HTTP server binds during Tauri
        // setup(), so on a cold start /health answers "up" seconds
        // before this effect runs — an enqueue in that window used to be
        // emitted into the void and silently lost, which is why clicking
        // the extension button on a closed app opened it and did nothing
        // until you clicked a second time.
        const missed = await invoke<BridgePayload[]>("bridge_frontend_ready");
        for (const p of missed) handle(p);
        if (missed.length > 0) {
          console.log(`[bridge] drained ${missed.length} enqueue(s) buffered during startup`);
        }
      } catch (e) {
        console.warn("[bridge] listen failed:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enqueueUrls, settings.default_transcode_preset]);
  return null;
}

/**
 * 1.1.3 — close-window protection. If the user tries to close the
 * window while downloads are in flight, we intercept with a confirm
 * dialog. On accept, we cancel all active downloads (which kills the
 * spawned yt-dlp/ffmpeg children via JobRegistry) THEN exit.
 *
 * Without this, on Windows the spawned children sometimes become
 * orphan processes that keep running after the window closes —
 * symptom reported 2026-05-25: ffmpeg eating 100% CPU after the user
 * thought they'd closed the app. This is the front-line defense.
 *
 * Lives inside DownloadsProvider so it can read activeCount. No UI
 * of its own — it just sits there and gates the close request.
 */
/**
 * 1.1.3 — Boot-time orphan scan. Looks for `.part` / `.ytdl` / `.tmp`
 * files in Library/raw + Projects/* /raw that are older than 5 min
 * (so we don't race with another instance). If any found, shows a
 * confirm asking the user to send them to the Recycle Bin.
 *
 * Runs ONCE per app boot, ~3 seconds after mount (lets the rest of
 * the UI settle so the dialog doesn't pre-empt the user's first
 * action). Skipped silently when nothing found.
 */
function OrphanScanner() {
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const res = await invoke<{
          files: Array<{ path: string; size: number; modified_unix: number }>;
          total_bytes: number;
        }>("library_scan_orphans");
        if (cancelled || res.files.length === 0) return;
        const mb = (res.total_bytes / (1024 * 1024)).toFixed(1);
        const lines = res.files
          .slice(0, 5)
          .map((f) => `  • ${f.path.split(/[\\/]/).pop()} (${(f.size / (1024 * 1024)).toFixed(1)} MB)`)
          .join("\n");
        const more = res.files.length > 5 ? `\n  …and ${res.files.length - 5} more` : "";
        const ok = await confirmDialog(
          `Found ${res.files.length} leftover partial download${res.files.length === 1 ? "" : "s"} ` +
            `from a previous session (${mb} MB total).\n\n${lines}${more}\n\n` +
            `Move them to the Recycle Bin? (Recoverable from there.)`,
          { title: "Clean up partial downloads?", kind: "warning" },
        );
        if (!ok) return;
        const removed = await invoke<number>("library_clean_orphans", {
          paths: res.files.map((f) => f.path),
        });
        console.info(`[orphans] cleaned ${removed} partial downloads`);
      } catch (e) {
        console.warn("orphan scan failed:", e);
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);
  return null;
}

/* 1.1.6 — CloseGuard fully deleted. See the comment in DownloadsHost
   above for the design history + why it's gone. */

/**
 * 1.8.x — One-time, non-blocking consent for the browser-login cookie
 * system. Shows once (after onboarding, gated by cookies_consent_seen).
 * "Enable" turns the cookie system on; "Not now" leaves it off. Either
 * way the flag is set so it never asks again — the Settings → Sources
 * toggle is the control thereafter. Not a blocker: downloads work
 * regardless, and the friendly restricted-video error explains the fix
 * if the user declined and later hits the wall.
 */
function CookieConsentPrompt() {
  const { settings, ready, save } = useSettings();
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || asked.current) return;
    if (settings.cookies_consent_seen) return;
    if (!settings.onboarding_complete) return; // let onboarding finish first
    asked.current = true;
    (async () => {
      const ok = await confirmDialog(
        "Media Hub can use your browser login — synced through the Media Hub browser extension — to download age-restricted or private videos. Your cookies stay on this machine and are only used for your own downloads.\n\nEnable it now? You can change this anytime in Settings → Sources.",
        {
          title: "Use your browser login?",
          kind: "info",
          confirmLabel: "Enable",
          cancelLabel: "Not now",
        },
      );
      void save((s) => ({
        ...s,
        cookies_enabled: ok,
        cookies_consent_seen: true,
      }));
    })();
  }, [ready, settings.cookies_consent_seen, settings.onboarding_complete, save]);
  return null;
}

export default function App() {
  return (
    <LanguageProvider>
    <SettingsProvider>
      {/* First-run onboarding overlay (0.8.D). Shows itself when
       *  settings.onboarding_complete is false; renders nothing
       *  otherwise. Lazy-loaded — never ships in the main chunk
       *  for returning users. */}
      <Suspense fallback={null}>
        <OnboardingGate />
      </Suspense>
      <ActiveProjectProvider>
        <DownloadsHost>
          <RtxEnhanceProvider>
            <HashRouter>
              {/* 1.1.3 — only the `/` redirect uses Routes now. Everything
                  else renders via the keep-alive Shell, which owns the page
                  visibility entirely via useLocation. This makes Download
                  survive route nav (preserves the fetched metadata, the
                  scrubber, the in-flight progress, etc.) — and Library
                  keeps its scroll position + active filters for free. */}
              <Routes>
                <Route path="/" element={<HomeRedirect />} />
                <Route path="*" element={<Shell />} />
              </Routes>
            </HashRouter>
            {/* RTX enhance queue status dock (bottom-left) + the before/after
                review window. Both render nothing until there's work. */}
            <RtxQueueDock />
            <RtxEnhanceWindow />
          </RtxEnhanceProvider>
        </DownloadsHost>
      </ActiveProjectProvider>
      {/* 1.3.x — in-app dialog renderer (replaces native OS dialogs).
          Mounted at root so confirm/alert modals overlay everything. */}
      <DialogHost />
      <CookieConsentPrompt />
      {/* 1.12.0 — first-run tool setup. ffmpeg/deno are downloaded on first
          launch; this blocks with progress until ffmpeg is ready, then
          renders nothing. Highest layer so it covers everything. */}
      <ToolsGate />
    </SettingsProvider>
    </LanguageProvider>
  );
}
