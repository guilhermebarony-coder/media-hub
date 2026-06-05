# Media Hub — Architecture

Status: living doc, last refreshed 2026-06-04 (post 1.3.3). This document
is the **map** of what's actually built and where it lives. As code
lands, this doc updates to match. If it drifts, fix the doc. Detailed
contracts live in per-module header comments.

**What landed in the 1.3.x line (on top of the 1.2.15 baseline below):**
- **Pinterest / TikTok / Instagram / YouTube extension overlays** — the
  body-portal in-page download button generalized beyond Twitter/Reddit;
  click-time live `<video>.currentSrc` capture; sniffer panel rework
  (group-by-quality + inline preview + filter chips).
- **Direct HTTP download path** (`src-tauri/src/direct.rs`) — reqwest
  streaming with platform-aware Referer headers, for CDN/sniffed URLs
  yt-dlp can't handle.
- **Command palette** (`src/components/CommandPalette.tsx`) — Ctrl+Space;
  Clips / Projects / Tags tabs; cross-route handoff via CustomEvents
  (`mh:open-asset`, `mh:apply-tag-filter`).
- **Library list view** — toggle alongside the grid; ratio-based
  resizable + sortable columns; selection/drag/context-menu parity with
  cards.
- **Background mode** (`src-tauri/src/tray.rs`) — topbar eye button hides
  the window to the system tray; backend + download queue keep running;
  live tray tooltip; left-click / Show / Quit.
- **In-app dialogs** (`src/lib/dialog.ts` + `src/components/DialogHost.tsx`)
  — replaced native OS dialogs (and their system chime) with a styled,
  silent modal behind the same async `confirmDialog` / `alertDialog` API.
- **App auto-updater** (`tauri-plugin-updater`) — signed bundles verified
  against the embedded pubkey; GitHub Releases `latest.json` endpoint.
  Preferred-max-quality setting; per-platform pretty titles.

