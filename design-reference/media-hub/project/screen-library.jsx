/* ============================================================
   LIBRARY (grid) SCREEN
   ============================================================ */

const libCss = `
.lib-wrap { flex:1; display:flex; min-height:0; }

/* Filter sidebar */
.lib-side {
  width: 224px; flex: 0 0 224px;
  border-right: 1px solid var(--line);
  background: var(--bg-1);
  display:flex; flex-direction:column;
  overflow:auto;
}
.lib-side-head {
  height: 32px; padding: 0 14px;
  display:flex; align-items:center;
  font-family: var(--mono); font-size:10px;
  color: var(--text-3); text-transform:uppercase; letter-spacing:0.08em;
  border-bottom: 1px solid var(--line);
}
.lib-side-search {
  padding: 10px;
  border-bottom: 1px solid var(--line);
}
.lib-side-search .field-input { height:26px; font-family: var(--sans); font-size:12px; }
.lib-group {
  padding: 10px 8px 6px;
}
.lib-group-title {
  display:flex; align-items:center; gap:6px;
  font-family: var(--mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-3);
  padding: 0 6px 4px;
}
.lib-group-title .count { margin-left:auto; }
.lib-group-title .chev { color: var(--text-3); }
.facet {
  display:flex; align-items:center; gap:8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-1);
  cursor:pointer;
}
.facet:hover { background: var(--bg-2); color: var(--text-0); }
.facet.active { background: var(--bg-3); color: var(--text-0); }
.facet .box {
  width:12px; height:12px; border-radius:2px;
  border:1px solid var(--line-hi);
  background: var(--bg-2);
  display:grid; place-items:center;
  flex:0 0 12px;
}
.facet.active .box {
  background: var(--accent); border-color: var(--accent);
  color: #0d0d0f;
}
.facet .label { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.facet .dot { width:8px; height:8px; border-radius:50%; }
.facet .ct { font-family: var(--mono); font-size: 11px; color: var(--text-3); }

/* Main */
.lib-main { flex:1; display:flex; flex-direction:column; min-width:0; }
.lib-toolbar {
  height: 40px; flex:0 0 40px;
  border-bottom: 1px solid var(--line);
  display:flex; align-items:center;
  padding: 0 14px;
  gap: 10px;
}
.lib-search {
  flex: 1; max-width: 380px;
  height: 28px;
  background: var(--bg-2);
  border:1px solid var(--line-hi);
  border-radius: 5px;
  display:flex; align-items:center; gap:8px;
  padding: 0 10px;
  font-size: 12.5px;
  color: var(--text-0);
}
.lib-search .ph { color: var(--text-2); }
.lib-search .kbd { margin-left:auto; }
.crumbs { display:flex; align-items:center; gap:8px; font-size:12px; color: var(--text-2); }
.crumbs .now { color: var(--text-0); font-weight:500; }
.crumbs .ct { font-family: var(--mono); color: var(--text-3); }

.lib-active-filters {
  display:flex; align-items:center; gap:8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-0);
  font-size: 12px;
  color: var(--text-2);
}

/* Grid */
.lib-grid-scroll { flex:1; overflow:auto; padding: 14px; }
.lib-grid {
  display:grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.card {
  background: var(--bg-1);
  border:1px solid var(--line);
  border-radius: 6px;
  overflow:hidden;
  display:flex; flex-direction:column;
  cursor:pointer;
}
.card:hover { border-color: var(--line-hi); background: var(--bg-2); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.card .thumb { aspect-ratio: 16/9; border-radius:0; border-left:none; border-right:none; border-top:none;}
.card .info { padding: 8px 10px 10px; display:flex; flex-direction:column; gap:6px; min-width:0; }
.card .title {
  font-size: 12.5px; color: var(--text-0); font-weight:500; line-height:1.3;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
  overflow:hidden;
}
.card .sub {
  display:flex; align-items:center; gap:8px;
  font-size: 11px; color: var(--text-2); font-family: var(--mono);
  min-width:0;
}
.card .sub .ch {
  flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.card .tags { display:flex; gap:4px; flex-wrap:wrap; }

/* Status footer */
.lib-status {
  height: 26px; flex: 0 0 26px;
  border-top: 1px solid var(--line);
  background: var(--bg-1);
  display:flex; align-items:center;
  padding: 0 14px;
  font-family: var(--mono); font-size: 11px; color: var(--text-2);
  gap: 14px;
}
.lib-status .sep { color: var(--text-3); }
.lib-status .right { margin-left:auto; display:flex; gap:14px; }
`;

