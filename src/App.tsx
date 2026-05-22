import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Shell } from "./shell/Shell";
import { ActiveProjectProvider } from "./lib/activeProject";
import { SettingsProvider } from "./lib/settings";
import "./App.css";

// Onboarding is a one-time-ever experience for new installs. After
// the user finishes/skips it, this code is dead weight on every
// subsequent launch — lazy-loading means it doesn't ship in the
// initial chunk. Wrapped in Suspense with null fallback so it
// renders nothing while the (tiny) chunk loads on the first launch.
const OnboardingGate = lazy(() =>
  import("./components/Onboarding").then((m) => ({ default: m.OnboardingGate })),
);

/**
 * Lazy-loaded page routes (0.9.A.5 code-splitting).
 *
 * Vite produces a separate chunk per `React.lazy()` import. Initial
 * load only pulls the Shell + the active route. Other pages download
 * (off the filesystem in Tauri's case, so basically instant) only
 * when the user navigates to them.
 *
 * Expected impact: initial JS chunk goes from one big 322 kB blob to
 * a smaller "shell + initial route" bundle. Each route becomes its
 * own ~40-80 kB chunk that loads on navigation. Time-to-interactive
 * for the first paint improves; subsequent route changes have one
 * brief load (cached after that).
 *
 * Shell stays eager — it owns the persistent chrome and renders on
 * every route. Lazy-loading Shell would mean a flash on first paint.
 */
const LibraryPage = lazy(() => import("./pages/Library"));
const DownloadPage = lazy(() => import("./pages/Download"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const SettingsPage = lazy(() => import("./pages/Settings"));

/**
 * Suspense fallback rendered while a route's chunk loads. Intentionally
 * minimal — a brief dim of the content area, no spinner, because route
 * chunks load from local disk in Tauri (no real network). The fallback
 * mostly exists to keep React happy; users typically won't see it.
 */
function RouteLoading() {
  return (
    <div className="content">
      <div className="content-body" style={{ opacity: 0.4 }}>
        <span className="faint mono" style={{ fontSize: 11 }}>
          loading…
        </span>
      </div>
    </div>
  );
}

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
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<HomeRedirect />} />
              <Route
                path="/download"
                element={
                  <Suspense fallback={<RouteLoading />}>
                    <DownloadPage />
                  </Suspense>
                }
              />
              <Route
                path="/library"
                element={
                  <Suspense fallback={<RouteLoading />}>
                    <LibraryPage />
                  </Suspense>
                }
              />
              <Route
                path="/projects"
                element={
                  <Suspense fallback={<RouteLoading />}>
                    <ProjectsPage />
                  </Suspense>
                }
              />
              <Route
                path="/settings"
                element={
                  <Suspense fallback={<RouteLoading />}>
                    <SettingsPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<Navigate to="/library" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ActiveProjectProvider>
    </SettingsProvider>
  );
}