**1.2.15 baseline:** audio downloads + the browser-extension stack
(localhost HTTP bridge, `mediahub://` deep link, sideloadable MV3
extension with stream sniffer + in-page buttons on Twitter/Reddit).
**1.1.6 baseline:** DownloadsProvider lifted above the router, keep-alive
Shell, topbar ActivityBadge, OrphanScanner on boot, CloseGuard removed
(Tauri bug #7119).

✅ = shipped · 🟡 = planned · ❌ = decided against

---

## 1. The three layers

Media Hub is a Tauri 2 desktop app with three clean layers and one
external dependency surface.

```
   ┌────────────────────────────────────────────────┐
   │  Renderer (React 19 + TypeScript + Vite)       │
   │  - UI, state, user input                       │
   │  - Owns the download queue (React state +      │
   │    localStorage persistence)                   │
   │  - Talks to backend ONLY via Tauri invoke()    │
   │    and event subscriptions                     │
   └──────────────────────┬─────────────────────────┘
                          │  invoke() · listen()
   ┌──────────────────────▼─────────────────────────┐
   │  Backend (Rust, in src-tauri/)                 │
   │  - Tauri commands (the IPC surface)            │
   │  - Sidecar orchestration + progress streaming  │
   │  - SQLite persistence (library + tags)         │
   │  - Stateless except for the SqlitePool         │
   └──────────────────────┬─────────────────────────┘
                          │  spawn / stdout pipe
   ┌──────────────────────▼─────────────────────────┐
   │  Sidecars (bundled binaries)                   │
   │  - yt-dlp:  metadata + download                │
   │  - ffmpeg:  trim + transcode + thumbnails      │
   └────────────────────────────────────────────────┘
```

The renderer **never** spawns processes directly and **never** touches
the filesystem outside what Tauri's capabilities allow. Every action
that mutates disk goes through a Rust command.

**Notable architectural choice:** the batch download queue lives in
the **renderer**, not Rust. This deviates from the original
dev0-plan. Reasons it ended up there: progress events already flowed
to the UI; React owned the worker-pool-orchestration sweet spot with
useEffect + refs; localStorage gave persistence for free. Rust stayed
the single-purpose "run one yt-dlp / ffmpeg with progress" worker.
The trade-off: closing the app mid-job actually loses that job (no
Rust-side queue daemon). We accept that for now — see NOTES.md
"queue persistence" for the resume strategy.

---

## 2. On-disk layout (ground truth)

What's actually written under the user's home directory today:

```
~/Media Hub/                                ← default content root
├── library.db                              ← SQLite WAL-mode, single file
├── _thumbnails/<asset_uuid>.jpg            ← extracted mid-clip frames (480w q=4)
├── Library/
│   └── raw/                                ← unscoped (Library) downloads
│       ├── <title> [<id>].<ext>            ← source (segments deleted after trim)
│       ├── <title> [<id>] [<in>_<out>].<ext>     ← segment-trimmed outputs
│       └── <stem>.<preset>.<out_ext>       ← transcoded outputs
└── Projects/<slug>/                        ← per-project scope (Phase B)
    └── raw/                                ← same structure as Library/raw
```

The `raw/` subfolder reserves the project root for future siblings
(`proxies/` for scrubber lo-res, `exports/` if we add user-facing
exports). NLEs pointed at the project root pick up `raw/`
auto-import naturally.

**Slug stability:** the project slug is computed at create time and
NEVER recomputed on rename. Renaming a project's display name keeps
the on-disk folder name stable so existing files stay reachable.

**Override paths (0.8.C):**
```
<library_root>/Library/raw/...              ← if settings.library_root set
<library_root>/Projects/<slug>/raw/...
<library_root>/_thumbnails/...
~/Media Hub/library.db                      ← STAYS at default (intentional)
```

The library DB intentionally stays at the default `~/Media Hub/`
regardless of `library_root` — moving an open SQLite file mid-session
is fiddly and the user-visible win is small. Documented in the
Settings → Library hint.

**Settings persistence (0.8.A):**
```
%APPDATA%\com.guilherme.mediahub\settings.json   (Windows)
~/Library/Application Support/com.guilherme.mediahub/settings.json   (macOS)
~/.config/com.guilherme.mediahub/settings.json   (Linux)
```

Atomic writes: serialize to `settings.json.tmp` then rename. Missing
or malformed file falls back to defaults — settings are never load-
blocking. `#[serde(default)]` on the struct + every field means
older settings.json files keep loading cleanly as we add fields.

Browser-side state (localStorage):
```
mh.queue.v1          ← batch download queue (active + queued + completed jobs)
mh.activeScope.v1    ← which scope (Library or project) the user is in
mh.volume.v1         ← scrubber preview volume (persisted across sessions)
```

**Path safety:** no formal `assert_in_library_root` helper yet. All
write paths are computed by Rust handlers from a known-safe parent
(content_root resolved via `settings::content_root()`), so
user-controllable strings never become parent-path components. Project
slugs are sanitized at create time (`library::slugify`) so user-typed
project names can't escape the Projects/ tree. Lock this down with a
proper helper if we ever add user-controllable subfolders inside
project scope.

---

## 3. Tauri command surface (the IPC contract)

Naming convention: `<domain>_<verb>` (snake_case, single word per
domain). This is the actual shape — the dev0 plan had `<domain>:<verb>`
colon-namespaced commands; Tauri's `generate_handler!` macro pushed us
to a flat snake_case namespace and we never went back.

Commands are registered in `src-tauri/src/lib.rs::run()` via
`tauri::generate_handler![…]`.

### Shipped commands

| Command | File | Purpose |
|---------|------|---------|
| `binaries_version` | lib.rs | Returns yt-dlp + ffmpeg version strings — surfaced in Settings → Diagnostics |
| `yt_fetch_metadata` | lib.rs | `yt-dlp -j` — title/duration/formats/thumbnail. Injects cookies + bandwidth from settings. Errors run through `translate_ytdlp_error` |
| `yt_resolve_stream_url` | lib.rs | `yt-dlp -g` — direct playable URL for the scrubber's HTML5 `<video>` preview. No download |
| `yt_download` | lib.rs | Full source via yt-dlp, optionally followed by N ffmpeg `-c copy` trims for multi-segment. Returns `Vec<DownloadResult>`. Honors `project_id` + content_root for routing. Renames via `settings::build_filename_template` |
| `media_transcode` | lib.rs | Re-encodes via ffmpeg, one of 4 presets (ProRes 422 LT / DNxHR SQ / H.264 libx264 / H.264 NVENC). `-hwaccel auto` for hw decode |
| `media_extract_thumbnail` | lib.rs | Mid-clip JPG (480w q=4) into `<content_root>/_thumbnails/<asset_id>.jpg` |
| `library_insert` | library.rs | Inserts an asset row; returns UUID |
| `library_list` | library.rs | Assets matching filters (query + tag-AND + scope + limit), each with its tag list + `sibling_count` |
| `library_count` | library.rs | Total asset count matching filters |
| `library_delete` | library.rs | Removes a row; optional `delete_file` also removes file + thumbnail. CASCADE drops asset_tags |
| `library_delete_many` (1.1) | library.rs | Bulk version — single sqlx tx + per-file OS-trash via `trash` crate. Returns `BulkDeleteResult { rows_deleted, files_removed, file_errors }` |
| `library_set_thumbnail` | library.rs | Records a local thumbnail path |
| `library_thumbnails_missing` | library.rs | Lists assets with no `thumbnail_path` for backfill loop |
| `library_repair_thumbnails` (1.1) | library.rs | Heals rows whose `thumbnail_path` points at a missing file (NULLs them so backfill regenerates). Auto-runs on Library mount |
| `library_migrate_root` (1.0.5) | library.rs | Physically moves `Library/`, `Projects/`, `_thumbnails/` to a new root + rewrites every `assets.file_path` and `thumbnail_path` row in a single tx. Refuses self-moves / cycles / in-flight downloads |
| `library_siblings` | library.rs | Returns peer assets sharing the same `source_url` (multi-segment relationships) |
| `library_find_by_url` | library.rs | Duplicate-check helper used by the Download page before fetch |
| `tag_set_for_asset` | library.rs | Replace-all tag set in one transaction |
| `tag_list_all` | library.rs | All tags with usage counts, alphabetical, orphans hidden |
| `project_create / list / rename / delete` | library.rs | CRUD for projects. Slug derived at create; never recomputed on rename |
| `project_finish` | library.rs | Lifecycle endgame — optionally promote assets to Library, OS-trash the project folder, delete the row |
| `asset_set_project` | library.rs | Physical move between Library ↔ project scope (rename + cross-volume copy/delete fallback + collision-safe naming) |
| `folder_create / list / rename / delete` (1.1) | library.rs | Folder CRUD. Flat (no nesting yet); FK ON DELETE SET NULL so dropping a folder falls assets back to Uncategorized |
| `asset_set_folder` / `asset_set_folder_many` (1.1) | library.rs | Single or batch folder assignment. Powers the inspector folder dropdown |
| `yt_fetch_playlist` (1.1) | lib.rs | `yt-dlp --flat-playlist -J` — enumerates playlist entries (id/title/thumb/url) for the picker. Caps at 500 entries |
| `yt_download_cancel` (1.0.1) | lib.rs | Looks up + kills the registered CommandChild for a job_id, marks canceled in JobRegistry |
| `cookies_validate` (1.0.3) | settings.rs | Inspects a cookies.txt file, reports counts + whether it carries a real YouTube auth token (LOGIN_INFO / __Secure-*PSID) |
| `settings_get / settings_set` | settings.rs | Read/write the user settings struct. Atomic disk write, emits `settings:changed` |

### Shipped events (renderer subscribes via `listen()`)

| Event | Payload | Emitted by | Drives |
|-------|---------|------------|--------|
| `download:progress` | `{ job_id?, downloaded_bytes, total_bytes?, percent?, speed_bps?, eta_sec? }` | `yt_download` (filesystem-poll task) | Single-URL bar + queue rows |
| `transcode:progress` | `{ job_id?, processed_sec, total_sec?, percent?, speed_mult? }` | `media_transcode` (parses `-progress pipe:1`) | Transcode bar |
| `library:changed` | `{}` | `library_insert/delete/set_thumbnail/...`, all project + tag commands | Library page auto-refresh, sibling lists, active-scope context refresh |
| `settings:changed` | `{}` | `settings_set` | SettingsProvider refetches & re-broadcasts to subscribers (Download workers, etc.) |

`job_id` is `null` for the single-URL flow and a job UUID for batch
jobs — the renderer routes events to the right UI by that field.

### Planned commands (post-0.8)

- 🟡 `cookies_test` — runs a no-op `yt-dlp --simulate` to verify the
  current cookies config works. Slated for 0.9.C (bug census polish)
- 🟡 `asset_relocate(asset_id, target_root_id)` — multi-root move,
  if/when multi-root library lands (0.9 or 1.2)
- 🟡 Platform trait commands when 1.x platforms are added

---

## 4. Sidecar orchestration

Both `yt-dlp` and `ffmpeg` are spawned via `tauri-plugin-shell`. The
pattern that ended up working:

1. Resolve sidecar by **basename only**: `app.shell().sidecar("ffmpeg")`.
   Tauri strips any path prefix; the capability's `allow.name` must
   match the basename or the spawn fails with OS error 3.
2. Build args vector — never string-concat user input. argv stays
   structured.
3. Spawn returns `(rx, _child)` — `rx` is an `mpsc` receiver of
   `CommandEvent::{Stdout, Stderr, Terminated}`. We `recv().await`
   in a loop until `Terminated`.
4. Parse stdout line-by-line:
   - **yt-dlp:** we don't trust its stdout progress lines (Python's
     PyInstaller bundle block-buffers stdout when piped — they
     arrive in one burst at process end). Instead we **poll the
     filesystem** in a sibling task while yt-dlp runs. See NOTES.md
     "Progress streaming saga."
   - **ffmpeg:** structured `key=value` lines from `-progress pipe:1`,
     terminated by `progress=continue` (or `progress=end`).