if (!document.getElementById('lib-css')) {
  const s = document.createElement('style'); s.id='lib-css'; s.textContent=libCss; document.head.appendChild(s);
}

function Facet({ active=false, label, count, dot, color }) {
  return (
    <div className={'facet' + (active?' active':'')}>
      <span className="box">{active && <I.check width="10" height="10"/>}</span>
      {dot && <span className="dot" style={{background:color}}></span>}
      <span className="label">{label}</span>
      <span className="ct">{count}</span>
    </div>
  );
}

const SAMPLE_CARDS = [
  { dur:'12:47', src:'YT', title:'How aerial cinematographers light a forest at golden hour', ch:'Field Optics', tags:[['amber','b-roll'], ['dot','golden hour']], isNew:true },
  { dur:'3:18',  src:'X',  title:'Drone B-roll — coastline at dawn (Sony FX3)', ch:'@cinemartin', tags:[['dot','aerial','b']]},
  { dur:'27:02', src:'YT', title:'Sound design for documentary: the layered ambience approach', ch:'Sound & Picture', tags:[['dot','tutorial','p'], ['dot','audio','t']]},
  { dur:'1:42',  src:'X',  title:'Quick rotoscope tip for hairline edges', ch:'@vfxtuts', tags:[['dot','vfx','b']]},
  { dur:'8:15',  src:'YT', title:'Lens choices for night exteriors — comparison reel', ch:'Cinema Underground', tags:[['dot','reference','p']]},
  { dur:'0:47',  src:'X',  title:'Hand-held to gimbal transition — practical method', ch:'@gripcraft', tags:[['dot','technique','y']], isNew:true },
  { dur:'15:30', src:'YT', title:'Color grading log footage from start to finish', ch:'Cullen Kelly', tags:[['dot','color','r']]},
  { dur:'6:24',  src:'YT', title:'Field recording: forest ambience, dawn chorus', ch:'Marc Cousins', tags:[['dot','audio','t'], ['dot','nature','g']]},
  { dur:'2:08',  src:'X',  title:'On-set behind the scenes — practical lighting for interview', ch:'@bts_archive', tags:[['dot','bts','y']]},
  { dur:'19:55', src:'YT', title:'Editing rhythm — when to cut on motion vs. emotion', ch:'This Guy Edits', tags:[['dot','editing','b']]},
  { dur:'4:32',  src:'YT', title:'Slider work — smooth horizontal moves on uneven ground', ch:'Wandering DP', tags:[['dot','technique','y']]},
  { dur:'0:58',  src:'X',  title:'Anamorphic flare comparison — Atlas vs. SLR Magic', ch:'@lenslab', tags:[['dot','lenses','b']]},
];

