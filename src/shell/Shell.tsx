import { NavLink, Outlet } from "react-router-dom";
import { Icon } from "../lib/icons";

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
 * Active-project picker. Currently a stub — real project switching
 * arrives with 0.6 (dual-root library structure). For now we show
 * "Library" as the perpetual active scope.
 */
function ActiveProject() {
  return (
    <div className="proj-picker lib" title="Projects arrive with 0.6">
      <span className="dot" />
      <div className="col">
        <span className="label">Active</span>
        <span className="name">Library</span>
      </div>
      <span className="chev">
        <Icon.chev width={10} height={10} />
      </span>
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