5. Accumulate stderr in a 50-line ring; surface the tail on non-zero
   exit code so the user sees an actionable error.

### Windows MFT cached file-size gotcha

`std::fs::metadata(path).len()` returns the MFT's cached size, which
doesn't tick up live while a file is being written. The fix:

```rust
fn live_file_size(path: &std::path::Path) -> Option<u64> {
    let mut f = OpenOptions::new().read(true).open(path).ok()?;
    f.seek(SeekFrom::End(0)).ok()
}
```

Opening + seeking to end forces a fresh size read. ~1ms per poll on
SSDs. Polling cadence is 500ms with a rolling 5-sample window for
speed smoothing.

### Sidecar bundling

- Win: `yt-dlp.exe` + `ffmpeg.exe` in `src-tauri/binaries/`
- Mac: 🟡 not yet fetched. Tauri's per-arch suffix scheme
  (`-x86_64-apple-darwin` / `-aarch64-apple-darwin`) will apply.
- `tauri.conf.json > bundle > externalBin` lists them so the
  installer picks them up.
- `scripts/fetch-sidecars.ps1` grabs latest stable releases. Manual
  update, no runtime auto-update of sidecars — they're vendored.

---

## 5. The download queue (✅ shipped, lives in the renderer)

Located in `src/pages/Download.tsx::QueueCard`. Not in Rust.

