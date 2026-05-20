# Media Hub — Architecture

Status: planned shape, dev0 (2026-05-19). This document is a **map** of
where things will live and why. As code lands, this doc updates to match
reality — if it drifts, fix the doc. Detailed contracts live in
per-module header comments.

⚠️ At dev0, almost everything below is *planned*, not *built*. Mark each
section with a "shipped in dev N" tag as it lands.

---

## 1. The three layers

Media Hub is a Tauri desktop app with three clean layers and one
external dependency surface:

```
   ┌────────────────────────────────────────────┐
   │  Renderer (React + TypeScript)             │
   │  - UI, state, user input                   │
   │  - Talks to backend ONLY via Tauri invoke  │
   └─────────────────┬──────────────────────────┘
                     │  invoke() / events
   ┌─────────────────▼──────────────────────────┐
   │  Backend (Rust, in src-tauri/)             │
   │  - Tauri commands (the IPC surface)        │
   │  - Job queue, SQLite, sidecar orchestration│
   │  - Only writer of library/ + library.db    │
   └─────────────────┬──────────────────────────┘
                     │  spawn / parse stdout
   ┌─────────────────▼──────────────────────────┐
   │  Sidecars (bundled binaries)               │
   │  - yt-dlp:  metadata + download            │
   │  - ffmpeg:  trim + transcode + thumbnails  │
   └────────────────────────────────────────────┘
```

The renderer **never** spawns processes directly and **never** touches
the filesystem outside Tauri's allowlist. Every action that mutates
disk goes through a Rust command.

---

## 2. On-disk layout (ground truth)

Everything Media Hub knows is reconstructable from `library/` plus
`library.db`. Settings live in the OS config dir.

```
~/Media Hub/                                  ← user-pickable root
├── Library/                                  ← reusable, lives forever
│   ├── YouTube/<ChannelName>/<YYYY-MM>/<title>__<in>_<out>.<ext>
│   ├── Twitter/@<username>/<YYYY-MM>/<tweet_id>.<ext>
│   ├── _thumbnails/<asset_uuid>.jpg
│   └── library.db                            ← SQLite, single file, shared across both roots
├── Projects/
│   └── <project-name>/                       ← scoped, deletable as a unit
│       ├── YouTube/<ChannelName>/<YYYY-MM>/...
│       ├── Twitter/...
│       ├── _thumbnails/
│       └── project.json                      ← name, created, status, notes
└── Downloads/                                ← pre-library staging (0.2)
    └── _pending/<job-id>/                    ← sidecars write here, atomic-moved on success

~/.config/media-hub/  (Mac: ~/Library/Application Support/media-hub/)
└── settings.json                             ← global settings
└── queue_state.json                          ← persisted queue (0.4)
```

Path safety: every Rust handler that writes/deletes routes through a
`assert_in_library_root(path)` helper. Anything trying to escape the
library root errors before touching disk. (Mirrors chiral-network's
`assertInProjects` discipline.)

---

## 3. Tauri command surface (the IPC contract)

Renderer talks to backend through `invoke('<command>', args)`. Backend
pushes async events via `app.emit_all('<event>', payload)`.

Naming convention: `<domain>:<verb>` — e.g. `yt:fetchMetadata`,
`library:search`.

### Planned commands (filled in as they ship)

| Domain | Command | Shipped | Purpose |
|--------|---------|---------|---------|
| `binaries:` | `version` | 0.1 | Returns versions of bundled yt-dlp + ffmpeg |
| `yt:` | `fetchMetadata` | 0.2 | Returns title/duration/formats for a URL |
| `yt:` | `download` | 0.2 | Full download, emits progress events |
| `yt:` | `downloadSegment` | 0.3 | Segment download (range or full+trim) |
| `yt:` | `resolveStreamUrl` | 0.7 | Returns direct stream URL for scrub player |
| `queue:` | `add`, `pause`, `resume`, `cancel`, `list` | 0.4 | Batch job queue |
| `transcode:` | `run` | 0.5 | ffmpeg transcode with progress |
| `library:` | `list`, `search`, `getById`, `addTag`, `removeTag`, `setRating` | 0.6 | Library CRUD |
| `library:` | `exportToProject` | 0.6 | Copy asset into a user-chosen folder |
| `platform:` | (trait dispatch) | 0.8 | YouTube + Twitter routing |
| `settings:` | `get`, `set` | 0.9 | Global settings |

