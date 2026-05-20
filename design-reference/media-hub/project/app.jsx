/* ============================================================
   APP — wires the 4 screens into a design canvas
   ============================================================ */

const W = 1360;
const H = 860;

function App() {
  return (
    <DesignCanvas>
      <DCSection
        id="screens"
        title="Core screens"
        subtitle="Persistent top bar (Active Project picker) + left nav across all four. Native macOS chrome shown — would render Windows chrome on Win.">

        <DCArtboard id="download" label="01 · Download" width={W} height={H}>
          <DownloadScreen/>
        </DCArtboard>

        <DCArtboard id="library" label="02 · Library — grid" width={W} height={H}>
          <LibraryScreen/>
        </DCArtboard>

        <DCArtboard id="project" label="03 · Project view" width={W} height={H}>
          <ProjectScreen/>
        </DCArtboard>

        <DCArtboard id="detail" label="04 · Asset detail" width={W} height={H}>
          <DetailScreen/>
        </DCArtboard>
      </DCSection>

      <DCPostIt top={60} left={40} width={240} rotate={-2}>
        <b>Design system</b><br/>
        Dark zinc base, one amber accent for live / active states only. 12–13px UI, 1px hairlines, no gradients. Geist Sans + Geist Mono.
      </DCPostIt>

      <DCPostIt top={300} left={60} width={240} rotate={1.5}>
        <b>Active Project picker</b><br/>
        90/10 split (project vs library) lives in the top bar. The active project gets a highlighted row in the left nav too.
      </DCPostIt>

      <DCPostIt top={540} left={40} width={240} rotate={-1}>
        <b>Keyboard hints</b><br/>
        Shortcuts are visible on every primary action: ⌘⏎ download, ⌘E export, T tag, M marker, J/K prev/next, 1–5 rate.
      </DCPostIt>

      <DCPostIt top={780} left={50} width={240} rotate={2}>
        <b>What I'd refine next</b><br/>
        Inline waveform on queue rows · saved smart-bins · multi-select toolbar · "Finish project" exit checklist.
      </DCPostIt>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