```ts
type QueueJob = {
  id: string;              // newJobId() -> "job-<ts>-<rand>"
  url: string;
  status: "queued" | "fetching" | "downloading" | "transcoding"
        | "done" | "failed";
  transcodePreset: TranscodePreset;   // captured at enqueue, locked
  title?, channel?, thumbnail?, duration_sec?
  progress?, transcodeProgress?
  resultPath?, resultBytes?, error?
}
```

**Concurrency model:**
- `DOWNLOAD_WORKERS = 3` worker loops pull from the queue in
  parallel. Each is just an async function that scans `jobsRef` for
  the next unclaimed `queued` job, processes it, repeats. Self-
  terminates when no work found; spun back up by a `useEffect`
  watching the jobs array.
- Atomic claim via a ref-Set so two workers can't grab the same job.
- Two module-scoped semaphores (`cpuTranscodeSem`, `gpuTranscodeSem`,
  each `permits: 1`) serialize transcodes by hardware pool. A
  libx264 CPU job and an h264_nvenc GPU job can run simultaneously.

**Persistence:** the whole jobs array is JSON-stringified to
`localStorage["mh.queue.v1"]` on every state change. On load, jobs
that were mid-flight (`fetching` / `downloading` / `transcoding`)
reset to `queued`. We don't try to resume the Rust-side download —
yt-dlp's `.part` file would be stale; cleaner to re-fetch from zero.

---

## 6. The library DB (✅ shipped through 0.5.1)

SQLite via `sqlx` 0.8 (`runtime-tokio` + `sqlite` + `chrono` +
`macros` features). Compile-time query checking not used — no
`DATABASE_URL` requirement at build time, just runtime queries.

Path: `~/Media Hub/library.db`. WAL mode + 5s busy_timeout +
`foreign_keys=on`.

### Schema (current)

```sql
-- 001_initial.sql       assets table (id, source_url, video_id, channel,
--                       title, duration_sec, in_sec, out_sec, file_path,
--                       file_size, container, codec_video, codec_audio,
--                       width, height, fps, transcoded_to, thumbnail_url,
--                       downloaded_at) + 3 indexes
-- 002_tags.sql          tags(id, name UNIQUE NOCASE) + asset_tags M2M w/
--                       CASCADE on asset, CASCADE on tag
-- 003_thumbnails.sql    ALTER TABLE assets ADD COLUMN thumbnail_path
-- 004_projects.sql      projects(id, name, slug UNIQUE, created_at) +
--                       ALTER TABLE assets ADD COLUMN project_id
--                       REFERENCES projects(id) ON DELETE SET NULL
```

`assets.project_id` is NULL when the asset belongs to the Library
scope (the default). When set, it points at a `projects.id` and the
file lives under `<content_root>/Projects/<slug>/raw/`.

**Migration runner** (`library::init`) loads each file via
`include_str!`, splits on `;` after stripping `--` comments, executes
each statement. The loop silently swallows "duplicate column name"
errors so the non-idempotent `ALTER TABLE ADD COLUMN` doesn't break
re-runs. Switch to a real migrations-tracking table when we have a
fourth ALTER.

**Search:** plain `LIKE %query%` on `title` and `channel` for now,
case-insensitive. Fine for <10k assets. FTS5 upgrade is a deferred
item in ROADMAP.

**Tag semantics:** the renderer can pass a list of required tags;
each becomes an `EXISTS (SELECT 1 FROM asset_tags…)` clause, ANDed.
Matches the "narrow down by adding chips" UX. Casing is preserved
on insert via `INSERT OR IGNORE` + NOCASE collation — UI shows the
original casing, matching is case-insensitive.

**Orphan tag rows are kept** (last asset deleted/untagged). The
`tag_list_all` query filters with `HAVING count > 0` so they're
invisible in the UI cloud, but re-adding the same tag re-uses the
original row + casing instead of creating a duplicate.

---

## 7. Thumbnail extraction (✅ 0.5.1)

After every successful download (single-URL or batch), the renderer
fires `attachLocalThumbnail(assetId, srcPath, durationSec)` as
fire-and-forget. That calls:

1. `media_extract_thumbnail` — ffmpeg `-ss <duration/2 or 1s> -i <src>
   -frames:v 1 -vf scale=480:-2:flags=lanczos -q:v 4` → writes
   `~/Media Hub/_thumbnails/<asset_id>.jpg` (~30–80 KB).
2. `library_set_thumbnail(asset_id, path)` — UPDATEs the row, fires
   `library:changed`. The UI re-renders with the local thumb.

`-ss` goes BEFORE `-i` for fast keyframe seek (decoder skips to the
nearest keyframe before the requested timestamp). Frame-accurate seek
would need `-ss` after `-i`; overkill for a thumbnail.

**Backfill:** the Library page mounts → calls
`library_thumbnails_missing` → walks the result serially with 150ms
between extractions. Existing assets fill in over time without CPU
thrashing.

**Asset protocol serving:** `tauri.conf.json` has
`app.security.assetProtocol = { enable: true, scope: ["$HOME/**", "**"] }`.
The renderer uses `convertFileSrc(localPath)` to turn a Windows path
into an `asset.localhost/...` URL the webview can load. The `**`
fallback (added 1.1) lets the WebView load thumbnails from a custom
`library_root` that lives outside `$HOME` (e.g. `E:\Media Hub Library\`).
Works identically in dev and packaged builds.

---

## 8. UI shell (✅ shipped + extended through 0.8.D)

`react-router-dom` v7 with **HashRouter** (avoids `tauri://` vs
`http://localhost` origin issues). Routes:

