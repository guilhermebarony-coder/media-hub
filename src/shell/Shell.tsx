import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useActiveProject } from "../lib/activeProject";

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
  return (
    <div className="mh">
      <TopBar />
      <div className="main">
        <Nav />
        <Outlet />
      </div>
    </div>
  );
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

function TopBar() {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">media·hub</div>
        <div className="brand-build">1.0.0</div>
      </div>
      <ActiveProject />
      <div className="topbar-spacer" />
      <button className="topbar-search" type="button" title="Global search (coming soon)">
        <Icon.search width={13} height={13} />
        <span>Search everything…</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <div className="topbar-icons">
        <NavLink to="/settings" className="ic-btn" title="Settings">
          <Icon.settings width={14} height={14} />
        </NavLink>
      </div>
    </div>
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
