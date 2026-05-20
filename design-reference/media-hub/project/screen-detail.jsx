/* ============================================================
   ASSET DETAIL SCREEN
   ============================================================ */

const detCss = `
.det-wrap { flex:1; display:flex; min-height:0; }

/* Left strip — related clips in same context */
.det-strip {
  width: 64px; flex: 0 0 64px;
  background: var(--bg-1);
  border-right: 1px solid var(--line);
  padding: 8px 6px;
  display:flex; flex-direction:column; gap:6px;
  overflow:auto;
}
.det-strip-thumb {
  width: 52px; height: 30px; border-radius: 3px;
  position:relative; cursor:pointer;
}
.det-strip-thumb.active { box-shadow: 0 0 0 1.5px var(--accent); }
.det-strip-thumb .num {
  position:absolute; top:2px; left:3px;
  font-family: var(--mono); font-size: 9px;
  color: var(--text-2);
}

/* Main detail */
.det-main { flex:1; display:flex; flex-direction:column; min-width:0; }

.det-player-wrap {
  background: #000;
  padding: 16px;
  border-bottom: 1px solid var(--line);
  display:flex; gap: 18px;
}
.det-player {
  flex: 1;
  background: #000;
  position:relative;
  border-radius: 4px;
  overflow:hidden;
  aspect-ratio: 16 / 9;
  max-height: 460px;
  background:
    repeating-linear-gradient(135deg, #0a0a0c 0 14px, #07070a 14px 28px);
  border:1px solid #1c1c20;
  display:flex; align-items:center; justify-content:center;
  color: var(--text-3);
  font-family: var(--mono); font-size:11px;
}
.det-player .play-overlay {
  width: 56px; height: 56px; border-radius:50%;
  background: rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.12);
  display:grid; place-items:center;
  color: rgba(255,255,255,0.7);
}
.det-player .tc-tl {
  position:absolute; top:10px; left:12px;
  font-family: var(--mono); font-size:11px; color:rgba(255,255,255,0.6);
  background: rgba(0,0,0,0.5);
  padding: 2px 6px; border-radius: 3px;
}
.det-player .tc-tr {
  position:absolute; top:10px; right:12px;
  font-family: var(--mono); font-size:11px; color:rgba(255,255,255,0.6);
  background: rgba(0,0,0,0.5);
  padding: 2px 6px; border-radius: 3px;
}
.det-transport {
  position:absolute; left:0; right:0; bottom:0;
  background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0));
  padding: 10px 12px 8px;
  display:flex; flex-direction:column; gap: 6px;
}
.det-scrub {
  height: 24px; position:relative;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
}
.det-scrub .played {
  position:absolute; left:0; top:0; bottom:0;
  background: rgba(255,255,255,0.18);
  width: 38%;
}
.det-scrub .in-out {
  position:absolute; top:0; bottom:0;
  background: var(--accent-dim);
  border-left: 2px solid var(--accent);
  border-right: 2px solid var(--accent);
  left: 11%; right: 28%;
}
.det-scrub .head {
  position:absolute; top:-2px; bottom:-2px; width:2px;
  background: #fff;
  left: 38%;
}
.det-transport-row {
  display:flex; align-items:center; gap: 14px;
  font-family: var(--mono); font-size: 11px; color: rgba(255,255,255,0.7);
}
.det-transport-row .t-btns { display:flex; gap: 4px; }
.det-transport-row .t-btn {
  width: 24px; height:24px; border-radius: 4px;
  display:grid; place-items:center;
  color: rgba(255,255,255,0.7); cursor:pointer;
}
.det-transport-row .t-btn.primary { background: rgba(255,255,255,0.95); color: #000; }
.det-transport-row .t-btn:hover { background: rgba(255,255,255,0.1); }

/* Inspector right */
.det-side {
  width: 320px; flex: 0 0 320px;
  background: var(--bg-1);
  border-left: 1px solid var(--line);
  display:flex; flex-direction:column;
  overflow:auto;
}
.det-side-section {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  display:flex; flex-direction:column; gap:8px;
}
.det-side-h {
  font-family: var(--mono); font-size: 10px; color: var(--text-3);
  text-transform:uppercase; letter-spacing:0.08em;
  display:flex; align-items:center; gap:6px;
}
.det-side-h .ct { margin-left:auto; color: var(--text-3); }
.det-row {
  display:flex; align-items:flex-start; gap: 12px;
  font-size: 12px;
}
.det-row .k { width: 86px; flex: 0 0 86px; color: var(--text-2); font-family: var(--mono); font-size: 11px; }
.det-row .v { color: var(--text-0); font-family: var(--mono); font-size: 11.5px; word-break:break-word; min-width:0; flex:1; }
.det-row .v a { color: var(--accent); }

.det-title {
  font-size: 16px; font-weight: 600; color: var(--text-0);
  letter-spacing: -0.005em; line-height: 1.3;
}
.det-channel {
  display:flex; align-items:center; gap: 8px;
  font-size: 12px; color: var(--text-1);
}
.det-channel .av {
  width: 22px; height:22px; border-radius:50%;
  background: var(--bg-3); border:1px solid var(--line);
  font-family: var(--mono); font-size:11px;
  display:grid; place-items:center;
  color: var(--text-1);
}

.det-tag-editor {
  display:flex; flex-wrap:wrap; gap:5px;
  padding: 6px; border-radius: 5px;
  background: var(--bg-2);
  border:1px solid var(--line-hi);
}
.det-tag-editor .tag .x { cursor: pointer; }
.det-tag-editor input {
  flex:1; min-width: 80px;
  background:transparent; border:0; outline:0;
  color: var(--text-0); font-size:12px;
  padding: 2px 4px;
  font-family: var(--mono);
}

.det-actions {
  display:flex; flex-direction:column; gap:6px;
}
.det-action-btn {
  height: 30px; padding: 0 10px;
  background: var(--bg-2);
  border:1px solid var(--line-hi);
  border-radius: 5px;
  display:flex; align-items:center; gap:10px;
  color: var(--text-0); font-size: 12.5px;
  cursor:pointer;
}
.det-action-btn:hover { background: var(--bg-3); }
.det-action-btn .ic { color: var(--text-2); flex: 0 0 14px; }
.det-action-btn .kbd { margin-left:auto; }
.det-action-btn.primary {
  background: var(--accent); border-color: var(--accent); color: #0d0d0f;
  font-weight: 500;
}
.det-action-btn.primary .ic { color: rgba(0,0,0,0.6); }
.det-action-btn.primary .kbd { background:rgba(0,0,0,.15); color:rgba(0,0,0,0.65); border-color:rgba(0,0,0,.18); }

.det-marker {
  display:flex; align-items:center; gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.det-marker:hover { background: var(--bg-2); }
.det-marker .tc {
  font-family: var(--mono); font-size: 11px; color: var(--accent);
  width: 64px; flex: 0 0 64px;
}
.det-marker .lbl { flex:1; color: var(--text-1); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.det-marker .kbd { color: var(--text-3); }

/* Chapters */
.det-chapter {
  display:flex; align-items:center; gap: 10px;
  padding: 5px 8px; border-radius: 4px; font-size: 12px;
}
.det-chapter:hover { background: var(--bg-2); }
.det-chapter .tc { font-family: var(--mono); font-size:11px; color: var(--text-2); width: 56px; flex:0 0 56px; }
.det-chapter .lbl { color: var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.det-chapter.active { background: var(--bg-3); }
.det-chapter.active .lbl { color: var(--text-0); }
.det-chapter.active .tc { color: var(--accent); }
`;

