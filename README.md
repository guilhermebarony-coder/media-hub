# Media Hub

**A desktop app for grabbing video/audio from the web and organizing it for editing.**
Paste a link, preview it, mark the exact In/Out you want, and download just
that piece — optionally converted into an edit-friendly format and filed into
a tagged, searchable library.

Built for video editors and content creators, but simple enough for anyone who
just wants to save clips.

> 🇧🇷 Media Hub também fala português — troque o idioma no seletor no canto
> superior direito do app.

- **Platforms:** Windows & macOS
- **Under the hood:** [Tauri 2](https://tauri.app) (Rust) + React/TypeScript,
  SQLite, and [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg.
- **Open source**, no account, no telemetry, nothing leaves your computer.

---

## Table of contents

- [What can it do?](#what-can-it-do)
- [Download & install](#download--install)
  - [Windows](#windows)
  - [macOS](#macos)
- [First launch](#first-launch)
- [How to use it (2-minute tour)](#how-to-use-it)
- [Keeping it updated](#updating)
- [Browser extension (optional)](#browser-extension)
- [Common questions & fixes](#troubleshooting)
- [Privacy](#privacy)
- [For developers](#for-developers)
- [License](#license)

---

## What can it do? <a id="what-can-it-do"></a>

- ⬇️ **Download video or audio** (MP3 / M4A / FLAC) from YouTube, Twitter/X,
  Reddit, Pinterest, Instagram, TikTok, and hundreds of other sites.
- ✂️ **Trim before you download** — a built-in player lets you mark exact
  In/Out points (even multiple segments) and grab only what you need.
- 🎞️ **Chapters & preview scrubbing** — jump to YouTube chapters, hover-scrub a
  filmstrip, and step frame-by-frame to find the perfect cut.
- 🔄 **Convert for editing** (optional) — transcode to ProRes, DNxHR, or H.264
  so clips drop straight onto a Premiere/Resolve/FCP timeline.
- 🗂️ **A real library** — tags, nestable colored folders, projects, full-text
  search, duplicate detection, and a recoverable Trash.
- 📋 **Playlists & batch** — queue a whole playlist or a list of URLs at once.
- 🌐 **Browser extension** — send a video from your browser with one click.
- 🔒 **Private by design** — everything runs locally; the app phones home to
  nobody.

---

## Download & install <a id="download--install"></a>

Grab the latest installer from the **[Releases page](../../releases/latest)**.

### Windows <a id="windows"></a>

1. On the Releases page, download the file ending in **`.msi`** (or the
   **`.exe`** setup) — e.g. `Media.Hub_x.y.z_x64-setup.exe`.
2. **Double-click** it to run the installer.
3. **Windows may show a blue "Windows protected your PC" screen.** This is
   normal for apps from independent developers (the app isn't code-signed with
   an expensive certificate). To continue:
   - Click **"More info"**
   - Click **"Run anyway"**
4. Click through the installer (Next → Next → Finish). A **Media Hub** shortcut
   appears in your Start menu.

That's it. Open it from the Start menu.

### macOS <a id="macos"></a>

1. Download the **`.dmg`** from the Releases page.
2. Open it and **drag Media Hub into your Applications folder.**
3. The first time you open it, macOS may say it "cannot be opened because it is
   from an unidentified developer." To get past this:
   - **Right-click** (or Control-click) the app → **Open** → **Open** again.
   - You only have to do this once.

---

## First launch <a id="first-launch"></a>

The very first time you open Media Hub, two things happen:

1. **A quick setup wizard (~1 minute)** walks you through picking where your
   files are saved and a couple of defaults. You can change all of it later in
   Settings, so don't overthink it.
2. **It downloads its media tools** (the ffmpeg + audio-processing engines,
   ~1–2 min on a normal connection). This keeps the installer small and only
   happens once. If it stalls, it's almost always a firewall/VPN blocking the
   download — try again on a normal connection.

When both are done, you're on the Library screen, ready to go.

---

## How to use it (2-minute tour) <a id="how-to-use-it"></a>

**To download something:**

1. Click **Download** in the left menu (or press `1`).
2. **Paste a video URL** and click **Fetch**. The app loads the video's info.
3. *(Optional)* Use the **preview player** to mark the exact part you want:
   press `I` to mark the start, `O` to mark the end. Skip this to get the whole
   thing.
4. Pick a quality (or leave it on **Best**) and click **Download**.
5. When it finishes, your clip is in the **Library** (press `2`), with a
   thumbnail, ready to drag into your editor.

**A few things worth knowing:**

- **Library vs. Projects** — the **Active** dropdown at the top decides where
  downloads go. *Library* = your permanent stash. A *Project* = a temporary
  bucket for one job that you can clean up when you're done.
- **Cookies / sign-in** — if a video says "sign in" or "confirm you're not a
  bot," go to **Settings → Sources** and point the app at your browser's login.
  You only need this for age-restricted / private / members-only videos.
- **Converting (transcode)** is **off by default** — most people don't need it.
  Turn it on in Settings only if your editing app struggles with the raw file.
- **The `?` icons** next to some settings — hover them for a plain-language
  explanation, or click for the full guide. There's also a full **Help/Manual**
  built into the app (bottom of the left menu).

---

## Keeping it updated <a id="updating"></a>

Media Hub **checks for updates automatically.** When a new version is
available, it downloads in the background and applies the next time you fully
quit and reopen the app.

- To force it: **fully quit** the app (also check the system tray — it can keep
  running there in the background — and choose **Quit**), then reopen.
- You can always just download the latest installer from the
  **[Releases page](../../releases/latest)** and install over your current
  version. **Your library and settings are kept.**

---

## Browser extension (optional) <a id="browser-extension"></a>

A companion browser extension adds a **"Send to Media Hub"** button so you can
push a video from your browser straight into the app's download queue — no
copy-pasting URLs.

> It's optional. Everything works from the app without it. And it only talks to
> **your own computer** — nothing is sent over the internet.

**Install it (Chrome / Edge / Brave):**

1. Download/clone this project so you have the **`extension`** folder on disk.
2. Open a new tab and go to **`chrome://extensions`** (on Edge:
   `edge://extensions`, on Brave: `brave://extensions`).
3. Turn on **"Developer mode"** (top-right toggle).
4. Click **"Load unpacked"** and select the **`extension`** folder.
5. Pin the new **Media Hub** icon from the toolbar's puzzle-piece menu 🧩.

**Firefox:** go to `about:debugging` → **This Firefox** → **Load Temporary
Add-on** → pick `manifest.json` inside the `extension` folder. *(Firefox
forgets temporary add-ons when you close it, so you'd re-add it each session —
Chrome/Edge/Brave is smoother for daily use.)*

**Pair it with the app (one time):**

1. In Media Hub: **Settings → Browser bridge → Copy token.**
2. In the browser: click the **Media Hub extension icon → Options**, paste the
   token, click **Save**, then **Test connection**. A green "Connected"
   message means you're set. *(The desktop app must be open.)*

**Using it:** click the toolbar icon and pick Video/MP3/M4A/FLAC, hover a video
on Twitter/Reddit for an in-page button, or use the shortcuts **`Ctrl+Shift+Y`**
(video) / **`Ctrl+Shift+M`** (MP3). Full guide + troubleshooting:
[`extension/README.md`](extension/README.md).

---

## Common questions & fixes <a id="troubleshooting"></a>

**A download failed / "video unavailable" / "sign in required".**
The video probably needs a login. Go to **Settings → Sources** and point the
app at your browser's cookies. If it still fails, the site may have changed —
updating to the latest app version (which ships a newer downloader) usually
fixes it.

**Windows blocked the installer ("Windows protected your PC").**
Normal for indie apps. Click **More info → Run anyway** (see
[Windows install](#windows)).

**Converting/preview suddenly stopped working.**
The media tools may be missing/corrupted. **Settings → Diagnostics → Repair
tools** re-downloads them.

**The preview is slow to seek.**
Lower **Preview quality** in Settings; also, the first seek on a new video has
to fetch a small preview copy, so give it a moment.

**Downloads are slow.**
Turn on **Fast downloads** in **Settings → Downloads** (great for big files).

**A clip says "file not found."**
Its file was moved or deleted outside the app. Re-download it, or use "Reveal
in file manager" to see where it went.

**Where are the logs (for a bug report)?**
**Settings → Diagnostics → Open logs folder** (`media-hub.log`).

**How do I report a bug well?** Include what you did + what happened, the exact
URL, your app version (Settings → About) and OS, a screenshot of the error,
and — most importantly — the **log file** above. There's a fuller checklist in
the in-app Help.

---

## Privacy <a id="privacy"></a>

- Media Hub runs **entirely on your machine.** It does not send your activity,
  URLs, or library to us or anyone else.
- It reaches the internet only to **download the videos you ask for**, to
  **fetch its media tools on first run**, and to **check for app updates**.
- The browser extension talks **only to your own computer** (`127.0.0.1`) and
  only when you click a button.

---

## For developers <a id="for-developers"></a>

Media Hub is a **Tauri 2** app: a **Rust** core + a **React + TypeScript
(Vite)** frontend, an **SQLite** library, and **yt-dlp / ffmpeg / deno** as
helper binaries the app fetches on first run.

### Run from source

**Requirements:**
- **Node.js 20+**
- **Rust (stable)** — install via [rustup](https://rustup.rs)
- **Windows:** Visual Studio C++ Build Tools ("Desktop development with C++")
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

```bash
# 1. Install JS dependencies
npm install

# 2. Fetch the sidecar binaries (yt-dlp + ffmpeg; gitignored)
pwsh scripts/fetch-sidecars.ps1        # macOS: bash scripts/fetch-sidecars-mac.sh

# 3. Run in dev mode (the FIRST Rust build takes several minutes)
npm run tauri dev
```

The first `cargo` build compiles a few hundred dependencies — slow once, then
incremental and fast.

### Build an installer

```bash
npm run tauri build     # output in src-tauri/target/release/bundle
```

Releases are tag-driven: pushing a `v*` tag triggers GitHub Actions to build
Windows + macOS, sign the auto-updater artifacts, and draft a release.

### Checks

```bash
npx tsc --noEmit                 # frontend type-check
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

### Project layout

```
media-hub/
├── src/                    React + TypeScript frontend
│   ├── pages/              Download, Library, Projects, Settings, Help
│   ├── components/         Scrubber, Onboarding, HelpHint, …
│   └── lib/                settings, downloads, types, i18n, helpContent, …
├── src-tauri/              Rust backend (Tauri)
│   ├── src/                Rust source (lib.rs wires the command modules)
│   ├── binaries/           Bundled sidecars (gitignored — fetch via script)
│   └── tauri.conf.json     Window + bundle config
├── extension/              MV3 browser extension (no build step)
├── scripts/                Dev scripts (sidecar fetch, smoke test)
└── docs/                   ARCHITECTURE, ROADMAP, NOTES, MANUAL — read first
```

### Where to look first

- **`docs/ARCHITECTURE.md`** — how the pieces fit.
- **`docs/MANUAL.md`** — the full user manual (mirrors the in-app Help), incl. a
  "For developers" section on adding commands, the extension, i18n, and the
  `(?)`-hint system.
- **`docs/NOTES.md`** — dated working notes, gotchas, and rationale.

Contributions welcome — keep changes focused, run the checks above, and
describe what changed and why. Not a coder? Clear bug reports (with the log
file) and testing releases genuinely help.

---

## License

See [LICENSE](LICENSE) if present; otherwise all rights reserved by the author
pending a license decision.

Media Hub bundles/uses **yt-dlp**, **ffmpeg**, and **deno**, each under their
own licenses.
