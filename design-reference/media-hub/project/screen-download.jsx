/* ============================================================
   DOWNLOAD SCREEN
   ============================================================ */

const downloadCss = `
.dl-wrap { display:flex; flex-direction:column; height:100%; min-height:0; }
.dl-top {
  padding: 16px 16px 14px;
  border-bottom:1px solid var(--line);
  background: var(--bg-0);
}
.dl-input-row { display:flex; gap:8px; align-items:center; }
.dl-input {
  flex:1; height:34px;
  background: var(--bg-2);
  border:1px solid var(--line-hi);
  border-radius:6px;
  display:flex; align-items:center; gap:10px;
  padding: 0 12px;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text-0);
  position:relative;
}
.dl-input.focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-dim); }
.dl-input .caret { width:1px; height:14px; background: var(--accent); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity:0; } }
.dl-input .source-badge {
  margin-left:auto;
  font-family: var(--mono); font-size: 10px;
  color: var(--text-2); text-transform:uppercase; letter-spacing:0.08em;
  background: var(--bg-3); border:1px solid var(--line);
  padding: 2px 6px; border-radius:3px;
  display:inline-flex; align-items:center; gap:5px;
}
.dl-hint {
  display:flex; gap:14px; margin-top:10px;
  font-size: 11.5px; color: var(--text-2);
}
.dl-hint span { display:inline-flex; align-items:center; gap:6px; }

.dl-card {
  margin: 14px 16px 0;
  background: var(--bg-1);
  border:1px solid var(--line);
  border-radius: 7px;
  display:flex;
  overflow:hidden;
}
.dl-card .thumb-wrap {
  width: 240px; height: 135px; flex: 0 0 240px;
  border-right: 1px solid var(--line);
  position:relative;
}
.dl-card .thumb { width:100%; height:100%; border:none; border-radius:0;}
.dl-card .body {
  flex:1; padding: 12px 14px; display:flex; flex-direction:column; gap:10px;
}
.dl-card .meta-line { display:flex; gap:10px; align-items:center; font-size:11.5px; color:var(--text-2); font-family: var(--mono); }
.dl-card h3 {
  margin:0; font-size:14px; font-weight:600; color:var(--text-0);
  letter-spacing:-0.005em; line-height: 1.3;
}
.dl-card .channel { font-size:12px; color:var(--text-1); }
.dl-card .controls {
  display:grid; grid-template-columns: 1fr 1fr 1fr auto; gap:10px;
  margin-top:auto;
  align-items:flex-end;
}
.field { display:flex; flex-direction:column; gap:4px; }
.field-label {
  font-family: var(--mono); font-size:10px; color: var(--text-3);
  text-transform: uppercase; letter-spacing:0.08em;
}
.field-input {
  height:28px;
  background: var(--bg-2);
  border:1px solid var(--line-hi);
  border-radius:5px;
  display:flex; align-items:center;
  padding: 0 9px;
  font-family: var(--mono); font-size:12px;
  color: var(--text-0);
  gap:8px;
  cursor:pointer;
}
.field-input .ph { color: var(--text-3); }
.field-input .chev { margin-left:auto; color: var(--text-2); }
.field-input.focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-dim); }
.dl-card .dl-btn {
  height:28px; padding: 0 14px;
  background: var(--accent);
  color: #0d0d0f; font-weight:500; font-size:12.5px;
  border-radius:5px; border:1px solid var(--accent);
  display:inline-flex; align-items:center; gap:8px;
  cursor:pointer;
}
.dl-card .dl-btn:hover { filter: brightness(1.05); }

.dl-card .dest {
  display:flex; align-items:center; gap:8px;
  margin-top: 4px;
  font-size:11.5px; color:var(--text-2);
}
.dl-card .dest .name { color: var(--text-0); }

/* Queue */
.queue {
  flex:1; min-height:0;
  display:flex; flex-direction:column;
  margin-top: 16px;
}
.queue-head {
  padding: 8px 16px;
  display:flex; align-items:center;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--bg-1);
  height: 32px;
  flex:0 0 32px;
  gap: 12px;
}
.queue-head h4 {
  margin:0; font-size:11px; font-weight:600; color:var(--text-1);
  font-family: var(--mono); text-transform:uppercase; letter-spacing:0.08em;
}
.queue-head .badge {
  font-family: var(--mono); font-size:10.5px; color: var(--text-2);
}
.queue-actions { margin-left:auto; display:flex; gap:6px; }
.queue-actions .ch-btn { height:22px; padding: 0 8px; font-size: 11px; }

.queue-list { flex:1; overflow:auto; }
.q-row {
  display:grid;
  grid-template-columns: 64px 1fr 200px 110px 110px 90px 28px;
  gap: 14px;
  align-items:center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.q-row:hover { background: var(--bg-1); }
.q-row .thumb {
  width: 64px; height: 36px; border-radius:3px;
}
.q-title { display:flex; flex-direction:column; gap:3px; min-width:0; }
.q-title .t {
  font-size: 12.5px; color: var(--text-0); font-weight:500;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.q-title .sub {
  font-size: 11px; color: var(--text-2); font-family: var(--mono);
  display:flex; gap:8px; align-items:center;
}
.q-title .sub .src-ic { color: var(--text-2); }
.q-prog-wrap { display:flex; flex-direction:column; gap:4px; }
.q-prog-wrap .meta {
  display:flex; justify-content:space-between;
  font-family: var(--mono); font-size: 10.5px; color: var(--text-2);
}
.q-dest { font-family: var(--mono); font-size: 11.5px; color: var(--text-1); display:flex; align-items:center; gap:6px; }
.q-dest svg { color: var(--text-3); }
.q-time { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); }
.q-actions { display:flex; gap:2px; justify-content:flex-end; }
.q-actions .ic-btn { width:24px; height:24px; }

/* In/Out timeline preview inside metadata card */
.tl {
  height: 22px; background: var(--bg-2); border-radius: 3px;
  border: 1px solid var(--line);
  position:relative;
  margin-top: 2px;
  background-image: linear-gradient(to right, transparent 0, transparent calc(100% - 1px), var(--line) calc(100% - 1px)),
    linear-gradient(to right, var(--line-hi) 1px, transparent 1px);
  background-size: 100% 100%, 10% 100%;
}
.tl .sel {
  position:absolute; top:0; bottom:0;
  background: var(--accent-dim);
  border-left: 2px solid var(--accent);
  border-right: 2px solid var(--accent);
}
.tl .lbl {
  position:absolute; top: -14px;
  font-family: var(--mono); font-size: 10px;
  color: var(--accent);
}
`;