if (!document.getElementById('det-css')) {
  const s = document.createElement('style'); s.id='det-css'; s.textContent=detCss; document.head.appendChild(s);
}

function DetailScreen() {
  return (
    <div className="mh">
      <AppChrome title="Media Hub — Asset detail"/>
      <TopBar project={{name:'Kestrel · Ep 04'}}/>
      <div className="main">
        <Nav active="projects" project="kestrel"/>
        <div className="content">

          <div className="content-header">
            <div className="crumbs">
              <span><I.projects width="11" height="11" style={{verticalAlign:'-1px', color:'var(--text-2)'}}/> </span>
              <span className="muted">Kestrel</span>
              <I.chevR width="10" height="10" style={{color:'var(--text-3)'}}/>
              <span className="muted">Ep 04</span>
              <I.chevR width="10" height="10" style={{color:'var(--text-3)'}}/>
              <span className="now">forest_lighting_01</span>
              <span className="ct">· clip 18 of 142</span>
            </div>
            <div className="ch-spacer"></div>
            <div className="ch-btn ghost"><I.chev width="11" height="11" style={{transform:'rotate(90deg)'}}/> Prev <span className="kbd">J</span></div>
            <div className="ch-btn ghost">Next <span className="kbd">K</span> <I.chev width="11" height="11" style={{transform:'rotate(-90deg)'}}/></div>
            <div className="ch-btn"><I.tag width="11" height="11"/> Tag <span className="kbd">T</span></div>
            <div className="ch-btn primary"><I.folder width="12" height="12"/> Export to edit <span className="kbd">⌘ E</span></div>
          </div>

          <div className="det-wrap">
            <div className="det-strip">
              {[17,18,19,20,21,22,23,24,25,26].map((n, i) => (
                <div key={n} className={'det-strip-thumb thumb' + (n===18?' active':'')}>
                  <span className="num">{n}</span>
                </div>
              ))}
            </div>

            <div className="det-main">
              <div className="det-player-wrap">
                <div className="det-player">
                  <span className="tc-tl">01:24:500 / 12:47:000</span>
                  <span className="tc-tr">1920 × 1080 · 23.976</span>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:10}}>
                    <div className="play-overlay"><I.play width="20" height="20"/></div>
                    <div className="mono">preview · click to play <span className="kbd">␣</span></div>
                  </div>

                  <div className="det-transport">
                    <div className="det-scrub">
                      <div className="played"></div>
                      <div className="in-out"></div>
                      <div className="head"></div>
                    </div>
                    <div className="det-transport-row">
                      <div className="t-btns">
                        <div className="t-btn"><I.chev width="11" height="11" style={{transform:'rotate(90deg)'}}/></div>
                        <div className="t-btn primary"><I.play width="12" height="12"/></div>
                        <div className="t-btn"><I.chev width="11" height="11" style={{transform:'rotate(-90deg)'}}/></div>
                      </div>
                      <span style={{color:'#fff'}}>04:51.200</span>
                      <span>/ 12:47.000</span>
                      <div style={{flex:1}}></div>
                      <span style={{color:'var(--accent)'}}>IN 01:24.500</span>
                      <span style={{color:'var(--accent)'}}>OUT 09:12.000</span>
                      <span>· 07:47.500 trim</span>
                      <div style={{flex:1}}></div>
                      <span>1×</span>
                      <span>0 dB</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chapters & markers row below player */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, borderBottom:'1px solid var(--line)'}}>
                <div style={{padding:'10px 14px', borderRight:'1px solid var(--line)'}}>
                  <div className="det-side-h" style={{marginBottom:6}}>
                    <span>Chapters</span><span className="ct">6</span>
                  </div>
                  <div className="det-chapter"><span className="tc">00:00</span><span className="lbl">Intro &amp; gear overview</span></div>
                  <div className="det-chapter active"><span className="tc">01:24</span><span className="lbl">Scouting the treeline — light direction</span></div>
                  <div className="det-chapter"><span className="tc">04:08</span><span className="lbl">Bounce vs. negative fill in dense canopy</span></div>
                  <div className="det-chapter"><span className="tc">07:32</span><span className="lbl">Practical haze and atmosphere</span></div>
                  <div className="det-chapter"><span className="tc">09:12</span><span className="lbl">Camera settings — ISO, shutter, ND</span></div>
                  <div className="det-chapter"><span className="tc">11:40</span><span className="lbl">Wrap-up &amp; outtakes</span></div>
                </div>
                <div style={{padding:'10px 14px'}}>
                  <div className="det-side-h" style={{marginBottom:6}}>
                    <span>Your markers</span><span className="ct">3 · <span className="kbd">M</span> to add</span>
                  </div>
                  <div className="det-marker"><span className="tc">02:18</span><span className="lbl">crane shot — possible opener</span></div>
                  <div className="det-marker"><span className="tc">05:42</span><span className="lbl">use this quote for VO over treeline</span></div>
                  <div className="det-marker"><span className="tc">08:31</span><span className="lbl">silhouette frame — title card BG?</span></div>
                </div>
              </div>

              {/* Description row */}
              <div style={{padding:'14px 18px', flex:1, overflow:'auto'}}>
                <div className="det-side-h" style={{marginBottom:8}}>
                  <span>Description</span>
                  <span className="ct">from source</span>
                </div>
                <p style={{margin:0, fontSize:12.5, color:'var(--text-1)', lineHeight:1.6, maxWidth:780}}>
                  A working session on how aerial cinematographers approach a forest at golden hour — what to look for in a scout, how to read the light through canopy, and the practical tricks (bounces, hazers, ND choices) that translate from controlled stages to real-world exteriors. Recorded on location in the Pacific Northwest, May 2026.
                </p>
                <div style={{marginTop:14, display:'flex', gap:6, flexWrap:'wrap'}}>
                  <span className="tag">#cinematography</span>
                  <span className="tag">#goldenhour</span>
                  <span className="tag">#forest</span>
                  <span className="tag">#bts</span>
                  <span className="tag">#tutorial</span>
                </div>
              </div>
            </div>

            {/* Right inspector */}
            <aside className="det-side">
              <div className="det-side-section">
                <div className="det-title">How aerial cinematographers light a forest at golden hour</div>
                <div className="det-channel">
                  <span className="av">F</span>
                  <span>Field Optics</span>
                  <span className="faint">· 1.2M subs</span>
                </div>
                <div className="row gap6">
                  <span className="tag amber">★ HERO</span>
                  <span className="tag dot y">b-roll</span>
                  <span className="tag dot p">tutorial</span>
                </div>
                <div className="det-actions" style={{marginTop:4}}>
                  <div className="det-action-btn primary">
                    <I.folder className="ic" width="14" height="14"/>
                    <span>Export to edit folder</span>
                    <span className="kbd">⌘ E</span>
                  </div>
                  <div className="det-action-btn">
                    <I.scissors className="ic" width="14" height="14"/>
                    <span>Re-download with new In/Out</span>
                    <span className="kbd">⌘ R</span>
                  </div>
                  <div className="det-action-btn">
                    <I.link className="ic" width="14" height="14"/>
                    <span>Open source URL</span>
                    <span className="kbd">⌘ ⇧ O</span>
                  </div>
                </div>
              </div>

              <div className="det-side-section">
                <div className="det-side-h"><span>File</span></div>
                <div className="det-row"><span className="k">Filename</span><span className="v">forest_lighting_01.mp4</span></div>
                <div className="det-row"><span className="k">Path</span><span className="v">~/edits/kestrel/ep04/raw/</span></div>
                <div className="det-row"><span className="k">Size</span><span className="v">312 MB</span></div>
                <div className="det-row"><span className="k">Duration</span><span className="v">07:47.500 <span className="faint">(trimmed)</span></span></div>
                <div className="det-row"><span className="k">Format</span><span className="v">MP4 · h.264 · 1080p · 23.976</span></div>
                <div className="det-row"><span className="k">Audio</span><span className="v">AAC · stereo · 48 kHz</span></div>
                <div className="det-row"><span className="k">Downloaded</span><span className="v">May 18, 2026 · 14:22</span></div>
              </div>

              <div className="det-side-section">
                <div className="det-side-h"><span>Source</span></div>
                <div className="det-row"><span className="k">Platform</span><span className="v">YouTube</span></div>
                <div className="det-row"><span className="k">URL</span><span className="v"><a>youtube.com/watch?v=dQw4w9WgXcQ</a></span></div>
                <div className="det-row"><span className="k">Channel</span><span className="v">Field Optics</span></div>
                <div className="det-row"><span className="k">Uploaded</span><span className="v">May 14, 2026</span></div>
                <div className="det-row"><span className="k">Views</span><span className="v">218,420</span></div>
              </div>

              <div className="det-side-section">
                <div className="det-side-h"><span>Tags</span><span className="ct">7 · <span className="kbd">T</span></span></div>
                <div className="det-tag-editor">
                  <span className="tag amber">★ HERO <I.x className="x" width="9" height="9"/></span>
                  <span className="tag dot y">b-roll <I.x className="x" width="9" height="9"/></span>
                  <span className="tag dot p">tutorial <I.x className="x" width="9" height="9"/></span>
                  <span className="tag dot g">nature <I.x className="x" width="9" height="9"/></span>
                  <span className="tag dot r">color <I.x className="x" width="9" height="9"/></span>
                  <span className="tag dot t">audio <I.x className="x" width="9" height="9"/></span>
                  <span className="tag">forest <I.x className="x" width="9" height="9"/></span>
                  <input placeholder="add tag…"/>
                </div>
              </div>

              <div className="det-side-section">
                <div className="det-side-h"><span>Notes</span></div>
                <div style={{fontSize:12, color:'var(--text-1)', lineHeight:1.5,
                  background:'var(--bg-2)', border:'1px solid var(--line-hi)',
                  borderRadius:5, padding:'8px 10px', minHeight:60}}>
                  Use the crane shot at 02:18 as opener.
                  Pair audio of dawn chorus from clip #34.
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DetailScreen = DetailScreen;
