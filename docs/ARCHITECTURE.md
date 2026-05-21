# Media Hub — Architecture

Status: living doc, last refreshed 2026-05-20 (post 0.5.1 — local
thumbnails). This document is the **map** of what's actually built and
where it lives. As code lands, this doc updates to match. If it drifts,
fix the doc. Detailed contracts live in per-module header comments.

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
~/Media Hub/
├── library.db                              ← SQLite WAL-mode, single file
├── _thumbnails/<asset_uuid>.jpg            ← extracted mid-clip frames (480w q=4)
└── Downloads/
    └── _test/                              ← yt-dlp writes here for now
        ├── <title> [<id>].<ext>            ← downloaded source
        ├── <title> [<id>].seg_<in>_<out>.<ext>   ← segment-trimmed output
        └── <title> [<id>].<preset>.<out_ext>    ← transcoded output
```

Browser-side state (localStorage):
```
mh.queue.v1   ← the batch download queue (active + queued + completed jobs)
```

**Planned (not yet built):**
- 🟡 `~/Media Hub/Library/` + `~/Media Hub/Projects/<name>/` dual-root
  layout (0.6). Today everything lands in `Downloads/_test/` — that
  path is provisional. The library DB row already carries the full
  path so migrating later is a path rename, not a re-index.
- 🟡 `~/Media Hub/_thumbnails/` will move to `Library/_thumbnails/`
  and per-project `Projects/<n>/_thumbnails/` once dual-root lands.
- 🟡 Settings file (`settings.json`) doesn't exist yet — no
  per-user knobs to persist.

**Path safety:** no formal `assert_in_library_root` helper yet. All
write paths are computed by Rust handlers from a known-safe parent
(home + "Media Hub"), so user-controllable strings never become
parent-path components. Lock this down properly when we add
project folders (user-named) in 0.6.

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
| `binaries_version` | lib.rs | Returns yt-dlp + ffmpeg version strings (smoke-test, no UI today) |
| `yt_fetch_metadata` | lib.rs | Spawns `yt-dlp -j`, returns title/duration/formats/thumbnail |
| `yt_download` | lib.rs | Full download via yt-dlp. Optional in/out triggers post-download ffmpeg `-c copy` trim. Streams progress |
| `media_transcode` | lib.rs | Re-encodes a downloaded file via ffmpeg with one of 4 presets (ProRes 422 LT / DNxHR SQ / H.264 libx264 / H.264 NVENC). `-hwaccel auto` for hw decode |
| `media_extract_thumbnail` | lib.rs | Pulls a mid-clip JPG (480w q=4) into `~/Media Hub/_thumbnails/<asset_id>.jpg` |
| `library_insert` | library.rs | Inserts an asset row; returns its UUID |
| `library_list` | library.rs | Returns assets matching filters (free-text query + tag-AND + limit), each with its tag list |
| `library_count` | library.rs | Total asset row count |
| `library_delete` | library.rs | Removes a row (file on disk untouched). CASCADE drops asset_tags |
| `library_set_thumbnail` | library.rs | Records a local thumbnail path against an asset |
| `library_thumbnails_missing` | library.rs | Lists assets with no `thumbnail_path` for the backfill loop |
| `tag_set_for_asset` | library.rs | Replace-all tag set in one transaction (no diff round-trips) |
| `tag_list_all` | library.rs | All tags with usage counts, alphabetical, orphans hidden |

### Shipped events (renderer subscribes via `listen()`)

| Event | Payload | Emitted by | Drives |
|-------|---------|------------|--------|
| `download:progress` | `{ job_id?, downloaded_bytes, total_bytes?, percent?, speed_bps?, eta_sec? }` | `yt_download` (filesystem-poll task) | Single-URL progress bar + queue rows |
| `transcode:progress` | `{ job_id?, processed_sec, total_sec?, percent?, speed_mult? }` | `media_transcode` (parses ffmpeg `-progress pipe:1`) | Transcode progress bar |
| `library:changed` | `{}` | `library_insert`, `library_delete`, `library_set_thumbnail`, `tag_set_for_asset` | Library page auto-refresh (no polling) |

`job_id` is `null` for the single-URL flow and a job UUID for batch
jobs — that's how the renderer routes events to the right UI.

### Planned commands

- 🟡 `library_move_to_project(asset_id, project_id)` (0.6)
- 🟡 `project_create / list / delete / finish` (0.6)
- 🟡 `yt_resolve_stream_url(url, format_id)` for the scrubber's
  direct-stream playback (0.6)
- 🟡 `settings_get / settings_set` (0.8 packaging)

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
-- 001_initial.sql
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,           -- UUID v4
  source_url    TEXT NOT NULL,
  platform      TEXT NOT NULL,              -- 'youtube' | (later: 'twitter' etc.)
  video_id      TEXT,
  channel       TEXT,
  title         TEXT NOT NULL,
  duration_sec  REAL,
  in_sec        REAL,                       -- NULL = full download
  out_sec       REAL,
  file_path     TEXT NOT NULL,              -- absolute path on disk
  file_size     INTEGER,
  container     TEXT,                       -- 'mp4' | 'webm' | 'mov' | ...
  codec_video   TEXT,                       -- 'h264' | 'av01' | 'prores' | ...
  codec_audio   TEXT,
  width         INTEGER,
  height        INTEGER,
  fps           REAL,
  transcoded_to TEXT,                       -- preset name, NULL if unconverted
  thumbnail_url TEXT,                       -- remote (YT CDN) thumbnail
  downloaded_at INTEGER NOT NULL            -- unix epoch
);
CREATE INDEX IF NOT EXISTS idx_assets_downloaded_at ON assets(downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_platform_video_id ON assets(platform, video_id);
CREATE INDEX IF NOT EXISTS idx_assets_platform_channel ON assets(platform, channel);

-- 002_tags.sql
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);

-- 003_thumbnails.sql
ALTER TABLE assets ADD COLUMN thumbnail_path TEXT;
```

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