/* inject */
if (!document.getElementById('dl-css')) {
  const s = document.createElement('style'); s.id='dl-css'; s.textContent=downloadCss; document.head.appendChild(s);
}

function QRow({ thumb, title, sub, src, prog, status, speed, eta, dest, size }) {
  const isLive = status === 'live';
  const isDone = status === 'ok';
  const isQueued = status === 'queued';
  const isErr = status === 'err';
  return (
    <div className="q-row">
      <div className="thumb">
        <span className="dur">{thumb.dur}</span>
      </div>
      <div className="q-title">
        <div className="t">{title}</div>
        <div className="sub">
          <span className="src-ic">{src === 'yt' ? <I.yt width="11" height="11"/> : <I.x_logo width="10" height="10"/>}</span>
          <span>{sub}</span>
        </div>
      </div>
      <div className="q-prog-wrap">
        {isDone ? (
          <div className="row gap6">
            <span className="pill ok">Complete</span>
            <span className="mono faint" style={{fontSize:10.5}}>{size}</span>
          </div>
        ) : isErr ? (
          <div className="row gap6">
            <span className="pill err">Failed · 403</span>
            <span className="mono faint" style={{fontSize:10.5}}>auth required</span>
          </div>
        ) : isQueued ? (
          <div className="row gap6"><span className="pill queued">Queued</span></div>
        ) : (
          <>
            <div className="progress"><i style={{width: prog+'%'}}></i></div>
            <div className="meta">
              <span>{prog}%</span>
              <span>{speed}</span>
            </div>
          </>
        )}
      </div>
      <div className="q-dest">
        <I.folder width="12" height="12"/>
        <span style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{dest}</span>
      </div>
      <div className="q-time">{eta || ''}</div>
      <div className="q-time mono">{isDone ? size : (isLive ? size : '')}</div>
      <div className="q-actions">
        <div className="ic-btn">
          {isErr ? <I.retry width="13" height="13"/> :
           isLive ? <I.pause width="12" height="12"/> :
           isDone ? <I.more width="14" height="14"/> :
           <I.x width="13" height="13"/>}
        </div>
      </div>
    </div>
  );
}

