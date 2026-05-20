/* ============================================================
   PROJECT SCREEN — like Library but with project chrome + Finish action
   ============================================================ */

const projCss = `
.proj-header {
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-0);
  display:flex; align-items:flex-end; gap: 18px;
}
.proj-header .left { display:flex; flex-direction:column; gap: 6px; }
.proj-header .crumb { font-size: 12px; color: var(--text-2); display:flex; align-items:center; gap:6px; font-family: var(--mono); }
.proj-header h1 {
  margin: 0;
  font-size: 22px; letter-spacing: -0.02em; font-weight: 600;
  color: var(--text-0);
  display:flex; align-items:center; gap:10px;
}
.proj-header h1 .pdot { width:8px; height:8px; border-radius:50%; background:var(--accent); }
.proj-header .meta {
  display:flex; gap: 16px; margin-top: 4px;
  font-family: var(--mono); font-size: 11.5px; color: var(--text-2);
}
.proj-header .meta b { color: var(--text-0); font-weight:500; }
.proj-header .right {
  margin-left: auto;
  display:flex; align-items:center; gap: 8px;
}
.proj-header .stats {
  display:grid; grid-template-columns: repeat(4, auto); gap: 22px;
  margin-right: 12px;
}
.proj-header .stat .v { font-family: var(--mono); font-size: 18px; color: var(--text-0); font-weight:500; line-height:1; }
.proj-header .stat .l { font-size: 10.5px; color: var(--text-3); text-transform:uppercase; letter-spacing:0.08em; margin-top:6px; font-family: var(--mono); }

.proj-footer-info {
  display:flex; align-items:center; gap: 14px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-1);
  font-size: 11.5px; color: var(--text-2);
}
.proj-footer-info .path {
  font-family: var(--mono); color: var(--text-1);
}
`;

if (!document.getElementById('proj-css')) {
  const s = document.createElement('style'); s.id='proj-css'; s.textContent=projCss; document.head.appendChild(s);
}

/* A different, smaller card set — feels like a working project */
const PROJ_CARDS = [
  { dur:'12:47', src:'YT', title:'Forest lighting — golden hour walkthrough', ch:'Field Optics · trim 01:24–09:12', tags:[['amber','HERO']], isNew:false },
  { dur:'27:02', src:'YT', title:'Layered ambience approach — full lecture', ch:'Sound & Picture', tags:[['dot','audio','t'], ['dot','reference','p']]},
  { dur:'3:18',  src:'X',  title:'Drone B-roll — coastline at dawn', ch:'@cinemartin', tags:[['dot','b-roll','y']]},
  { dur:'2:14',  src:'YT', title:'Mist & atmosphere — practical haze in forest scenes', ch:'Field Optics', tags:[['dot','technique','y']]},
  { dur:'6:24',  src:'YT', title:'Field recording: forest ambience, dawn chorus', ch:'Marc Cousins', tags:[['amber','SELECTED']]},
  { dur:'8:15',  src:'YT', title:'Lens choices for night exteriors', ch:'Cinema Underground', tags:[['dot','reference','p']]},
  { dur:'15:30', src:'YT', title:'Color grading log footage — ACES vs. DaVinci YRGB', ch:'Cullen Kelly', tags:[['dot','color','r']]},
  { dur:'1:42',  src:'X',  title:'Quick rotoscope tip for hairline edges', ch:'@vfxtuts', tags:[['dot','vfx','b']]},
  { dur:'4:32',  src:'YT', title:'Slider work — smooth horizontal moves', ch:'Wandering DP', tags:[['dot','technique','y']]},
  { dur:'19:55', src:'YT', title:'Editing rhythm — when to cut on motion', ch:'This Guy Edits', tags:[['dot','editing','b']]},
  { dur:'0:58',  src:'X',  title:'Anamorphic flare comparison — Atlas vs. SLR Magic', ch:'@lenslab', tags:[['dot','lenses','b']]},
  { dur:'2:08',  src:'X',  title:'BTS — practical lighting for interview setup', ch:'@bts_archive', tags:[['dot','bts','y']]},
];

