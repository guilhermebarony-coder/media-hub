import { Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Shell } from "./shell/Shell";
import { ActiveProjectProvider } from "./lib/activeProject";
import { SettingsProvider, useSettings } from "./lib/settings";
import { DownloadsProvider, useDownloads } from "./lib/downloads";
import { confirmDialog } from "./lib/dialog";
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
    <DownloadsProvider downloadConcurrency={concurrency}>
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
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const fn = await listen<{
          url: string;
          audio_format: string | null;
          project_id: string | null;
          source: string;
        }>("bridge:enqueue", (e) => {
          const p = e.payload;
          if (!p || !p.url) return;
          enqueueUrls([p.url], {
            transcodePreset: (settings.default_transcode_preset as never) ?? "none",
            projectId: p.project_id ?? null,
            audioFormat:
              p.audio_format === "mp3" ||
              p.audio_format === "m4a" ||
              p.audio_format === "flac"
                ? p.audio_format
                : null,
          });
          console.log(`[bridge] enqueued from ${p.source}: ${p.url}`);
        });
        if (cancelled) fn();
        else unlisten = fn;
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

export default function App() {
  return (
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
        </DownloadsHost>
      </ActiveProjectProvider>
    </SettingsProvider>
  );
}