```
/              → /library (redirect)
/download      → DownloadPage   (MetadataCard + Scrubber + QueueCard)
/library       → LibraryPage    (3-col: folders sidebar | grid w/ box-drag
                                 + multi-select | always-on inspector)
/projects      → ProjectsPage   (create / rename / delete / finish)
/settings      → SettingsPage   (Sources / Library / Downloads /
                                 Transcode / Diagnostics / About)
*              → /library (catch-all)
```

`Shell` component owns the persistent chrome (44px top bar + 216px
left nav) and renders `<Outlet />` for the active route. Stays
mounted across route changes so navigation is instant.

**Top-of-tree providers** (App.tsx, outermost first):
- `<SettingsProvider>` — loads settings.json on mount, exposes
  `{ settings, ready, save }` via context. Uses `useRef` mirror to
  avoid React's stale-closure trap when computing optimistic updates
  (see NOTES.md 2026-05-21 settings race fix).
- `<OnboardingGate />` — first-run modal (0.8.D). Renders nothing
  when `settings.onboarding_complete` is true; otherwise overlays
  the whole app with a 4-step wizard.
- `<ActiveProjectProvider>` — exposes `{ scope, setScope }`. Persists
  to `localStorage.mh.activeScope.v1`. Subscribes to
  `library:changed` so the picker refreshes when projects mutate.

**Design tokens:** lifted verbatim from `design-reference/Media Hub
Wireframes.html` with the amber accent recolored to our lime
`#c7f154`. Geist + Geist Mono via `@fontsource` — no runtime network
dependency.

---

## 9. Source layout (current)

```
media-hub/
├── src/                              ← React frontend
│   ├── App.tsx                       ← SettingsProvider → OnboardingGate → ActiveProjectProvider → Router
│   ├── main.tsx                      ← React.createRoot entry
│   ├── App.css                       ← Design tokens + all component styles
│   ├── shell/
│   │   └── Shell.tsx                 ← TopBar + Nav + <Outlet />
│   ├── pages/
│   │   ├── Download.tsx              ← MetadataCard + Scrubber + QueueCard
│   │   ├── Library.tsx               ← Grid + filter sidebar + drawer
│   │   ├── Projects.tsx              ← Real (0.6 — create / rename / delete / finish)
│   │   └── Settings.tsx              ← 6 sections (Sources / Library / Downloads / Transcode / Diagnostics / About)
│   ├── components/
│   │   ├── Scrubber.tsx              ← HTML5 video + multi-segment marking + jog (0.6.D + 0.6.1)
│   │   └── Onboarding.tsx            ← First-run modal (0.8.D) — 4 screens, configures inline
│   └── lib/
│       ├── types.ts                  ← Shared TS types (mirror Rust serde)
│       ├── format.ts                 ← fmtDuration, fmtBytes, parseTimestamp
│       ├── library.ts                ← recordInLibrary, attachLocalThumbnail, thumbnailSrc
│       ├── settings.tsx              ← SettingsProvider + useSettings hook
│       ├── activeProject.tsx         ← ActiveProjectProvider + useActiveProject hook
│       ├── downloads.tsx             ← 1.1.3: DownloadsProvider (queue + single-URL state, listeners, workerLoop) lifted above router
│       └── icons.tsx                 ← Inline SVG icon set
├── src-tauri/                        ← Rust backend
│   ├── src/
│   │   ├── lib.rs                    ← App bootstrap + sidecar/yt/transcode/thumb/stream commands
│   │   ├── library.rs                ← SQLite layer + library/tag/project commands
│   │   └── settings.rs               ← settings.json persistence + cookies/bandwidth/template/error-translator helpers
│   ├── migrations/
│   │   ├── 001_initial.sql
│   │   ├── 002_tags.sql
│   │   ├── 003_thumbnails.sql
│   │   ├── 004_projects.sql
│   │   └── 007_folders.sql           ← 1.1 folders + assets.folder_id
│   ├── capabilities/
│   │   └── default.json              ← shell:execute (yt-dlp, ffmpeg) + opener + dialog + drag scopes
│   ├── binaries/                     ← Bundled yt-dlp + ffmpeg (gitignored)
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json               ← bundle.externalBin + assetProtocol scope
├── docs/
│   ├── ROADMAP.md
│   ├── ARCHITECTURE.md               ← this file
│   ├── NOTES.md                      ← working notes + parking lot
│   └── FEEDBACK.md                   ← collaboration notes
├── design-reference/                 ← Handoff JSX (design spec, not run)
├── scripts/
│   └── fetch-sidecars.ps1            ← Grab latest yt-dlp / ffmpeg
├── package.json                      ← @tauri-apps/{api, plugin-opener, plugin-shell, plugin-dialog} + @crabnebula/tauri-plugin-drag
└── tsconfig.json
```

**What ISN'T in the layout** (deliberate, vs the dev0 plan):
- ❌ No `src-tauri/src/commands/` per-domain split — three files
  (`lib.rs`, `library.rs`, `settings.rs`) is small enough that
  splitting adds ceremony without payoff. Re-evaluate at 1500+ LOC
  per file (lib.rs is approaching this; splitting commands by
  domain is on the radar for 0.9 if it helps readability).
