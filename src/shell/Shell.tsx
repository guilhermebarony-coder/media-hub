import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useActiveProject } from "../lib/activeProject";

/**
 * App shell: top bar with brand + active-project picker + global search +
 * settings icon, left nav, route outlet on the right. Stays mounted
 * across route changes so route transitions are instant.
 *
 * The active-project picker and global search are placeholder UI for
 * now — wired up when 0.6 (real projects) and the cmd-K palette land.
 */
export function Shell() {
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

function TopBar() {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">media·hub</div>
        <div className="brand-build">0.5.0</div>
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