### Planned events (renderer subscribes)

| Event | Payload | Purpose |
|-------|---------|---------|
| `job:progress` | `{jobId, percent, eta, speed}` | Per-job download/transcode progress |
| `job:done` | `{jobId, outputPath, errors}` | Completion |
| `library:changed` | `{}` | Re-fetch library list after a write |
| `queue:changed` | `{}` | Queue state changed (add/pause/etc.) |

---

## 4. Sidecar orchestration

Both yt-dlp and ffmpeg are spawned via `tauri-plugin-shell`. Pattern:

1. Build args vector (never string-concat user input — argv stays
   structured)
2. Spawn with stdout + stderr piped
3. Stream stdout line-by-line into a parser (yt-dlp progress lines OR
   ffmpeg `-progress pipe:1` key=value pairs)
4. Parser emits structured progress events to the renderer
5. On exit code: success → success event; non-zero → error event with
   captured stderr tail

**Key rule:** Sidecars never write directly to `library/`. They write
to a staging dir (`~/Media Hub/Downloads/_pending/<job-id>/`), and on
success the Rust handler atomically moves the file into the final
library path. Crash mid-download = leftover staging file we can clean
up; never a half-written file in the library.

### Sidecar bundling

- Win: `yt-dlp.exe` + `ffmpeg.exe` in `src-tauri/binaries/`
- Mac: `yt-dlp` + `ffmpeg` (universal binary if available, else two
  arch-specific copies) with Tauri's `-x86_64-apple-darwin` /
  `-aarch64-apple-darwin` suffix
- Tauri's `tauri.conf.json > tauri > bundle > externalBin` lists them

Updating sidecars is a manual `scripts/fetch-sidecars.sh` (or .ps1)
that downloads the latest stable releases. No auto-update of sidecars
at runtime — they're vendored.

---

## 5. The job queue (0.4+)

A `tokio::sync::mpsc` channel feeding a worker pool. Workers are
async tasks holding a permit from a `Semaphore` (concurrency limit).

```rust
JobQueue {
  semaphore: Arc<Semaphore>,        // limits parallel downloads
  jobs: Arc<RwLock<HashMap<JobId, Job>>>,
  tx: mpsc::Sender<JobCommand>,     // add / pause / resume / cancel
}

enum JobKind {
  Download { url, format, out_path },
  Segment { url, format, in_sec, out_sec, out_path },
  Transcode { src, preset, out_path },
}

enum JobState {
  Queued, Running, Paused, Done, Failed(String),
}
```

Persistence: queue state is serialized to `queue_state.json` on every
state change (debounced to ~1s). On launch, queue restores; running
jobs become Queued (we don't try to resume mid-flight downloads on
restart — they re-queue from zero, or from byte offset if yt-dlp's
`--continue` works for that format).

---

## 6. The library DB (0.6+)

SQLite via `sqlx` with compile-time-checked queries.

```
assets (
  id TEXT PRIMARY KEY,           -- UUID
  source_url TEXT,
  platform TEXT,                 -- 'youtube' | 'twitter' | ...
  channel TEXT,                  -- '@user' or channel name
  title TEXT,
  duration_sec INTEGER,
  in_sec INTEGER,                -- NULL if full download
  out_sec INTEGER,
  file_path TEXT,                -- relative to library root
  file_size INTEGER,
  codec TEXT,
  resolution TEXT,               -- '1920x1080'
  downloaded_at INTEGER,         -- epoch
  transcoded_to TEXT,            -- preset name, NULL if not transcoded
  rating INTEGER                 -- 0-5, default 0
)

tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE)
asset_tags (asset_id TEXT, tag_id INTEGER, PRIMARY KEY (asset_id, tag_id))

-- FTS5 virtual table for search (0.6 exit criterion)
CREATE VIRTUAL TABLE assets_fts USING fts5(
  title, channel, tags,
  content='assets', content_rowid='rowid'
)
```