- ❌ No `src-tauri/src/platform/` trait yet — YouTube-only until 1.x.
- ❌ No `src-tauri/src/sidecar/` parser split — inline parsing in
  each command. Will refactor if a third sidecar joins.
- ❌ No `src/hooks/` directory — bare `useState` + `useEffect` +
  context providers. Add it back if state caching ever becomes painful.

---

## 10. Cross-cutting concerns

### Error handling
Rust commands return `Result<T, String>` where the error string is
user-facing. Internal panics are unreachable; the frontend surfaces
errors in a `msg-row` element. No structured error type yet.

### Logging
`println!` for now in dev; production logging is a 0.8 packaging
concern. `tracing` crate planned at that point + ring buffer for a
"download diagnostic bundle."

### Settings (✅ 0.8.A → D)

Persisted to `settings.json` in the OS-standard app-config dir. Loaded
once on Rust startup, exposed via Tauri's `State<SettingsState>`,
mirrored on the frontend by `SettingsProvider` (React context).

Shape:
```rust
pub struct Settings {
    pub cookies_source: CookiesSource,         // None | Browser{name} | File{path}
    pub library_root: Option<String>,          // override of ~/Media Hub
    pub rename_template: String,               // {title}/{channel}/{date}/{id} tokens
    pub download_concurrency: u32,             // 1..=6, default 3
    pub bandwidth_limit_kbps: Option<u32>,     // yt-dlp --limit-rate
    pub default_transcode_preset: String,      // pre-fills the per-download picker
    pub onboarding_complete: bool,             // gates the first-run modal
    pub last_formats: HashMap<String, String>, // sticky format per platform
}
```

Save flow: optimistic React update + IPC to Rust → atomic disk write
(tmp + rename) → emit `settings:changed`. The provider mirrors live
state in a `useRef` so successive saves see fresh data (NOT the stale
closure — see the 2026-05-21 race fix in NOTES.md).

Helper functions in `settings.rs`:
- `content_root(state, home)` — resolves library_root override or
  default. Used by `yt_download`, `media_extract_thumbnail`,
  `asset_set_project`, `project_finish`, `library_delete`.
- `cookies_args(state)` — yt-dlp argv extras for cookie mode
- `bandwidth_args(state)` — yt-dlp argv extras for --limit-rate
- `rename_template(state)` + `build_filename_template(s)` — token →
  yt-dlp `-o` template converter
- `translate_ytdlp_error(raw)` — pattern-matches common yt-dlp
  failures and returns friendly + actionable messages
  (closed-browser cookie lock, age-gate, private, members-only, etc.)

### Concurrency model
- Frontend: bare React; semaphores for transcode pools, useRef for
  worker pool atomic claim
- Backend: `tokio` (provided by `tauri::async_runtime`); each
  command is its own async task. SqlitePool shared via Tauri's
  managed `State<LibraryState>`.

---

## 11. What's NOT here (yet)

Deliberately deferred or never:
- ❌ Auto-update — manual download for 1.0
- ❌ Telemetry — never (per non-goals)
- ❌ Plugin system — never in 1.x
- ❌ Localization — English only for 1.0
- ❌ Code signing — defer until distribution path warrants it
- 🟡 Packaging (.msi/.dmg, sidecar bundling) — folded into 1.0
- 🟡 Performance audit + leak hunting — 0.9
- 🟡 Multi-root library / per-project external root — 0.9 (TBD) or 1.2
- 🟡 Platform abstraction (Twitter/X/TikTok) — post-1.0 (was 0.7)
- 🟡 FTS5 search — defer until LIKE perf hurts
- 🟡 Eagle-style overhaul (folders, color labels, ratings) — 1.2
- ✅ Drag-to-NLE — 1.1.2 (via `tauri-plugin-drag`, single-gesture for
  both folder-drop and OS drag-out; live folder hover has a Windows-OLE
  open bug — see 1.1.2 notes below)

---

## 11. 1.1.2 — Drag & drop wiring (Tauri + plugin-drag)

**Plugin**: `@crabnebula/tauri-plugin-drag@2.1.0` (npm) + `tauri-plugin-drag@2.1.1`
(Rust). Registered in `lib.rs` next to opener/shell/dialog. Permission
`drag:default` added to `capabilities/default.json`.

**Frontend wiring (Library.tsx):**
- `<LibCard>` is `draggable type="button"`, fires `onCardDragStart`.
- `onCardDragStart` calls `ev.preventDefault()` (kills the HTML5 drag)
  then `startDrag({ item: filePaths, icon: thumbPath, mode: "copy" })`.
- Selection rule: dragging a card already in selection drags the whole
  selection; dragging a non-selected card swaps selection to just that
  card. Finder/Eagle convention.
- `mode: "copy"` so external apps (Premiere/Resolve/Explorer) get a
  reference to the library file without "moving" it out.

**Internal folder drop dispatch:**
- We subscribe once to `getCurrentWebview().onDragDropEvent(...)` at
  mount. The event payload contains `position` (window-relative
  physical px) on enter/over/drop — we record it in `dragTrackedPosRef`
  (logical px after `/dpr` divide).