function ProjectScreen() {
  return (
    <div className="mh">
      <AppChrome title="Media Hub — Kestrel · Ep 04"/>
      <TopBar project={{name:'Kestrel · Ep 04'}}/>
      <div className="main">
        <Nav active="projects" project="kestrel"/>
        <div className="content">

          <div className="proj-header">
            <div className="left">
              <div className="crumb">
                <I.projects width="11" height="11"/>
                <span>Projects</span>
                <I.chevR width="9" height="9" style={{color:'var(--text-3)'}}/>
                <span>Kestrel</span>
                <I.chevR width="9" height="9" style={{color:'var(--text-3)'}}/>
                <span>Ep 04 — The Treeline</span>
              </div>
              <h1>
                <span className="pdot"></span>
                Kestrel · Ep 04 — The Treeline
              </h1>
              <div className="meta">
                <span>Created <b>Apr 22</b></span>
                <span>·</span>
                <span>Deadline <b style={{color:'var(--accent)'}}>Jun 02</b> (14 days)</span>
                <span>·</span>
                <span>Folder <b>~/edits/kestrel/ep04</b></span>
              </div>
            </div>

            <div className="right">
              <div className="stats">
                <div className="stat"><div className="v">142</div><div className="l">Clips</div></div>
                <div className="stat"><div className="v">38.4 <span className="faint" style={{fontSize:11}}>GB</span></div><div className="l">Size</div></div>
                <div className="stat"><div className="v">02:14:08</div><div className="l">Total</div></div>
                <div className="stat"><div className="v" style={{color:'var(--accent)'}}>12</div><div className="l">Untagged</div></div>
              </div>
              <div className="ch-btn"><I.tag width="11" height="11"/> Tag <span className="kbd">T</span></div>
              <div className="ch-btn"><I.folder width="11" height="11"/> Reveal in Finder</div>
              <div className="ch-btn primary"><I.check width="12" height="12"/> Finish project</div>
            </div>
          </div>

          <div className="proj-footer-info">
            <span className="mono faint" style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em'}}>Exports to</span>
            <span className="path">~/edits/kestrel/ep04/footage/</span>
            <span>·</span>
            <span>DaVinci Resolve · proxies <b className="strong">on</b></span>
            <span>·</span>
            <span>Auto-add new downloads <b className="strong">ON</b></span>
            <span style={{marginLeft:'auto'}} className="muted">Last activity 8 min ago</span>
          </div>

          <div className="lib-wrap">
            <aside className="lib-side">
              <div className="lib-side-head">Filters</div>
              <div className="lib-side-search">
                <div className="field-input" style={{height:26}}>
                  <I.search width="12" height="12" style={{color:'var(--text-2)'}}/>
                  <span style={{fontFamily:'var(--sans)', color:'var(--text-2)'}}>Filter project…</span>
                </div>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Bin</span>
                  <span className="count">4</span>
                </div>
                <Facet active label="All clips" count="142"/>
                <Facet label="Selected for edit" count="38"/>
                <Facet label="Reference" count="64"/>
                <Facet label="Audio" count="29"/>
                <Facet label="Untagged" count="12"/>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Status</span>
                </div>
                <Facet dot color="oklch(0.78 0.13 75)" label="Hero" count="6"/>
                <Facet dot color="#7ad27a" label="Approved" count="42"/>
                <Facet dot color="#7ab2e5" label="On the fence" count="22"/>
                <Facet dot color="#e35a5a" label="Reject" count="14"/>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Tags</span>
                  <span className="count">12</span>
                </div>
                <Facet dot color="oklch(0.78 0.13 75)" label="b-roll" count="56"/>
                <Facet dot color="#7ae5d2" label="audio" count="29"/>
                <Facet dot color="#c87ae5" label="reference" count="34"/>
                <Facet dot color="#e5c87a" label="technique" count="18"/>
                <div className="facet muted"><span style={{width:12}}></span><span className="label">+ 8 more…</span></div>
              </div>
            </aside>

            <div className="lib-main">
              <div className="lib-toolbar">
                <div className="lib-search">
                  <I.search width="13" height="13" style={{color:'var(--text-2)'}}/>
                  <span className="ph">Search within project…</span>
                  <span className="kbd">/</span>
                </div>
                <span className="mono faint" style={{fontSize:11}}>Sort:</span>
                <div className="ch-btn">Status, then added <I.chev width="10" height="10"/></div>
                <div className="ch-tabs">
                  <div className="ch-tab active"><I.grid width="11" height="11"/></div>
                  <div className="ch-tab"><I.list width="12" height="12"/></div>
                </div>
                <div className="ch-spacer"></div>
                <span className="mono muted" style={{fontSize:11}}>142 clips</span>
                <div className="ic-btn"><I.more width="14" height="14"/></div>
              </div>

              <div className="lib-grid-scroll">
                <div className="lib-grid">
                  {PROJ_CARDS.map((c, i) => (
                    <LibCard key={i} data={c} selected={i===0 || i===4}/>
                  ))}
                </div>
              </div>

              <div className="lib-status">
                <span>2 selected</span>
                <span className="sep">·</span>
                <span>418 MB</span>
                <span className="sep">·</span>
                <span>combined 19:11</span>
                <div className="right">
                  <span><span className="kbd">␣</span> preview</span>
                  <span><span className="kbd">E</span> export to edit</span>
                  <span><span className="kbd">1–5</span> rate</span>
                  <span><span className="kbd">T</span> tag</span>
                  <span><span className="kbd">⌘ ⌫</span> remove from project</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ProjectScreen = ProjectScreen;