Migrations live in `src-tauri/migrations/`. `sqlx migrate run` on app
launch.

---

## 7. Platform abstraction (0.8+)

```rust
#[async_trait]
trait Platform {
  fn url_pattern(&self) -> &Regex;
  async fn fetch_metadata(&self, url: &str) -> Result<Metadata>;
  async fn resolve_stream_url(&self, url: &str, format: &FormatId) -> Result<String>;
  async fn download(&self, url: &str, format: &FormatId, out: &Path, progress: ProgressSink) -> Result<()>;
  async fn download_segment(&self, url: &str, format: &FormatId, in_sec: f64, out_sec: f64, out: &Path, progress: ProgressSink) -> Result<SegmentMode>;
}

enum SegmentMode { RangeOnly, FullThenTrim }
```

`PlatformRouter` matches URL → impl. YouTube and Twitter both shell out
to yt-dlp under the hood; the abstraction is for *us*, to keep
URL-specific quirks contained.

---

## 8. Where features live (module map)

To be filled as code lands. Initial planned layout:

```
media-hub/
├── src/                              ← React frontend
│   ├── components/                   ← UI components
│   ├── pages/                        ← Top-level views (Smoke, Download, Queue, Library)
│   ├── hooks/                        ← TanStack Query hooks for invoke()
│   ├── lib/                          ← Pure TS utilities (format helpers, timestamp parsing)
│   └── App.tsx
├── src-tauri/                        ← Rust backend
│   ├── src/
│   │   ├── main.rs                   ← Tauri app bootstrap, command registry
│   │   ├── commands/                 ← One file per `<domain>:` namespace
│   │   │   ├── binaries.rs
│   │   │   ├── yt.rs
│   │   │   ├── queue.rs
│   │   │   ├── transcode.rs
│   │   │   └── library.rs
│   │   ├── sidecar/                  ← Sidecar spawn + parse helpers
│   │   │   ├── ytdlp.rs              ← yt-dlp progress parser
│   │   │   └── ffmpeg.rs             ← ffmpeg -progress parser
│   │   ├── platform/                 ← Platform trait + impls (0.8)
│   │   ├── library/                  ← SQLite layer + path helpers
│   │   └── paths.rs                  ← assert_in_library_root, sanitize_filename
│   ├── binaries/                     ← Bundled yt-dlp + ffmpeg (gitignored)
│   ├── migrations/                   ← sqlx migrations
│   └── tauri.conf.json
├── docs/
│   ├── ROADMAP.md
│   ├── ARCHITECTURE.md               ← this file
│   ├── NOTES.md                      ← working notes + parking lot
│   └── (others as needed)
└── scripts/
    └── fetch-sidecars.ps1            ← grab latest yt-dlp / ffmpeg
```

---

## 9. Cross-cutting concerns

### Error handling
Rust commands return `Result<T, String>` where the error string is
user-facing (no Rust debug formatting in production). Internal panics
should be unreachable; if they happen, the renderer surfaces a "report
this" prompt.

### Logging
`tracing` crate, with logs written to OS log dir + a ring-buffer the
diagnostic bundle reads. (Diagnostic bundle is a 0.9 feature.)

### Settings
Single `settings.json` in the OS config dir. Loaded once at startup,
written atomically (tmp + rename). Mirrors chiral-network's discipline.

### Concurrency model
- Frontend: TanStack Query handles all server state caching
- Backend: `tokio` runtime; one global `JobQueue` instance held in
  Tauri's managed state

---

## 10. What's NOT here (yet)

Deliberately deferred or skipped:
- Auto-update mechanism — manual download for 1.0
- Telemetry — never (per non-goals)
- Plugin system — never in 1.x
- Localization — English only for 1.0
- Code signing — defer until distribution path warrants it

When in doubt, the per-module header comment is the contract; this doc
just tells you which module to open.
