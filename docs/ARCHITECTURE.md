# Media Hub — Architecture

Status: living doc, last refreshed 2026-05-21 (post 0.8.D — onboarding +
settings polish). This document is the **map** of what's actually built
and where it lives. As code lands, this doc updates to match. If it
drifts, fix the doc. Detailed contracts live in per-module header
comments.

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
| `library_set_thumbnail` | library.rs | Records a local thumbnail path |
| `library_thumbnails_missing` | library.rs | Lists assets with no `thumbnail_path` for backfill loop |
| `library_siblings` | library.rs | Returns peer assets sharing the same `source_url` (multi-segment relationships) |
| `library_find_by_url` | library.rs | Duplicate-check helper used by the Download page before fetch |
| `tag_set_for_asset` | library.rs | Replace-all tag set in one transaction |
| `tag_list_all` | library.rs | All tags with usage counts, alphabetical, orphans hidden |
| `project_create / list / rename / delete` | library.rs | CRUD for projects. Slug derived at create; never recomputed on rename |
| `project_finish` | library.rs | Lifecycle endgame — optionally promote assets to Library, OS-trash the project folder, delete the row |
| `asset_set_project` | library.rs | Physical move between Library ↔ project scope (rename + cross-volume copy/delete fallback + collision-safe naming) |
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
`app.security.assetProtocol = { enable: true, scope: ["$HOME/**"] }`.
The renderer uses `convertFileSrc(localPath)` to turn a Windows path
into an `asset.localhost/...` URL the webview can load. Works
identically in dev and packaged builds.

---

## 8. UI shell (✅ shipped + extended through 0.8.D)

`react-router-dom` v7 with **HashRouter** (avoids `tauri://` vs
`http://localhost` origin issues). Routes:

```
/              → /library (redirect)
/download      → DownloadPage   (MetadataCard + Scrubber + QueueCard)
/library       → LibraryPage    (filter sidebar + grid + slide-over drawer)
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
│   │   └── 004_projects.sql
│   ├── capabilities/
│   │   └── default.json              ← shell:execute (yt-dlp, ffmpeg) + opener + dialog scopes
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
├── package.json                      ← @tauri-apps/{api, plugin-opener, plugin-shell, plugin-dialog}
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
- 🟡 Drag-to-NLE — 1.1 (front-runner post-1.0)

When in doubt, the per-module header comment is the contract; this
doc just tells you which module to open.