function DownloadScreen() {
  return (
    <div className="mh">
      <AppChrome title="Media Hub — Download"/>
      <TopBar project={{name:'Kestrel · Ep 04'}}/>
      <div className="main">
        <Nav active="download" project="kestrel"/>
        <div className="content">
          <div className="content-header">
            <span className="ch-title">Download</span>
            <span className="ch-meta">3 active · 1 queued · 1 failed</span>
            <div className="ch-spacer"></div>
            <div className="ch-btn ghost"><I.scissors width="12" height="12"/> Batch import <span className="kbd">⌘ ⇧ V</span></div>
            <div className="ch-btn"><I.pause width="11" height="11"/> Pause all</div>
            <div className="ch-btn"><I.check width="12" height="12"/> Clear completed</div>
          </div>

          <div className="dl-wrap">
            <div className="dl-top">
              <div className="dl-input-row">
                <div className="dl-input focus">
                  <I.link width="14" height="14" style={{color:'var(--text-2)'}}/>
                  <span>https://www.youtube.com/watch?v=dQw4w9WgXcQ</span>
                  <span className="caret"></span>
                  <span className="source-badge">
                    <I.yt width="10" height="10"/> YouTube
                  </span>
                </div>
                <div className="ch-btn"><I.plus width="12" height="12"/> Add 10+ URLs</div>
              </div>
              <div className="dl-hint">
                <span><span className="kbd">⌘ V</span> Paste & analyze</span>
                <span><span className="kbd">⌘ ⏎</span> Download to active project</span>
                <span><span className="kbd">⌘ ⇧ ⏎</span> Download to Library</span>
                <span style={{marginLeft:'auto', color:'var(--text-3)'}}>Cookies: <span className="strong">Loaded</span> · Proxy: off</span>
              </div>
            </div>

            <div className="dl-card">
              <div className="thumb-wrap">
                <div className="thumb">
                  <span className="src"><I.yt width="9" height="9" style={{verticalAlign:'-1px'}}/> YT</span>
                  <span className="dur">12:47</span>
                </div>
              </div>
              <div className="body">
                <div>
                  <h3>How aerial cinematographers light a forest at golden hour</h3>
                  <div className="channel">Field Optics · 1.2M subs · Uploaded May 14, 2026</div>
                </div>
                <div className="meta-line">
                  <span>1080p · h.264</span><span>•</span>
                  <span>312 MB est.</span><span>•</span>
                  <span>chapters: 6</span><span>•</span>
                  <span>captions: en, en-auto, es</span>
                </div>

                <div className="controls">
                  <div className="field">
                    <span className="field-label">Format</span>
                    <div className="field-input">
                      <span>1080p · MP4 · h.264</span>
                      <span className="chev"><I.chev width="10" height="10"/></span>
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">In</span>
                    <div className="field-input focus">
                      <span>00:01:24.500</span>
                      <span className="kbd" style={{marginLeft:'auto'}}>I</span>
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Out</span>
                    <div className="field-input">
                      <span>00:09:12.000</span>
                      <span className="kbd" style={{marginLeft:'auto'}}>O</span>
                    </div>
                  </div>
                  <div className="dl-btn">
                    <I.download width="13" height="13"/> Download
                    <span className="kbd" style={{background:'rgba(0,0,0,.15)', borderColor:'rgba(0,0,0,.2)', color:'rgba(0,0,0,.65)'}}>⌘ ⏎</span>
                  </div>
                </div>

                <div className="tl">
                  <div className="sel" style={{left: '11%', right: '28%'}}>
                    <span className="lbl" style={{left:0}}>IN 01:24</span>
                    <span className="lbl" style={{right:0}}>OUT 09:12</span>
                  </div>
                </div>

                <div className="dest">
                  <span className="muted">Saves to</span>
                  <I.folder width="11" height="11" style={{color:'var(--accent)'}}/>
                  <span className="name">Kestrel · Ep 04</span>
                  <span className="faint">/ raw / forest_lighting_01.mp4</span>
                  <span style={{marginLeft:'auto'}} className="kbd">change ⌘ D</span>
                </div>
              </div>
            </div>

            <div className="queue">
              <div className="queue-head">
                <h4>Queue</h4>
                <span className="badge">5 items · 2.1 GB · ↓ 18.4 MB/s</span>
                <div className="queue-actions">
                  <div className="ch-btn"><I.filter width="11" height="11"/> All</div>
                  <div className="ch-btn">Active</div>
                  <div className="ch-btn">Completed</div>
                  <div className="ch-btn">Failed</div>
                </div>
              </div>
              <div className="queue-list">
                <QRow
                  thumb={{dur:'12:47'}}
                  title="How aerial cinematographers light a forest at golden hour"
                  sub="Field Optics · 1:24 → 9:12 · trimmed"
                  src="yt"
                  prog={64}
                  status="live"
                  speed="↓ 8.2 MB/s"
                  eta="00:42 left"
                  dest="Kestrel · Ep 04"
                  size="198 / 312 MB"
                />
                <QRow
                  thumb={{dur:'3:18'}}
                  title="Drone B-roll — coastline at dawn (Sony FX3)"
                  sub="@cinemartin · full clip"
                  src="x"
                  prog={28}
                  status="live"
                  speed="↓ 4.1 MB/s"
                  eta="01:54 left"
                  dest="Library / B-roll"
                  size="42 / 148 MB"
                />
                <QRow
                  thumb={{dur:'27:02'}}
                  title="Sound design for documentary: the layered ambience approach"
                  sub="Sound&amp;Picture · 4K · 0:00 → 27:02"
                  src="yt"
                  prog={92}
                  status="live"
                  speed="↓ 6.1 MB/s"
                  eta="00:08 left"
                  dest="Kestrel · Ep 04"
                  size="1.34 / 1.46 GB"
                />
                <QRow
                  thumb={{dur:'1:42'}}
                  title="@vfxtuts thread — quick rotoscope tip"
                  sub="@vfxtuts · 4 of 4 clips · pending"
                  src="x"
                  status="queued"
                  dest="Library / Reference"
                />
                <QRow
                  thumb={{dur:'8:15'}}
                  title="Private members-only Q&amp;A: lens choices for night exteriors"
                  sub="Cinema Underground · members"
                  src="yt"
                  status="err"
                  dest="Library / Reference"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DownloadScreen = DownloadScreen;
