# Media Hub

Desktop sourcing + organizing tool for video editors and content creators.
Paste a URL, mark In/Out, get only that segment — transcoded into a
format your NLE actually likes, filed into a tagged library you can
search a month later.

**Stack:** Tauri 2 (Rust core) + React + TypeScript + SQLite.
yt-dlp and ffmpeg ship as bundled sidecar binaries.

**Status:** v1.0.0 — first tester-ready release.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for history and
[`docs/1_0_PLAN.md`](docs/1_0_PLAN.md) for what's next.

---

## Install (testers, Windows)

1. Grab the latest `Media Hub_1.0.0_x64_en-US.msi` (or `.exe` setup)
   from the GitHub releases page.
2. Double-click → next-next-finish. Start menu shortcut appears.
3. First launch walks you through picking a library root and a
   default transcode preset. ~60 seconds.

**Cookies for age-gated YouTube:** the in-app instructions
recommend Firefox. Chrome/Edge cookies are currently broken
upstream in yt-dlp (Chrome 127+ DPAPI change) — Firefox just works.

**Known rough edges in 1.0:**

- No library-root migration yet — if you want to move your library
  to another drive, ping the author. Coming as a 1.0.x patch.
- Audio-only / MP3 download is not in 1.0 — parked for 1.x.
- No auto-updater. Future releases need manual reinstall.

File issues / weird URLs / "this errored cryptically" reports
straight to the author; getting real-use signal is exactly the
point of this build.

---

## Dev setup

Requirements:
- Node.js 20+
- Rust (stable) — install via [rustup](https://rustup.rs/)
- Windows: Visual Studio C++ Build Tools (Desktop development with C++ workload)
- macOS: Xcode Command Line Tools

```powershell
# 1. Install JS deps
npm install

# 2. Fetch sidecar binaries (yt-dlp + ffmpeg, gitignored)
pwsh scripts/fetch-sidecars.ps1

# 3. Run in dev mode (first cargo build takes 5–10 min)
npm run tauri dev
```

The first `cargo` build downloads and compiles ~300 dependencies; it's
slow once, then fast forever. Subsequent rebuilds are incremental.

---

## Repo layout

```
media-hub/
├── docs/                  ROADMAP, ARCHITECTURE, NOTES — read first
├── design-reference/      UI design source (JSX, reference only)
├── src/                   React + TypeScript frontend
├── src-tauri/             Rust backend (Tauri)
│   ├── src/               Rust source
│   ├── binaries/          Bundled sidecars (gitignored, fetch via script)
│   └── tauri.conf.json    Window + bundle config
├── scripts/               Dev scripts (sidecar fetch, etc.)
└── package.json
```