## 8. UI shell (✅ shipped post-0.5)

`react-router-dom` v7 with **HashRouter** (avoids `tauri://` vs
`http://localhost` origin issues). Routes:

```
/              → /library (redirect)
/download      → DownloadPage   (MetadataCard + QueueCard)
/library       → LibraryPage    (filter sidebar + grid + drawer)
/projects      → ProjectsPage   (stub, 0.6)
/settings      → SettingsPage   (stub, 0.8)
*              → /library (catch-all)
```

`Shell` component owns the persistent chrome (44px top bar + 216px
left nav) and renders `<Outlet />` for the active route. Stays
mounted across route changes so navigation is instant.

**Design tokens:** lifted verbatim from `design-reference/Media Hub
Wireframes.html` with the amber accent recolored to our lime
`#c7f154`. Geist + Geist Mono via `@fontsource` — no runtime network
dependency.

---

## 9. Source layout (current)

```
media-hub/
├── src/                              ← React frontend
│   ├── App.tsx                       ← Router (HashRouter + 4 routes)
│   ├── main.tsx                      ← React.createRoot entry
│   ├── App.css                       ← Design tokens + all component styles
│   ├── shell/
│   │   └── Shell.tsx                 ← TopBar + Nav + <Outlet />
│   ├── pages/
│   │   ├── Download.tsx              ← MetadataCard, QueueCard
│   │   ├── Library.tsx               ← Grid + filter sidebar + drawer
│   │   ├── Projects.tsx              ← Stub (0.6)
│   │   └── Settings.tsx              ← Stub (0.8)
│   └── lib/
│       ├── types.ts                  ← Shared TS types (mirror Rust)
│       ├── format.ts                 ← fmtDuration, fmtBytes, parseTimestamp
│       ├── library.ts                ← recordInLibrary, attachLocalThumbnail, thumbnailSrc
│       └── icons.tsx                 ← Inline SVG icon set
├── src-tauri/                        ← Rust backend
│   ├── src/
│   │   ├── lib.rs                    ← App bootstrap + sidecar/yt/transcode/thumb commands
│   │   └── library.rs                ← SQLite layer + library/tag commands
│   ├── migrations/
│   │   ├── 001_initial.sql           ← assets table
│   │   ├── 002_tags.sql              ← tags + asset_tags
│   │   └── 003_thumbnails.sql        ← thumbnail_path column
│   ├── capabilities/
│   │   └── default.json              ← shell:allow-execute (yt-dlp, ffmpeg), opener scopes
│   ├── binaries/                     ← Bundled yt-dlp + ffmpeg (gitignored)
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json               ← bundle.externalBin + assetProtocol scope
├── docs/
│   ├── ROADMAP.md
│   ├── ARCHITECTURE.md               ← this file
│   ├── NOTES.md                      ← working notes + parking lot
│   └── FEEDBACK.md                   ← collaboration notes (personal, timeless)
├── design-reference/                 ← Handoff JSX (used as design spec, not run)
├── scripts/
│   └── fetch-sidecars.ps1            ← Grab latest yt-dlp / ffmpeg
├── package.json
└── tsconfig.json
```

**What ISN'T in the layout** (deliberate, vs the dev0 plan):
- ❌ No `src-tauri/src/commands/` per-domain split — two files
  (`lib.rs`, `library.rs`) is small enough that splitting adds
  ceremony without payoff. Re-evaluate at 1000+ LOC per file.
- ❌ No `src-tauri/src/platform/` trait yet — YouTube-only until 0.7.
- ❌ No `src-tauri/src/sidecar/` parser split — inline parsing in
  each command. Will refactor if a third sidecar joins.
- ❌ No `src/hooks/` directory — no TanStack Query, just bare
  `useState` + `useEffect`. Add it back if state caching ever
  becomes painful.

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

### Settings
🟡 No settings persistence yet. Hard-coded defaults in code:
- Download workers: 3
- Library DB path: `~/Media Hub/library.db`
- Transcode hardware decode: `-hwaccel auto` always
- Thumbnail dimensions: 480w / JPG q=4
- Search debounce: 150ms

Settings panel + `settings.json` arrive with the 0.8 packaging
milestone.

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
- 🟡 Settings persistence — 0.8
- 🟡 Dual-root Library/Projects — 0.6
- 🟡 In-app scrubber preview — 0.6
- 🟡 Platform abstraction (Twitter/X) — 0.7
- 🟡 FTS5 search — defer until LIKE perf hurts

When in doubt, the per-module header comment is the contract; this
doc just tells you which module to open.