function LibCard({ data, selected=false }) {
  return (
    <div className={'card' + (selected?' selected':'')}>
      <div className="thumb">
        <span className="src">{data.src === 'YT' ? <I.yt width="9" height="9" style={{verticalAlign:'-1px'}}/> : <I.x_logo width="8" height="8"/>} {data.src}</span>
        {data.isNew && <span className="new">NEW</span>}
        <span className="dur">{data.dur}</span>
      </div>
      <div className="info">
        <div className="title">{data.title}</div>
        <div className="sub">
          <span className="ch">{data.ch}</span>
          <span>·</span>
          <span>1080p</span>
        </div>
        <div className="tags">
          {data.tags.map((t, i) =>
            t[0] === 'amber'
              ? <span key={i} className="tag amber">★ {t[1]}</span>
              : <span key={i} className={'tag dot ' + (t[2]||'')}>{t[1]}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LibraryScreen() {
  return (
    <div className="mh">
      <AppChrome title="Media Hub — Library"/>
      <TopBar />
      <div className="main">
        <Nav active="library"/>
        <div className="content">
          <div className="content-header">
            <div className="crumbs">
              <span className="now">Library</span>
              <span className="ct">2,418 clips · 218 GB</span>
            </div>
            <div className="ch-spacer"></div>
            <div className="ch-tabs">
              <div className="ch-tab active"><I.grid width="11" height="11"/> Grid</div>
              <div className="ch-tab"><I.list width="12" height="12"/> List</div>
            </div>
            <div className="ch-btn"><I.tag width="11" height="11"/> Tag <span className="kbd">T</span></div>
            <div className="ch-btn"><I.folder width="11" height="11"/> Export <span className="kbd">⌘ E</span></div>
            <div className="ch-btn primary"><I.download width="12" height="12"/> Download</div>
          </div>

          <div className="lib-wrap">
            <aside className="lib-side">
              <div className="lib-side-head">Filters</div>
              <div className="lib-side-search">
                <div className="field-input" style={{height:26}}>
                  <I.search width="12" height="12" style={{color:'var(--text-2)'}}/>
                  <span style={{fontFamily:'var(--sans)', color:'var(--text-2)'}}>Filter tags…</span>
                </div>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Source</span>
                  <span className="count">2</span>
                </div>
                <Facet active label="YouTube" count="1,842"/>
                <Facet label="Twitter / X" count="576"/>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Tags</span>
                  <span className="count">24</span>
                </div>
                <Facet active dot color="oklch(0.78 0.13 75)" label="b-roll" count="412"/>
                <Facet dot color="#7ab2e5" label="aerial" count="98"/>
                <Facet dot color="#c87ae5" label="tutorial" count="284"/>
                <Facet active dot color="#7ae5d2" label="audio" count="167"/>
                <Facet dot color="#e35a5a" label="color" count="76"/>
                <Facet dot color="#7ad27a" label="nature" count="143"/>
                <Facet dot color="#e5c87a" label="technique" count="221"/>
                <Facet dot color="#7ab2e5" label="vfx" count="58"/>
                <div className="facet muted"><span style={{width:12}}></span><span className="label">+ 16 more…</span></div>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Resolution</span>
                </div>
                <Facet label="4K · UHD" count="412"/>
                <Facet active label="1080p" count="1,594"/>
                <Facet label="720p &amp; below" count="412"/>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Added</span>
                </div>
                <Facet label="Today" count="14"/>
                <Facet label="This week" count="92"/>
                <Facet label="This month" count="318"/>
                <Facet label="Older" count="1,994"/>
              </div>

              <div className="lib-group">
                <div className="lib-group-title">
                  <I.chev className="chev" width="10" height="10"/>
                  <span>Duration</span>
                </div>
                <Facet label="&lt; 1 min" count="284"/>
                <Facet label="1–5 min" count="612"/>
                <Facet label="5–20 min" count="884"/>
                <Facet label="&gt; 20 min" count="638"/>
              </div>
            </aside>

            <div className="lib-main">
              <div className="lib-toolbar">
                <div className="lib-search">
                  <I.search width="13" height="13" style={{color:'var(--text-2)'}}/>
                  <span>golden hour</span>
                  <span className="caret" style={{width:1, height:13, background:'var(--accent)', display:'inline-block'}}></span>
                  <span className="kbd">/</span>
                </div>
                <span className="mono faint" style={{fontSize:11}}>Sort:</span>
                <div className="ch-btn">Date added <I.chev width="10" height="10"/></div>
                <div className="ch-spacer"></div>
                <span className="mono muted" style={{fontSize:11}}>247 of 2,418</span>
                <div className="ic-btn"><I.more width="14" height="14"/></div>
              </div>

              <div className="lib-active-filters">
                <span className="mono faint" style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em'}}>Filters</span>
                <span className="tag amber">★ b-roll <I.x className="x" width="9" height="9"/></span>
                <span className="tag dot t">audio <I.x className="x" width="9" height="9"/></span>
                <span className="tag">YouTube <I.x className="x" width="9" height="9"/></span>
                <span className="tag">1080p <I.x className="x" width="9" height="9"/></span>
                <span style={{marginLeft:'auto'}} className="muted">Clear all <span className="kbd">esc</span></span>
              </div>

              <div className="lib-grid-scroll">
                <div className="lib-grid">
                  {SAMPLE_CARDS.map((c, i) => (
                    <LibCard key={i} data={c} selected={i===0}/>
                  ))}
                </div>
              </div>

              <div className="lib-status">
                <span>1 selected</span>
                <span className="sep">·</span>
                <span>312 MB</span>
                <span className="sep">·</span>
                <span>YouTube · 1080p · 12:47</span>
                <div className="right">
                  <span><span className="kbd">␣</span> preview</span>
                  <span><span className="kbd">E</span> export</span>
                  <span><span className="kbd">T</span> tag</span>
                  <span><span className="kbd">⌫</span> delete</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.LibraryScreen = LibraryScreen;