- Folder rows have `data-folder-key={f.id | "__uncategorized__" | "__all__"}`.
  `folderAtPoint(x,y)` walks up from `elementFromPoint` and reads it.
- On startDrag's own callback (Dropped OR Cancelled — Windows reports
  own-window drops as Cancelled), we first try the tracked position;
  on miss, we try four coordinate-space interpretations of the plugin's
  own `cursorPos` as a fallback. Whichever finds a folder wins.
- Successful hit → `asset_set_folder` / `asset_set_folder_many`.

**Known open bug (carried into 2026-05-25):**
- On Windows, `onDragDropEvent` doesn't reliably fire enter/over events
  for **self-initiated drags** — only `drop`. Consequence: live folder
  highlight during drag can't be driven from those events. Workaround
  shipped: a static `lib-drag-hint` ("Drop on a folder to move N clips")
  in the sidebar replaces the per-folder hover during drag.
- **Even so, user reports stuck or weird highlight after drop.**
  Multiple defensive fixes (don't set hover on `drop`, clear on cleanup,
  drag-hint instead of per-folder outline) haven't fully resolved it.
  Theory for tomorrow: maybe the `drop` event fires AGAIN as a delayed
  re-event, OR React batches state in a way that pins the stale hover
  through the library:changed refresh that follows the successful move.
  Diagnostic plan: add transient console logs around all four state
  setters that touch `folderDropHover`, repro the bug, see which one
  fires last with what value. Then decide.

---

## 12. 1.1.3 → 1.1.6 — State lifted above the router + close-bug saga

**`src/lib/downloads.tsx` (DownloadsProvider)** — mounted at App.tsx
above `<HashRouter>`. Owns ALL active download/transcode state so
component unmount on route nav can't lose it:
  - `queueJobs[]` — multi-URL batch queue, persisted to localStorage
  - `singleDownload` — at-most-one active single-URL DL with progress,
    transcodeProgress, phase, error, result
  - `download:progress` + `transcode:progress` listeners attached
    ONCE; route-by-jobId to either queue rows or singleDownload
  - `workerLoop()` + CPU/GPU transcode semaphores (concurrency)
  - Single-URL `startSingleDownload(args)` runs the full
    yt_download → media_transcode → recordInLibrary →
    attachLocalThumbnail pipeline, captures all state in the
    provider so the originating MetadataCard can unmount safely

**Keep-alive `Shell` (1.1.3)** — replaces React Router's mount-on-
match. Each page (`/library`, `/download`, `/projects`, `/settings`)
mounts on first visit; non-active pages stay mounted but hidden via
`hidden` attr (no display:none repaint cost; React state intact).
Cost: ~50 MB worst-case (Library grid + Download scrubber). Win:
form state, scrubber video, fetched metadata, library filters/scroll
all survive nav for free. App.tsx routes only `/` → HomeRedirect;
everything else goes to Shell.

**Topbar `ActivityBadge`** — pulsing lime chip, "N downloading",
always visible when `activeCount > 0`. Click → /download.

**Boot-time orphan scan** — `OrphanScanner` (App.tsx) fires 3 sec
after mount. Calls Rust `library_scan_orphans` which walks
`Library/raw` + `Projects/*/raw` for `.part`, `.ytdl`, `.tmp`, and
yt-dlp's `.f<id>.<ext>` intermediates older than 5 min. If found,
shows confirm; on accept, `library_clean_orphans` moves them to
Recycle Bin via the `trash` crate. Catches partials left by
processes killed at shutdown.

