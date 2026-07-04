# Media Hub — User Manual & FAQ

A plain-language guide to **every screen and every button** in Media Hub.
Written so anyone — not just editors — can open it, find the thing they're
looking at, and understand what it does in a sentence or two.

> **How this doc is built (for future us):** every button/section has a
> stable anchor id in `{#like-this}`. The plan is to put a small **(?)**
> icon next to buttons in the app that deep-links to its section here. So
> **don't rename an existing anchor** once the (?) links point at it — add
> new ones, keep old ones. Each entry also has a `Keywords:` line so
> in-app / Ctrl-F search finds it by the words people actually use.

---

## Contents

1. [Quick start (the 30-second version)](#quick-start)
2. [Core ideas (read this once)](#core-ideas)
   - [Library vs. Projects](#idea-library-vs-projects)
   - [The Trash](#idea-trash)
   - [Cookies & why some sites need them](#idea-cookies)
   - [Transcode presets explained](#idea-presets)
   - [Preview quality & the scrubber](#idea-preview)
   - [Background mode & the tray](#idea-background)
3. [Top bar](#top-bar)
4. [Left navigation](#left-nav)
5. [Download page](#download-page)
6. [The Preview / Scrubber](#scrubber)
7. [Library page](#library-page)
8. [Projects page](#projects-page)
9. [Settings page](#settings-page)
10. [Browser extension](#extension)
11. [Keyboard shortcuts](#shortcuts)
12. [Troubleshooting](#troubleshooting)
13. [Reporting bugs](#reporting-bugs)
14. [For developers](#developers)

---

## 1. Quick start {#quick-start}

**Keywords:** getting started, first time, how to download, basics

1. Go to **Download** (left nav, or press `1`).
2. Paste a video URL (YouTube, Twitter/X, Pinterest, etc.) and hit **Fetch**.
3. Pick a format (or just **Best**), then press **Download**.
4. The clip lands in your **Library** (press `2`) with a thumbnail, ready to
   drag into your editor.

That's the whole loop. Everything else below is detail for when you want it.

---

## 2. Core ideas (read this once) {#core-ideas}

### Library vs. Projects {#idea-library-vs-projects}

**Keywords:** what is a project, difference, scope, where do clips go, active

Media Hub has two "places" a clip can live, chosen by the **Active** picker
in the top bar:

- **Library** — your permanent, reusable shelf. Stock B-roll you'll grab
  again and again. Clips here live forever until *you* delete them.
- **A Project** — a temporary bucket for one job ("BrandSpot 001"). Download
  into a project while you work; when you're done, **Finish** the project to
  clear its files and keep your disk clean.

The **Active** picker decides where *new* downloads go and what the Library
page shows. Switching to "Library" is always one click away. See also
[the Active picker](#topbar-active) and the [Projects page](#projects-page).

### The Trash {#idea-trash}

**Keywords:** delete, recover, undo delete, recycle bin, removed clip

Deleting a clip from the Library moves it to an **in-app Trash** first (not
gone yet) — you can **restore** it. Emptying the Trash, or "permanently
delete", sends the actual files to your OS **Recycle Bin**. So there are two
safety nets before anything is truly lost. See [Trash folder](#lib-trash).

### Cookies & why some sites need them {#idea-cookies}

**Keywords:** login, sign in, private video, age restricted, members only,
cookies.txt, bot check, this video is unavailable

Some videos won't download unless the site thinks you're logged in
(age-restricted, members-only, region-locked, or just a "confirm you're not
a bot" wall). Cookies are how a browser proves you're signed in. In
**Settings → Sources** you can point Media Hub at your browser's cookies so
it can fetch those videos as *you*. You only need this if a download fails
asking you to sign in. See [Sources](#set-sources).

### Transcode presets explained {#idea-presets}

**Keywords:** convert, ProRes, DNxHD, H.264, format, codec, editing format,
proxy, why transcode

Downloaded video is usually compressed (H.264/VP9/AV1) — great for storage,
**bad for scrubbing on a timeline**. Transcoding re-wraps it into an
edit-friendly format:

- **ProRes** (Apple) / **DNxHD** (Avid) — "mezzanine" formats NLEs love;
  large files, buttery-smooth editing. Best for Premiere/Resolve/FCP.
- **H.264** — stays small; fine for playback, less ideal as a source.
- **Copy / Remux** — just changes the container, no quality loss, instant.

You can set a default in [Settings → Transcode](#set-transcode) or transcode
a clip on demand from the Library.

### Preview quality & the scrubber {#idea-preview}

**Keywords:** preview, scrub, slow preview, laggy, quality, storyboard,
frame accurate, jog

Before you download, the **[Scrubber](#scrubber)** lets you preview the video
and mark exact In/Out points. To feel smooth it downloads a small "proxy"
copy in the background. **Preview quality** (in Settings) trades sharpness
for speed — lower quality = faster, lighter previews. This never affects the
quality of what you actually **download**; it's only the preview.

### Background mode & the tray {#idea-background}

**Keywords:** minimize, run in background, tray, keep downloading, close,
hide window

Media Hub can hide into the system tray and **keep downloading** while you
work in other apps. See the [Run in background button](#topbar-background).

---

## 3. Top bar {#top-bar}

The strip across the very top of the window.

### Active project picker {#topbar-active}
**Keywords:** active, scope, switch project, where clips go, library dropdown

The dropdown showing **"Active: Library"** (or a project name). It sets where
new downloads go and what the Library shows. Pick **Library** for permanent
stock, a **project** for a specific job, or **New project…** to create one.
Explained fully under [Library vs. Projects](#idea-library-vs-projects).

### Activity badge {#topbar-activity}
**Keywords:** downloading indicator, active downloads, progress dot, how many

Only appears while downloads are running. Shows how many are active; click it
to jump to the Download page and watch them.

### Search clips {#topbar-search}
**Keywords:** search, find clip, command palette, Ctrl Space, quick open

Opens the **command palette** — a quick search over your clips. Shortcut:
`Ctrl+Space`. Type part of a title or channel to jump straight to it.

### Run in background {#topbar-background}
**Keywords:** background, tray, minimize, keep downloading, hide, eye icon

The **eye** icon. Hides the window into the system tray while downloads keep
running. Hover the tray icon to see live download count; click it to bring
the window back. First use shows a one-time hint so you know where the app
went. See [Background mode](#idea-background).

### Settings (gear) {#topbar-settings}
**Keywords:** settings, preferences, options, gear, cog

The **gear** icon opens [Settings](#settings-page). Same as pressing `,`.

---

## 4. Left navigation {#left-nav}

**Keywords:** menu, sidebar, pages, tabs, navigation

The column of links on the left. Each has a keyboard shortcut shown as a chip:

- **Download** (`1`) — paste URLs, fetch, and download. [Details](#download-page)
- **Library** (`2`) — browse everything you've saved. [Details](#library-page)
- **Projects** (`3`) — manage per-job buckets. [Details](#projects-page)
- **Settings** (`,`) — all preferences. [Details](#settings-page)

---

## 5. Download page {#download-page}

**Keywords:** download, url, fetch, get video, save clip, paste link

Where you turn a link into a saved clip.

### URL box + Fetch {#dl-fetch}
**Keywords:** paste url, fetch, load video, get info, metadata

Paste a video/playlist/channel URL and press **Fetch** (or Enter). Media Hub
reads the video's info (title, duration, available formats, chapters) so you
can choose before committing to a download. Nothing is downloaded yet.

### Fetch playlist {#dl-fetch-playlist}
**Keywords:** playlist, multiple videos, batch, whole list

Appears when the URL is a playlist. Loads every entry so you can pick which
ones to queue. See [playlist selection](#dl-playlist-select).

### Video / Audio tabs {#dl-mode}
**Keywords:** audio only, mp3, extract audio, music, video vs audio

Switch between downloading the **full video** or **audio only** (for music,
podcasts, sound beds). The format choices below change to match.

### Show / Hide format list {#dl-formats}
**Keywords:** format, resolution, quality, 1080p, 4k, codec, bitrate, which format

Expands the full list of every resolution/codec the source offers. Each row
shows resolution, codec, and size. Pick one for precise control, or leave the
default **Best** and let Media Hub choose the highest-quality option.

### Manual format mode {#dl-manual}
**Keywords:** advanced, custom format, format code, expert

Lets you type a raw format selector instead of picking from cards. For power
users who know yt-dlp format syntax; most people never need this.

### Download {#dl-download}
**Keywords:** download button, start download, save, go

The main action. Downloads the selected format into your current **Active**
scope (Library or a project). Progress shows live; the clip appears in your
Library when done.

> **Tip:** Hold **`Ctrl`** while clicking Download to send this one clip to
> the **Library** even if a project is active (a quick override). The button
> highlights to confirm.

### Cancel / Stop download {#dl-cancel}
**Keywords:** cancel, stop, abort, halt download

Stops the current download. Any partial file stays on disk (it isn't
auto-deleted), so you can retry cleanly.

### Open (folder) {#dl-open}
**Keywords:** open folder, reveal, find file, show in explorer, locate

After a download finishes, reveals the saved file in your file manager
(Explorer/Finder).

### Playlist selection {#dl-playlist-select}
**Keywords:** select all, select none, first 5, first 10, choose videos

When a playlist is loaded you get **Select all**, **Select none**, and
**first 5 / first 10** helpers, then a button to queue the chosen entries.
Everything selected goes into the [download queue](#dl-queue).

### Download queue {#dl-queue}
**Keywords:** queue, batch, multiple downloads, paste list, bulk

Paste several URLs (one per line) and **Queue all** to download them in
sequence. Controls:

- **Queue all** {#dl-queue-all} — starts everything in the box.
- **Clear completed** {#dl-queue-clear} — tidies finished rows out of the list.
- **Retry failed** {#dl-queue-retry} — re-attempts any that errored (appears
  only when something failed).

### Duplicate warning / Open existing {#dl-duplicate}
**Keywords:** already downloaded, duplicate, same video, exists

If you've already got this exact video, Media Hub warns you instead of
downloading twice and offers to reveal the existing file.

---

## 6. The Preview / Scrubber {#scrubber}

**Keywords:** preview, scrub, trim, in out, segments, mark, jog, cut, chapters

The video player that appears after fetching, for previewing and marking the
exact piece you want. Downloading only your marked segment(s) saves time and
disk. See also [Preview quality](#idea-preview).

### Play / pause {#scrub-play}
**Keywords:** play, pause, space, watch

Click the video or press **Space** to play/pause.

### Step back / forward one frame {#scrub-step}
**Keywords:** frame, previous frame, next frame, precise, arrow keys, nudge

The `←` / `→` arrow buttons (and keys) move exactly **one frame** at a time —
for finding the precise cut point. These are precision tools, so the fast
preview optimizations stay out of their way.

### Fine scrub (jog) {#scrub-jog}
**Keywords:** jog, fine scrub, slow scrub, DaVinci, drag, precise seek

A DaVinci-style **jog** strip: drag it to scrub slowly (~1 second per 80px)
for frame-hunting without overshooting.

### Volume {#scrub-volume}
**Keywords:** volume, mute, sound, audio level

Adjusts preview volume only.

### Mark In (I) {#scrub-in}
**Keywords:** mark in, start point, in point, I key, trim start

Sets the **start** of a segment at the current position. Press `I`.

### Mark Out (O) {#scrub-out}
**Keywords:** mark out, end point, out point, O key, trim end, commit segment

Sets the **end** and commits the segment. Press `O`. You can mark several
segments and download them all at once.

### Clear segments {#scrub-clear}
**Keywords:** clear, reset, remove all segments, start over

Removes all marked segments and any in-progress draft.

### Chapters: jump & add {#scrub-chapters}
**Keywords:** chapters, markers, sections, jump to chapter, youtube chapters

If the source has chapters, they show as markers. Click a chapter to **jump**
to it, or use its **+** to **add that chapter as a segment** instantly — great
for grabbing one titled section of a long video.

### Segment list {#scrub-segments}
**Keywords:** segments, clips list, seek segment, remove segment

Each committed segment appears in a list. Click one to **seek** to its start,
or use its **✕** to **remove** just that segment.

---

## 7. Library page {#library-page}

**Keywords:** library, browse, my clips, collection, grid, folders, tags

Your saved-clip browser: folders on the left, a grid/list of clips in the
middle, and an inspector drawer for the selected clip.

### Grid view / List view {#lib-view}
**Keywords:** grid, list, view mode, thumbnails, table, layout

Toggle between big **thumbnail grid** and a compact **list** (with columns you
can resize; double-click a divider to reset).

### Search box {#lib-search}
**Keywords:** search, find, filter by name, title, channel

Filters the current view by **title or channel** as you type.

### Source / date filter {#lib-filter-source}
**Keywords:** filter, source, site, date added, when, youtube only

Narrow clips by **where they came from** (YouTube, Twitter, etc.) and **when**
they were added.

### Tag filter {#lib-filter-tags}
**Keywords:** tags, filter tags, labels, categories

Show only clips carrying the tags you pick. See [tags](#lib-tags).

### Clear filters {#lib-clear-filters}
**Keywords:** clear filters, reset, show all, remove filters

Drops all active filters and shows everything in scope again.

### Folders sidebar {#lib-folders}
**Keywords:** folders, organize, nest, move, drag, collections

Your custom folders. A folder chip supports a lot in one place:
- **Click** — filter to that folder.
- **Double-click** — rename it.
- **Right-click** — more actions (color, delete…).
- **Drag onto another folder** — nest it.
- **Drop clips onto it** — move those clips in.

### Create folder {#lib-folder-new}
**Keywords:** new folder, add folder, create, plus

The **+** in the folders sidebar makes a new folder.

### Unfiled {#lib-unfiled}
**Keywords:** unfiled, no folder, uncategorized, loose clips

Clips not in any folder. Drop a clip here to remove it from its folder.

### Include subfolders (rollup) {#lib-rollup}
**Keywords:** subfolders, include children, nested, rollup

When viewing a folder, toggles whether clips from its **subfolders** show too.

### Trash folder {#lib-trash}
**Keywords:** trash, deleted, recover, restore, permanently delete, recycle

Holds deleted clips. From here:
- **Restore** {#lib-trash-restore} — puts the clip back where it was.
- **Permanently delete** {#lib-trash-purge} — removes it for good (files go to
  the OS Recycle Bin; this can't be undone).

See [the Trash concept](#idea-trash).

### Clip card {#lib-card}
**Keywords:** clip, card, thumbnail, tile, open clip

Each clip. Single-click selects it (opens the inspector); double-click or the
**open** action plays it in your default app. An audio-only clip shows a
waveform glyph; a clip whose file was moved/deleted shows a "not found" badge.

### Card: Open {#lib-card-open}
**Keywords:** open, play, default app, watch

Opens the clip in your system's default player.

### Card: Reveal in file manager {#lib-card-reveal}
**Keywords:** reveal, show in explorer, finder, locate file, folder

Opens the folder containing the file and highlights it.

### Card: Move to Recycle Bin (Delete) {#lib-card-delete}
**Keywords:** delete, remove, trash, recycle bin, get rid of

Sends the clip to the [Trash](#lib-trash) (recoverable), then eventually to
the OS Recycle Bin. Shortcut: `Delete`.

### Inspector drawer {#lib-inspector}
**Keywords:** details, info, inspector, drawer, metadata, edit clip

The panel that slides in for the selected clip — shows metadata, thumbnail,
tags, siblings (segments cut from the same source), and per-clip actions.
Close it with the **✕** or `Esc`.

### Tags (add / remove) {#lib-tags}
**Keywords:** tags, label, categorize, add tag, remove tag, keyword

Type in the tag box to **add** a tag (create on the fly), or **✕** a chip to
remove it. Tags power the [tag filter](#lib-filter-tags) and search.

### Folder color {#lib-folder-color}
**Keywords:** color, folder color, colour, no color, label color

Give a folder a color for fast visual scanning; "No color" clears it.

### Selection actions {#lib-selection}
**Keywords:** select multiple, bulk, multi-select, batch actions

Select several clips to act on them together (tag all, delete all, move to a
folder). A bar shows what's selected; **Clear** deselects.

---

## 8. Projects page {#projects-page}

**Keywords:** projects, jobs, buckets, new project, finish project

Manage per-job buckets. See [Library vs. Projects](#idea-library-vs-projects).

### All projects list {#proj-list}
**Keywords:** all projects, list, open project, clip count

Every project with its clip count. Click one to open its detail view.

### New project {#proj-new}
**Keywords:** new project, create, add project, name

Name and create a project (e.g. "Drone Reel"). New downloads go here while
it's the **Active** scope.

### Finish project {#proj-finish}
**Keywords:** finish, done, complete, clean up, close project, delete files

Wraps a project up: it clears the project's files off your disk to keep things
tidy. Use it when the job is delivered.

### Return clips to Library {#proj-return}
**Keywords:** return, move to library, keep clips, unassign

Moves a project's clips back to the permanent Library instead of removing
them — the files stay on disk. Good for keepers you'll reuse.

---

## 9. Settings page {#settings-page}

**Keywords:** settings, preferences, options, configure

Grouped into sections. Each section has a **Reset** button (restores just that
section's defaults).

### Sources {#set-sources}
**Keywords:** cookies, login, browser, sign in, private, age restricted,
cookies.txt, authentication

Point Media Hub at your **browser cookies** so it can download videos that
require you to be signed in (age-restricted, members-only, etc.). Either pick
a browser to pull cookies from, or supply a `cookies.txt` file path. Only
needed when a download asks you to log in. See [the cookies idea](#idea-cookies).

### Library (root + rename) {#set-library}
**Keywords:** save location, folder, where files go, root, rename pattern,
filename, path

- **Library root** — the base folder where downloaded files are stored.
  Leave blank for the default (`~/Media Hub`).
- **Filename pattern** — how files are named, e.g. `{title} [{id}]`.

### Downloads (workers + throttle) {#set-downloads}
**Keywords:** speed, concurrency, parallel, workers, throttle, limit speed,
fast downloads, aria2

- **Concurrency / workers** — how many downloads run at once.
- **Speed limit (KiB/s)** — cap bandwidth so downloads don't hog your
  connection.
- **Fast downloads (aria2)** — optional external downloader for big/segmented
  files; downloads its helper on first enable.

### Transcode (default preset) {#set-transcode}
**Keywords:** default format, ProRes, DNxHD, convert, editing format, preset

Choose the preset applied by default when you transcode. See
[Transcode presets](#idea-presets).

### Browser bridge (extension + scripts) {#set-bridge}
**Keywords:** extension, browser bridge, pairing, token, send to app,
right-click download, connect browser

Connects the Media Hub **browser extension** so you can send videos from your
browser straight to the app.
- **Copy URL** {#set-bridge-url} — the local address the extension connects to.
- **Copy token** {#set-bridge-token} — the pairing secret.
- **Generate new token** {#set-bridge-regen} — makes a fresh token and unpairs
  the old one (use if you think it leaked).

### Diagnostics (read-only) {#set-diagnostics}
**Keywords:** logs, debug, versions, repair, broken, ffmpeg missing, troubleshoot

Read-only health info plus repair tools:
- **Repair tools** {#set-repair} — re-downloads **ffmpeg + deno** if they're
  missing or broken. Try this first if transcoding or previews suddenly fail.
- **Open logs folder** {#set-logs} — opens the folder with `media-hub.log` for
  bug reports.
- Shows the installed **yt-dlp / ffmpeg / deno** versions.

### About {#set-about}
**Keywords:** version, about, update, credits, license

App version and info. Media Hub checks for updates and can update itself.

---

## 10. Browser extension {#extension}

**Keywords:** extension, add-on, addon, browser, send to app, chrome, firefox,
edge, brave

An **optional** browser extension adds a "Send to Media Hub" button to your
browser, so you can push a video into the app's queue without copy-pasting the
URL. Everything still works from the app without it — it's just a shortcut. It
talks **only to your own computer** (localhost); nothing leaves your machine.

### What it does {#ext-what}
**Keywords:** what is the extension, purpose, send to app

Adds a toolbar button (and in-page buttons on some sites) that sends the
current video straight into Media Hub's download queue.

### Installing it {#ext-install}
**Keywords:** install extension, load unpacked, developer mode, chrome extensions

- **Chrome / Edge / Brave:** open `chrome://extensions` (or `edge://`,
  `brave://`), turn on **Developer mode** (top-right), click **Load unpacked**,
  and pick the app's `extension` folder.
- **Firefox:** `about:debugging` → **This Firefox** → **Load Temporary
  Add-on** → pick `manifest.json` in the extension folder. (Firefox forgets it
  when the browser closes.)

Then pair it (below). Full walkthrough: `extension/README.md`.

### Pairing with the app {#ext-pair}
**Keywords:** pair, token, connect, bridge, test connection

A token stops random sites from talking to your app. Pair once:
1. **App:** Settings → [Browser bridge](#set-bridge) → **Copy token**.
2. **Browser:** extension icon → **Options** → paste token → **Save** → **Test
   connection**. A green "Connected" = done. Can't connect? The app must be open.

### Ways to send a video {#ext-use}
**Keywords:** send video, download from browser, shortcut, right click, toolbar, mp3

- **Toolbar button** (everywhere): icon → pick Video / MP3 / M4A / FLAC → Send.
- **In-page button** (Twitter/X, Reddit): hover a video → click the lime
  "Media Hub" button.
- **Right-click** → Send to Media Hub (blocked on some sites — use another way).
- **Keyboard:** `Ctrl+Shift+Y` = current tab as video, `Ctrl+Shift+M` = MP3.
  These work even on YouTube.

### Is it safe / private? {#ext-privacy}
**Keywords:** safe, private, privacy, security, tracking, localhost

Yes. It only talks to `127.0.0.1` (your computer) — nothing goes to the
internet or to us. It only sends a URL **when you click**; it never downloads
on its own. The token is a password so other sites can't fire downloads at
your app.

### Extension won't connect / button missing {#ext-trouble}
**Keywords:** extension not working, offline, can't connect, button not showing, reload

- **"Offline" / can't connect** → the desktop app isn't running. Open it.
- **In-page button missing** → refresh the page (`Ctrl+F5`); it only appears on
  freshly loaded pages.
- **Changed the token** → re-open the extension Options, paste the new token, Save.
- **Edited extension files** → reload it from `chrome://extensions` (↻ on the card).

---

## 11. Keyboard shortcuts {#shortcuts}

**Keywords:** shortcuts, hotkeys, keys, keyboard

| Key | Does |
|-----|------|
| `1` | Go to Download |
| `2` | Go to Library |
| `3` | Go to Projects |
| `,` | Go to Settings |
| `Ctrl+Space` | Open search / command palette |
| `Space` | Play/pause in the [Scrubber](#scrubber) |
| `←` / `→` | Step one frame back/forward |
| `I` / `O` | Mark In / Mark Out |
| `Ctrl` (hold) + Download | Override this download into the Library |
| `Delete` | Move selected clip to Trash |
| `Esc` | Close the open drawer/dialog |

(Number/letter shortcuts are ignored while you're typing in a text box.)

---

## 12. Troubleshooting {#troubleshooting}

**Keywords:** problem, error, not working, fix, help, broken, fails

**A download fails or errors out**
→ Usually one of: (1) the video needs a login → [cookies](#set-sources);
(2) the site changed and the downloader is out of date → a newer app build
ships a newer yt-dlp (check versions in [Diagnostics](#set-diagnostics));
(3) a bad/region-locked URL → confirm it plays in your browser. Still stuck?
[Report it](#reporting-bugs) with the log.

**"Sign in / not a bot / video unavailable" on download**
→ The site needs you logged in. Set up [Sources / cookies](#set-sources).

**Transcode or preview suddenly fails**
→ ffmpeg/deno may be missing or corrupted. Run
[Diagnostics → Repair tools](#set-repair).

**Stuck on first-run setup / tools won't download**
→ First launch downloads ffmpeg + deno; a stall is almost always a
firewall/VPN blocking GitHub. Try again on a normal connection, or
[Diagnostics → Repair tools](#set-repair).

**App won't open or shows a blank window**
→ It may be running **hidden in the system tray** (it keeps downloads alive in
the background) — find it there and Quit, then reopen. If a blank window
persists, reinstall over the top; your library and settings aren't touched.

**Preview is slow to seek**
→ Lower the [Preview quality](#idea-preview); the first seek also has to fetch
a proxy, so give it a moment on a new video.

**Download is slow**
→ Enable **Fast downloads (aria2)** in [Downloads settings](#set-downloads),
especially for large or segmented files.

**A clip shows "file not found"**
→ Its file was moved or deleted outside the app. Re-download it, or reveal to
check where it went.

**Update didn't install / wrong version**
→ Check [Settings → About](#set-about). Fully quit (including from the tray)
and reopen so a downloaded update can swap in, or reinstall the latest.

**Where are the logs?**
→ [Diagnostics → Open logs folder](#set-logs) (`media-hub.log`).

**I deleted a clip by accident**
→ Check the [Trash folder](#lib-trash) and **Restore** it — as long as you
haven't permanently deleted it.

---

## 13. Reporting bugs {#reporting-bugs}

**Keywords:** report bug, bug report, issue, feedback, broken, how to report, logs

A good report gets fixed fast. Please include:

1. **What you did**, what you **expected**, and what **happened** instead.
2. The **exact URL** if it's a download/fetch problem — many bugs are
   site-specific.
3. Your **app version** ([Settings → About](#set-about)) and **OS**
   (e.g. Windows 11).
4. The **log file** — [Diagnostics → Open logs folder](#set-logs) → attach
   `media-hub.log`. *(This is the single most useful thing — it usually shows
   the real error.)*
5. A **screenshot** of any error message.

Send it wherever the project points you (GitHub issues / the release thread).

---

## 14. For developers {#developers}

**Keywords:** developer, contribute, build, source, architecture, api, hack

Media Hub is open source. This section is for anyone who wants to build it,
extend it, or understand how it fits together.

### What it's built with {#dev-open-source}
**Keywords:** stack, tech, tauri, rust, react, typescript, sqlite

A **Tauri 2** desktop app: a **Rust** core + a **React + TypeScript (Vite)**
frontend, an **SQLite** library, and **yt-dlp / ffmpeg / deno** as helper
binaries. The UI calls Rust through Tauri **commands** (`invoke`) and listens
to **events** for live progress. See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

### Run it from source {#dev-run-source}
**Keywords:** dev setup, build from source, run locally, npm, cargo, tauri dev

Requirements: **Node.js 20+**, **Rust stable** (via [rustup](https://rustup.rs)),
and platform webview build tools (Windows: VS C++ Build Tools; macOS: Xcode CLT).

```bash
npm install
pwsh scripts/fetch-sidecars.ps1     # yt-dlp + ffmpeg (gitignored); mac: fetch-sidecars-mac.sh
npm run tauri dev                    # first Rust build takes several minutes
```

### Build an installer {#dev-build}
**Keywords:** build, installer, release, package, msi, exe

`npm run tauri build` → installer under `src-tauri/target/release/bundle`.
Releases are tag-driven: push a `v*` tag and GitHub Actions builds Windows +
macOS, signs the updater artifacts, and drafts a release. Checks: `npx tsc
--noEmit` (frontend) and `cargo test` (in `src-tauri`).

### Where the code lives {#dev-structure}
**Keywords:** structure, layout, files, modules, architecture map

- **`src/`** (frontend) — `pages/` (Download, Library, Projects, Settings,
  Help), `components/` (Scrubber, Onboarding, HelpHint…), `lib/` (settings,
  downloads, types, `helpContent`, `helpSearch`).
- **`src-tauri/src/`** (backend) — `lib.rs` wires everything; feature modules:
  `download`/`direct`, `library`, `settings`, `tools` (lazy ffmpeg/deno),
  `transcode`, `metadata`, `playlist`, `preview`, `media_extract`, `bridge`
  (extension server), `tray`, `updater`, `diag`.
- **`extension/`** — the MV3 browser add-on. **`docs/`** — read first.

### Add a command or feature {#dev-add-feature}
**Keywords:** add command, new feature, tauri command, invoke, backend

Write a `#[tauri::command]` in the relevant module, register it in the
`generate_handler!` list in `lib.rs`, then call it from the frontend with
`invoke("your_command", { args })`. For long-running work, emit **events**
(`Emitter`) and `listen()` on the frontend — that's how downloads/transcodes
stream progress. Keep splits behavior-neutral; run `cargo test` + `tsc`.

### Hack on the browser extension {#dev-extension}
**Keywords:** extension dev, content script, background, manifest, bridge

Plain MV3, **no build step** — edit a file, hit reload on `chrome://extensions`.
It talks to the app's local bridge server (**`127.0.0.1:47821`** by default)
using the pairing token in `chrome.storage.local` as auth. `background.js`
routes messages; `content-*.js` add in-page buttons; `bridge.js` is the shared
HTTP client. See [`extension/README.md`](../extension/README.md).

### How this Help / docs system works {#dev-docs}
**Keywords:** help docs, add topic, translate, i18n, question mark, tooltip

In-app Help renders from `src/lib/helpContent.ts` (mirrored by this file).
**Add a topic:** append a `HelpEntry` with a `category` — every entry `id` is a
stable anchor. The **(?)** tooltips (`HelpHint`) deep-link to `/help#<id>`; the
search (`lib/helpSearch.ts`) is typo/synonym-tolerant. **Translate:** drop in
`helpContent.<lang>.ts` with the same ids + a `case` in `getHelpContent` — no
page changes. **Rule:** never rename an existing anchor id once a (?) points at
it.

### Contributing {#dev-contribute}
**Keywords:** contribute, pull request, pr, github, help out

Issues and PRs welcome. Keep changes focused, run `npx tsc --noEmit` and
`cargo test` before opening a PR, and say what changed and why. Not a coder?
Clear [bug reports](#reporting-bugs) with logs and testing new releases are
genuinely valuable.
