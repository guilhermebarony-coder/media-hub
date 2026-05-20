/* ============================================================
   Shared icons & shell pieces used by every screen.
   ============================================================ */

const I = {
  download: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M8 2v8m0 0l3-3m-3 3L5 7" /><path d="M3 13h10" />
    </svg>
  ),
  library: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 7h12"/><path d="M6 3v4"/>
    </svg>
  ),
  projects: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z"/>
    </svg>
  ),
  settings: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="8" cy="8" r="2"/>
      <path d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>
    </svg>
  ),
  search: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="7" cy="7" r="4.5"/><path d="M13.5 13.5L10.5 10.5"/>
    </svg>
  ),
  filter: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2 4h12M4 8h8M6 12h4"/>
    </svg>
  ),
  grid: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <rect x="2.5" y="2.5" width="4" height="4" rx="0.5"/>
      <rect x="9.5" y="2.5" width="4" height="4" rx="0.5"/>
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.5"/>
      <rect x="9.5" y="9.5" width="4" height="4" rx="0.5"/>
    </svg>
  ),
  list: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...p}>
      <path d="M2 4h12M2 8h12M2 12h12"/>
    </svg>
  ),
  plus: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...p}>
      <path d="M8 3v10M3 8h10"/>
    </svg>
  ),
  chev: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 6l4 4 4-4"/>
    </svg>
  ),
  chevR: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 4l4 4-4 4"/>
    </svg>
  ),
  more: (p={}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/>
    </svg>
  ),
  pause: (p={}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <rect x="4.5" y="3.5" width="2.5" height="9" rx="0.5"/>
      <rect x="9" y="3.5" width="2.5" height="9" rx="0.5"/>
    </svg>
  ),
  play: (p={}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M5 3.5v9l8-4.5z"/>
    </svg>
  ),
  x: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...p}>
      <path d="M4 4l8 8M12 4l-8 8"/>
    </svg>
  ),
  retry: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 3v3h3"/>
    </svg>
  ),
  folder: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...p}>
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z"/>
    </svg>
  ),
  link: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M7 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L8 5"/>
      <path d="M9 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5L8 11"/>
    </svg>
  ),
  tag: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...p}>
      <path d="M2 2v6l6 6 6-6-6-6H2z"/><circle cx="5" cy="5" r="0.8" fill="currentColor"/>
    </svg>
  ),
  check: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 8.5L6.5 12 13 5"/>
    </svg>
  ),
  scissors: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/>
      <path d="M14 3L6 8l8 5"/><path d="M6 8l3 1.8"/>
    </svg>
  ),
  yt: (p={}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2"/><path d="M7 6.5v3l3-1.5z" fill="currentColor"/>
    </svg>
  ),
  x_logo: (p={}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M11.7 2H14l-4.8 5.5L14.5 14H10l-3.5-4.4L2.5 14H.2l5.2-6L.5 2h4.6l3.1 4zM11 12.7h1.3L4.5 3.2H3.1z"/>
    </svg>
  ),
};

/* ---- Top app bar (chrome + bar) ---- */
function AppChrome({ title }) {
  return (
    <div className="chrome">
      <div className="traffic"><span></span><span></span><span></span></div>
      <div className="chrome-title">{title || 'Media Hub'}</div>
    </div>
  );
}

function ActiveProject({ name = 'Library', sub = 'No active project', icon = 'lib' }) {
  const isProj = icon === 'proj';
  return (
    <div className={'proj-picker ' + (isProj ? 'proj' : 'lib')}>
      <span className="dot"></span>
      <div className="col" style={{lineHeight:1.15, gap:2}}>
        <span className="label">{isProj ? 'Active project' : 'Active'}</span>
        <span className="name">{name}</span>
      </div>
      <span className="chev"><I.chev width="10" height="10"/></span>
    </div>
  );
}

function TopBar({ project = null }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark"></div>
        <div className="brand-name">media·hub</div>
        <div className="brand-build">0.4.1</div>
      </div>
      {project
        ? <ActiveProject name={project.name} icon="proj"/>
        : <ActiveProject name="Library" icon="lib"/>
      }
      <div className="topbar-spacer"></div>
      <div className="topbar-search">
        <I.search width="13" height="13"/>
        <span>Search everything…</span>
        <span className="kbd">⌘ K</span>
      </div>
      <div className="topbar-icons">
        <div className="ic-btn"><I.settings width="14" height="14"/></div>
      </div>
    </div>
  );
}

/* ---- Left nav ---- */
function Nav({ active, project = null }) {
  return (
    <nav className="nav">
      <div className="nav-section">Workspace</div>
      <div className={'nav-item' + (active==='download'?' active':'')}>
        <I.download className="ico" width="14" height="14"/>
        <span>Download</span>
        <span className="kbd">1</span>
      </div>
      <div className={'nav-item' + (active==='library'?' active':'')}>
        <I.library className="ico" width="14" height="14"/>
        <span>Library</span>
        <span className="count">2,418</span>
      </div>
      <div className={'nav-item' + (active==='projects'?' active':'')}>
        <I.projects className="ico" width="14" height="14"/>
        <span>Projects</span>
        <span className="count">6</span>
      </div>

      <div className="nav-section">Projects</div>
      <div className={'nav-sub' + (project==='kestrel'?' active':'')}>
        <span className="pdot"></span><span>Kestrel · Ep 04</span>
        <span className="count">142</span>
      </div>
      <div className="nav-sub">
        <span className="pdot"></span><span>Q3 Brand Spots</span>
        <span className="count">38</span>
      </div>
      <div className="nav-sub">
        <span className="pdot"></span><span>Field Notes</span>
        <span className="count">87</span>
      </div>
      <div className="nav-sub">
        <span className="pdot"></span><span>Reels — May</span>
        <span className="count">24</span>
      </div>
      <div className="nav-sub muted">
        <I.plus width="12" height="12"/>
        <span>New project</span>
        <span className="kbd" style={{marginLeft:'auto'}}>⌘ N</span>
      </div>

      <div className="nav-section">System</div>
      <div className={'nav-item' + (active==='settings'?' active':'')}>
        <I.settings className="ico" width="14" height="14"/>
        <span>Settings</span>
        <span className="kbd">,</span>
      </div>

      <div className="nav-foot">
        <span className="stat-dot"></span>
        <span>yt-dlp 2025.05.14</span>
        <span style={{marginLeft:'auto'}} className="faint mono">412 GB free</span>
      </div>
    </nav>
  );
}

Object.assign(window, { I, AppChrome, TopBar, Nav, ActiveProject });
