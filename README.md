# Media Hub

Desktop sourcing + organizing tool for video editors and content creators.
Paste a URL, mark In/Out, get only that segment — transcoded into a
format your NLE actually likes, filed into a tagged library you can
search a month later.

**Stack:** Tauri 2 (Rust core) + React + TypeScript + SQLite.
yt-dlp and ffmpeg ship as bundled sidecar binaries.

**Status:** dev0 — milestone 0.1 (boilerplate + sidecar smoke test) in progress.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full plan.

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
