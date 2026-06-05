import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../lib/icons";
import { useActiveProject } from "../lib/activeProject";
import { useDownloads } from "../lib/downloads";
import { APP_VERSION } from "../lib/version";
import { CommandPalette } from "../components/CommandPalette";

// 1.1.3 — lazy-load pages here (moved from App.tsx) so the Shell owns
// the keep-alive lifecycle. Vite still produces one chunk per page;
// first visit triggers the chunk load, then the page stays mounted
// for the rest of the session. State (form fields, scrubber video,
// library filters/scroll) survives every route navigation as a result.
const LibraryPage = lazy(() => import("../pages/Library"));
const DownloadPage = lazy(() => import("../pages/Download"));
const ProjectsPage = lazy(() => import("../pages/Projects"));
const SettingsPage = lazy(() => import("../pages/Settings"));

/**
 * Suspense fallback for the first load of each page's chunk. After
 * first load the page stays mounted, so this only flashes on the
 * very first visit per app session. Local-disk chunks load in ~1
 * frame so the fallback is essentially invisible.
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
 * App shell: top bar with brand + active-project picker + global search +
 * settings icon, left nav, route outlet on the right. Stays mounted
 * across route changes so route transitions are instant.
 *
 * The active-project picker is fully wired (0.6 Phase A).
 * Global search (Ctrl-K) is still placeholder UI — wired up when
 * the command palette lands (parked for 1.2).
 */
export function Shell() {
  useNavShortcuts();
  // 1.3.x — global command palette. Ctrl+Space opens; clicking the
  // topbar Search button does the same. State lives at the Shell
  // level so the palette is reachable from any page.
  const [paletteOpen, setPaletteOpen] = useState(false);
  usePaletteShortcut(() => setPaletteOpen(true));
  const { pathname } = useLocation();
  // 1.1.3 — keep-alive pages. Mount each page on first visit and keep
  // it mounted thereafter. `hidden` attribute hides the non-active
  // page from layout + a11y without unmounting (no display:none repaint
  // when toggled, and React state survives intact).
  const [visited, setVisited] = useState<Set<string>>(() => new Set([pathname]));
  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(pathname)) return prev;
      const next = new Set(prev);
      next.add(pathname);
      return next;
    });
  }, [pathname]);

  // Default route — if the user lands on a path we don't recognize,
  // bounce them to /library (same as the old wildcard route).
  const known = pathname === "/library" || pathname === "/download" || pathname === "/projects" || pathname === "/settings";

  return (
    <div className="mh">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div className="main">
        <Nav />
        <div className="content-host">
          {!known && pathname !== "/" && <RedirectToLibrary />}
          {visited.has("/library") && (
            <div className="keep-page" hidden={pathname !== "/library"}>
              <Suspense fallback={<RouteLoading />}>
                <LibraryPage />
              </Suspense>
            </div>
          )}
          {visited.has("/download") && (
            <div className="keep-page" hidden={pathname !== "/download"}>
              <Suspense fallback={<RouteLoading />}>
                <DownloadPage />
              </Suspense>
            </div>
          )}
          {visited.has("/projects") && (
            <div className="keep-page" hidden={pathname !== "/projects"}>
              <Suspense fallback={<RouteLoading />}>
                <ProjectsPage />
              </Suspense>
            </div>
          )}
          {visited.has("/settings") && (
            <div className="keep-page" hidden={pathname !== "/settings"}>
              <Suspense fallback={<RouteLoading />}>
                <SettingsPage />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RedirectToLibrary() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/library", { replace: true });
  }, [navigate]);
  return null;
}

/**
 * Wire the keyboard shortcuts that Nav already displays as chips on
 * each NavItem (1 / 2 / 3 / ,). Before this hook these were
 * advertised-but-not-wired — typing "1" did nothing despite the chip.
 *
 * Rules:
 *   - Bare key, no modifier. Pressing 1 navigates, Ctrl+1 doesn't
 *     (so we don't fight browser/window shortcuts).
 *   - Skipped when the user is in a text field — typing "1" into the
 *     URL input or a tag editor must NOT navigate.
 *   - Ignored on key repeat to avoid double-nav from a held key.
 */
/**
 * 1.3.x — Ctrl+Space opens the command palette. Reserved for this
 * purpose since 0.6 (see the comment in Download.tsx). We deliberately
 * intercept ONLY Ctrl+Space, not Space alone (the Scrubber uses bare
 * Space for play/pause) and not Ctrl alone (the Download page uses
 * that for the override-to-Library shortcut).
 *
 * Honors the same isTypingTarget guard as useNavShortcuts so the
 * shortcut doesn't fight URL input boxes / tag editors.
 */
function usePaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Ctrl-or-Cmd + Space. Space-only would fight Scrubber play/pause.
      const isCtrlSpace =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "Space";
      if (!isCtrlSpace) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

function useNavShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      // Match the chips shown on Nav exactly.
      switch (e.key) {
        case "1":
          navigate("/download");
          break;
        case "2":
          navigate("/library");
          break;
        case "3":
          navigate("/projects");
          break;
        case ",":
          navigate("/settings");
          break;
        default:
          return;
      }
      // Only prevent default for keys we actually handled — keeps
      // arrow keys, etc. as normal.
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">media·hub</div>
        <div className="brand-build">{APP_VERSION}</div>
      </div>
      <ActiveProject />
      <div className="topbar-spacer" />
      {/* 1.1.3 — always-visible download activity indicator. Lit up
          whenever any single-URL or queue job is active. Clicking
          jumps to /download so the user can see what's happening. */}
      <ActivityBadge />
      {/* 1.3.x — opens the command palette (used to be a dead
          "coming soon" button). Ctrl+Space does the same. */}
      <button
        className="topbar-search"
        type="button"
        onClick={onOpenPalette}
        title="Search clips (Ctrl+Space)"
      >
        <Icon.search width={13} height={13} />
        <span>Search clips…</span>
        <span className="kbd">Ctrl Space</span>
      </button>
      <div className="topbar-icons">
        <TrayTooltipSync />
        <BackgroundModeButton />
        <NavLink to="/settings" className="ic-btn" title="Settings">
          <Icon.settings width={14} height={14} />
        </NavLink>
      </div>
    </div>
  );
}