**CloseGuard: REMOVED (1.1.6).** Was supposed to kill child processes
on window close. Symptom across 1.1.3–1.1.5: "clicking X did nothing."
Root cause: [Tauri bug #7119](https://github.com/tauri-apps/tauri/issues/7119)
— calling `unlisten()` on `onCloseRequested` permanently breaks
window close. React.StrictMode's effect double-invoke in dev, plus
the `if (cancelled) fn()` race branch in prod, both trigger the
upstream bug. Workaround: don't register the listener at all. The
orphan-scan-on-boot is the safety net for partial files; child
processes self-terminate within minutes when their stdout pipes
break. **Do not re-add a `onCloseRequested` listener until upstream
is fixed.**

---

## 13. 1.2.0 — Audio downloads (✅ shipped)

Audio is a first-class asset `kind` alongside video. Flow:

- **DB:** migration `008_asset_kind.sql` adds `kind TEXT NOT NULL
  DEFAULT 'video'` (+ `idx_assets_kind`). Old rows back-fill to video.
  `AssetInput.kind` / `Asset.kind` plumbed through; `library_insert`
  validates against a `"video"|"audio"` allowlist.
- **Download:** `yt_download` takes `audio_format: Option<String>`.
  When `Some("mp3"|"m4a"|"flac")` → `-x --audio-format <f>
  --audio-quality 0`, skips the merge-output-format clause. Audio
  jobs never transcode (video presets are meaningless for audio).
- **Waveform thumbs:** `media_extract_waveform` Rust command — ffmpeg
  `showwavespic` filter renders a slim lime PNG into
  `_thumbnails/<id>.png`, stored via the same `library_set_thumbnail`
  path as frame thumbnails. `attachLocalWaveform` (lib/library.ts) is
  the JS wrapper.
- **UI:** Download page has Video|Audio tabs; audio mode shows 3 format
  cards (no bitrate picker — server defaults: MP3 320 / M4A AAC 256 /
  FLAC lossless). Library card + InspectorSingle render audio variant
  (waveform bg, music-note glyph, "Format" stat). Kind filter lives in
  FilterPopup. Queue worker (`processOne`) also honors `audioFormat`.

**`os_open_path` (1.2.0)** — double-click / "open in default app" no
longer uses plugin-opener (its path scope `$HOME/**` silently rejected
files on other drives). New Rust command shells out (`cmd /c start` on
Windows, `open`/`xdg-open` elsewhere). Trust boundary = the library DB
(path came from our own insert).

## 14. 1.2.2 — Browser-extension bridge + deep link (✅ shipped)

Three channels let outside-the-app contexts enqueue downloads. All
converge on the SAME `bridge:enqueue` Tauri event, which a
`BridgeListener` React component (inside DownloadsProvider) routes
through the existing `enqueueUrls`. So Rust never touches the queue
directly — it just emits.

**`src-tauri/src/bridge.rs`** — axum HTTP server bound `127.0.0.1:<port>`
(default 47821), spawned in `setup()` via `tauri::async_runtime::spawn`
(NOT `tokio::spawn` — no reactor in setup). Routes:
  - `GET /health` — no auth, returns app + version (extension probe)
  - `POST /enqueue` — bearer-token auth, body `{ url, audio_format?,
    project_id?, source? }`. Constant-time token compare. CORS allows
    `chrome-extension://` / `moz-extension://` / `null` origins.
  Bind failure logs + disables the bridge for the session (app still runs).

**`mediahub://` deep link** — `tauri-plugin-deep-link` +
`tauri-plugin-single-instance` (deep-link feature). `mediahub://enqueue
?url=...&token=...&audio_format=...`. Token is required as a query param
(deep links can't carry headers) and re-validated against settings.
Handles three arrival paths (cold-launch argv, single-instance forward,
`on_open_url`) with a 2-second dedupe window (Windows fires the URL
through two channels). Parser + percent-decoder hand-rolled in lib.rs.

**Settings:** `bridge_token` (auto-generated 64-hex on first launch),
`bridge_port`, `bridge_enabled`. Surfaced in Settings → Browser bridge
with copy/regenerate buttons + PowerShell/bash/`mediahub://` examples.

**Cookies guard (1.2.14):** `settings::cookies_args` now returns no-args
when File mode has an empty/missing path, instead of emitting
`--cookies ""` (which crashes yt-dlp's PyInstaller bootloader before
Python can print a traceback — the infamous
`[PYI-...:ERROR] Failed to execute script '__main__'`).

## 15. 1.2.3 — Browser extension (✅ shipped, sideload-only)

Lives in **`extension/`** at repo root. Plain MV3 ES modules, NO build
step. Talks to the bridge over loopback HTTP; token stored in
`chrome.storage.local`. See `extension/README.md` (+ `.pt-br.md`).

```
extension/
├─ manifest.json        ← MV3; background needs "type":"module" (SW uses import)
├─ bridge.js            ← shared HTTP client (loadConfig/enqueue/pingHealth/buildDeepLink)
├─ popup.*              ← toolbar popup: format picker, status pill, detected-streams list
├─ options.*            ← token pairing + test-connection
├─ background.js        ← service worker: context menu, hotkeys, msg router (send-to-hub)
├─ sniffer.js           ← passive per-tab stream detector (webRequest)
├─ content-twitter.js   ← in-page hover button on x.com / twitter.com
├─ content-reddit.js    ← in-page hover button on reddit.com (handles shreddit-player)
├─ content-overlay.css  ← shared overlay-button styling
└─ icons/
```

**Four send paths:** toolbar popup (everywhere) · in-page hover pill
(Twitter/Reddit) · right-click context menu · hotkeys (`Ctrl+Shift+Y`
video / `Ctrl+Shift+M` mp3, the only path that survives YouTube/Twitter
right-click hijacking).

**Stream sniffer** — `webRequest.onBeforeRequest` + `<all_urls>`,
per-tab in-memory `Map<tabId, streams>`, toolbar badge count. Matches
`.m3u8/.mpd/.mp4/...` by URL suffix, drops HLS/DASH fragments.
`SKIP_HOSTS` (googlevideo/youtube/vimeo/twitch/redd.it) prevents the
observer from slowing high-frequency CDNs (early version tanked YouTube
playback). Debounced badge writes. URLs in memory only, never persisted.

**Content scripts** send the platform PERMALINK (tweet status URL /
reddit post URL), not the raw CDN URL — keeps yt-dlp's site-extractor
metadata. Hover-reveal via JS pointer events (CSS `:hover` doesn't
propagate through these sites' player overlays).

**Instagram: ❌ no in-page button.** Their video player click-locks
pointer events and wins the capture-phase race even against a
window-level guard + direct handler dispatch. IG is still covered by
the popup + sniffer. Don't retry unless their DOM changes.

---

When in doubt, the per-module header comment is the contract; this
doc just tells you which module to open.