// 1.3.x — "Run in background" button. Hides the window into the system
// tray; the Rust backend + the (hidden but alive) download queue keep
// running. The window controls keep their normal behavior — this button
// is the explicit opt-in. First use shows a one-time hint so people
// know where the app went and how to bring it back.
function BackgroundModeButton() {
  async function enterBackground() {
    try {
      await invoke("app_enter_background");
    } catch (e) {
      console.error("[bg] enter background failed:", e);
    }
  }
  return (
    <button
      type="button"
      className="ic-btn"
      onClick={() => void enterBackground()}
      title="Run in background — hides to the tray, keeps downloading"
    >
      <Icon.eye width={15} height={15} />
    </button>
  );
}

// 1.3.x — keeps the system-tray tooltip in sync with the live active
// download count, so while the window is hidden a hover over the tray
// icon reads "Media Hub — 2 downloading". No-op in the backend when
// the tray isn't visible. Renders nothing.
function TrayTooltipSync() {
  const { activeCount } = useDownloads();
  useEffect(() => {
    const text =
      activeCount > 0
        ? `Media Hub — ${activeCount} downloading`
        : "Media Hub";
    void invoke("app_set_tray_tooltip", { text }).catch(() => {});
  }, [activeCount]);
  return null;
}

function ActivityBadge() {
  const { activeCount } = useDownloads();
  if (activeCount === 0) return null;
  return (
    <NavLink
      to="/download"
      className="topbar-activity"
      title={`${activeCount} active ${activeCount === 1 ? "download" : "downloads"} — click to view`}
    >
      <span className="topbar-activity-dot" />
      <span className="topbar-activity-count mono">{activeCount}</span>
      <span className="topbar-activity-label">
        {activeCount === 1 ? "downloading" : "downloads"}
      </span>
    </NavLink>
  );
}

/**
 * Active-project picker. Drives the library-page scope filter and (in
 * Phase B) where new downloads are routed. Tonight: meta-only switching
 * — physical folder routing lands next session.
 *
 * UX choices:
 *   - "Library" is always the first option, even when on a project,
 *     so the escape hatch is one click away
 *   - Newest projects float up (matches project_list ordering)
 *   - "+ New project…" at the bottom routes to /projects so the user
 *     does the actual create with name validation visible
 *   - Click-outside closes; Escape closes
 */
function ActiveProject() {
  const { scope, setScope, projects } = useActiveProject();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isLibrary = scope.kind === "library";
  const label = isLibrary ? "Library" : scope.name;

  return (
    <div className="proj-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"proj-picker " + (isLibrary ? "lib" : "proj")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="col">
          <span className="label">Active</span>
          <span className="name-row">
            <span className="dot" />
            <span className="name">{label}</span>
          </span>
        </div>
        <span className="chev">
          <Icon.chev width={10} height={10} />
        </span>
      </button>

      {open && (
        <div className="proj-menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={isLibrary}
            className={"proj-menu-item" + (isLibrary ? " active" : "")}
            onClick={() => {
              setScope({ kind: "library" });
              setOpen(false);
            }}
          >
            <span className="dot lib" />
            <span className="label">Library</span>
            <span className="hint">reusable, lives forever</span>
          </button>

          {projects.length > 0 && <div className="proj-menu-sep" />}

          {projects.map((p) => {
            const selected = scope.kind === "project" && scope.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={"proj-menu-item" + (selected ? " active" : "")}
                onClick={() => {
                  setScope({ kind: "project", id: p.id, name: p.name });
                  setOpen(false);
                }}
              >
                <span className="dot proj" />
                <span className="label">{p.name}</span>
                <span className="hint mono">
                  {p.asset_count} {p.asset_count === 1 ? "clip" : "clips"}
                </span>
              </button>
            );
          })}

          <div className="proj-menu-sep" />

          <button
            type="button"
            className="proj-menu-item proj-menu-new"
            onClick={() => {
              setOpen(false);
              navigate("/projects");
            }}
          >
            <Icon.plus width={11} height={11} />
            <span className="label">New project…</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Nav() {
  return (
    <nav className="nav">
      <div className="nav-section">Workspace</div>
      <NavItem to="/download" label="Download" icon={<Icon.download className="ico" width={14} height={14} />} kbd="1" />
      <NavItem to="/library" label="Library" icon={<Icon.library className="ico" width={14} height={14} />} kbd="2" />
      <NavItem to="/projects" label="Projects" icon={<Icon.projects className="ico" width={14} height={14} />} kbd="3" />

      <div className="nav-section">System</div>
      <NavItem to="/settings" label="Settings" icon={<Icon.settings className="ico" width={14} height={14} />} kbd="," />

      <div className="nav-foot">
        <span className="stat-dot" />
        <span>ready</span>
        <span style={{ marginLeft: "auto" }} className="mono faint">
          dev
        </span>
      </div>
    </nav>
  );
}

function NavItem({
  to,
  label,
  icon,
  kbd,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  kbd?: string;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
      {icon}
      <span>{label}</span>
      {kbd && <span className="kbd">{kbd}</span>}
    </NavLink>
  );
}
