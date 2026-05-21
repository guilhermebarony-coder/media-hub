# Media Hub — Roadmap

Status: draft, written at dev0 (2026-05-19). Project not yet scaffolded.
Owner: Guilherme. Companion to `docs/ARCHITECTURE.md` and `docs/NOTES.md`.

---

## Vision in one paragraph

Media Hub is a desktop sourcing + organizing tool for video editors and
content creators. The headline feature is **no bloat**: never download a
1-hour video to use 5 seconds of it. Paste a URL, scrub or punch in
timestamps, get only the segment you want, transcoded into something
your NLE actually likes (ProRes / DNxHR / optimized MP4), filed into a
tagged library you can search a month later. YouTube and Twitter/X for
v1.0; Envato Elements is speculative and may never ship if the
authenticated-session path stays fragile. v1.0 ships when the
download → trim → transcode → library loop is polished enough that the
author uses it daily for real B-roll work without falling back to other
tools.

---

## Today's cut-lines (the decisions this roadmap is built on)

Decided 2026-05-19. Captured here because *why* matters more than *what*.

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Audience for 1.0** | Just the author + close circle. Maybe GitHub release as distribution, no community commitment. | Same posture as chiral-network. Decide for real at 0.8.0 — if it's polished, why not share. |
| **Platforms** | Windows + macOS for 1.0. Linux never (or 3.0+). | Tauri makes Linux ~free, but doubles QA. The two real platforms for editors are Win and Mac. |
| **Stack** | Tauri 2 + React + TS + Rust. yt-dlp and ffmpeg as sidecar binaries. SQLite for library. | Smaller install + better RAM than Electron; matters when shipping ~150 MB of sidecars already. Pivot to Electron+Node in week 1 if Rust friction stalls progress. |
| **Library model** | Dual-root: `~/Media Hub/Library/` (reusable, lives forever) + `~/Media Hub/Projects/<name>/` (scoped, deletable as a unit). Active project is sticky default — Library is the one-click exception. | Reflects 90% project-focused, 10% loose-browsing reality. Folder you can `rm -rf` (with OS trash safety net) beats fragile project tags. See NOTES.md "Library vs Projects" for details. |
| **Scrubber UX** | Text-input timestamps for MVP. In-app scrubber by 0.6.0. | Text inputs ship the killer feature (segment download) without blocking on player UX. Scrubber is the polish layer. |
| **Source-scrub strategy** | Stream the YT URL directly (no proxy download) for scrubbing. Only download the final segment. | Matches "no bloat" philosophy. Fallback to low-res proxy if direct streaming is unreliable on some sources. See NOTES.md "scratch-preview" idea. |
| **Transcode default** | ProRes 422 LT on macOS, ProRes 422 LT *or* DNxHR SQ on Windows (user picks at first run). Optimized H.264 MP4 as the "small file" option. | 422 LT is the sweet spot for B-roll source. 4444+alpha is rare for downloaded clips. DNxHR SQ for Avid users. |
| **Twitter/X auth** | Anonymous (public tweets) only for v1.0. Cookie-based auth is post-1.0. | yt-dlp handles public tweets fine. Auth flow is its own scoped milestone. |
| **Envato Elements** | **NOT in v1.0.** Parked as 1.x speculative. | No public API, ToS-sensitive, fragile auth. Better to ship YT+X polished than YT+X+broken-Envato. Revisit after 1.0 if author still wants it. |
| **Timeline** | Ship when ready. Quality gate, not date gate. | No external pressure. Milestones sequenced, not dated. |

**Hard non-goals through 1.x** (write these down so we stop revisiting them):

- ❌ Linux support
- ❌ Mobile / web version
- ❌ Cloud sync / multi-machine library
- ❌ Multi-user / collaboration features
- ❌ Render farm / distributed transcode
- ❌ Generic video format converter (we transcode for editing, not arbitrary conversions)
- ❌ Audio-only podcast/music downloader (different product)
- ❌ Plugin marketplace / third-party extensions
- ❌ Telemetry / analytics
- ❌ Subscription / licensing infrastructure
- ❌ Code-signed installers for 1.0 (cert costs $$; defer until distribution warrants it)
- ❌ Auto-update (manual download for 1.0; defer until community asks)
- ❌ Built-in NLE features (we feed your NLE; we don't try to be one)

---

## Current state — 2026-05-21 (post-lunch replan)

Four days in. **0.1 → 0.6 complete end-to-end.** ~30 commits on `main`.

**Path to 1.0 — replanned post 0.6:**

| Order | Milestone | Why next |
|-------|-----------|----------|
| **1** | 0.6.1 multi-segment | Bandwidth-saving workflow we keep wanting. Small. ~1 session. |
| **2** | 0.8 packaging + settings | Cookies fix for age-restricted YT. Installer crosses "give to a friend" line. ~2-3 sessions. |
| **3** | 1.0 release | QA pass, README, tag. ~1-2 sessions. |
| post-1.0 | 0.7 / 1.x platforms | Twitter / TikTok / etc. Owner: "nice but not priority." Better to design the trait against 2+ known platforms. |

See decision log entry **2026-05-21 — Replan: 0.6.1 → 0.8 → 1.0, 0.7 post-1.0**.

What works end-to-end:
- ✅ Tauri 2 + React 19 + TS scaffold, dark theme, 1400×900 window
- ✅ yt-dlp + ffmpeg bundled as sidecars, `-hwaccel auto` for GPU decode
- ✅ Single-URL: paste → metadata → format picker → segment In/Out →
  transcode preset → live progress → file lands
- ✅ Auto-mux video-only picks with container preservation (MP4 stays MP4,
  WebM stays WebM)
- ✅ Segment trim via post-download ffmpeg `-c copy` (full source then
  trim, no quality loss, keyframe-snapped)
- ✅ Live download progress via filesystem polling (bypasses Python's
  pipe-buffering wall; uses seek-to-end to defeat Windows MFT size cache)
- ✅ Transcode pipeline: ProRes 422 LT / DNxHR SQ / H.264 libx264 / H.264
  NVENC. Progress from ffmpeg's `-progress pipe:1`.
- ✅ Batch queue: 3 parallel download workers, 1 CPU transcode + 1 GPU
  transcode concurrently, persisted to localStorage, retry failed,
  per-job preset capture
- ✅ Library (SQLite + sqlx): every download writes a row; tags with
  inline chip editor + autocomplete; tag-filter cloud; LIKE search with
  150ms debounce; event-driven refresh via `library:changed`
- ✅ **App shell** — Geist + Geist Mono, lime accent, top bar with
  brand + active-project picker stub + global-search stub, left nav
  (Download / Library / Projects / Settings), `react-router-dom`
  hash routing, route-based screens. Default route is `/library`.
- ✅ **0.6 Phase A — project foundations** (metadata-only). `projects`
  table + `assets.project_id`. ActiveProjectProvider context. Real
  top-bar picker. Projects page with create / rename / delete. Library
  page filters by active scope. Asset drawer can move between scopes.
- ✅ **0.6 Phase B — filesystem routing.** Downloads route into
  `~/Media Hub/Library/raw/` or `Projects/<slug>/raw/` based on
  scope. `asset_set_project` physically moves files between scopes
  (handles cross-volume + name collisions). `library_delete` gained
  an opt-in `delete_file` for DB-and-disk removal (with thumbnail
  cleanup). Asset drawer surfaces both "Forget" and "Delete file".
  Holding **Ctrl** during a Download / Queue click overrides to
  Library regardless of active scope (Ctrl+Space reserved for future
  command palette).
- ✅ **0.6 Phase C — duplicate detection + Finish Project.**
  `library_find_by_url` runs in parallel with metadata fetch; a
  lime "already saved" chip warns when re-downloading without
  blocking. `project_finish` (via the `trash` crate) promotes
  assets to Library and OS-trashes the project folder — recoverable
  from Recycle Bin if finished too early. Projects page row gains a
  "Finish" button with three-way confirm (promote / trash all / cancel).
- ✅ **0.6 Phase D — in-app scrubber preview.** `yt_resolve_stream_url`
  gets a browser-playable direct stream URL via `yt-dlp -g` (no
  download needed). New `Scrubber` component with HTML5 video, scrub
  bar, In/Out markers, region highlight, and full keyboard control
  (Space/play, ←→/frame-step, Shift+arrows/1s, I/O/mark). Replaces
  text-input segment row; manual entry kept behind a toggle for
  precision use and stream-failure fallback. **0.6 ships.**
- ✅ **Local thumbnails** — ffmpeg extracts a mid-clip frame (480px wide
  JPG q=4, ~30–80 KB) into `~/Media Hub/_thumbnails/<asset_id>.jpg` on
  every successful download. UI prefers local thumbs over remote
  (correct for segment downloads where the source's official thumbnail
  no longer represents the trimmed file). Backfills existing assets
  serially on Library mount.
- ✅ **Library grid page** — proper grid (auto-fill 220px) replacing
  the dev card. Sidebar facets (Source / Tags / Added) with live
  counts that reflect the SQL-filtered set. Active-filter chip row
  with one-click removal. Asset detail drawer (slide-over from right)
  with full metadata table, tag editor, Reveal-in-Explorer, Forget.

What's deferred (not done, won't be done this session):
- 🟡 Pause / resume in batch queue (Windows process signaling)
- 🟡 Export to project folder (needs `@tauri-apps/plugin-dialog` for
  folder picker — separate plugin install + capability)
- 🟡 Rename rules with `{channel}` / `{title}` / `{date}` tokens (needs
  settings panel which doesn't exist)
- 🟡 FTS5 search upgrade (current LIKE is fine for <10k assets; revisit
  if needed)
- 🟡 cmd-K global search palette (top-bar search box is decorative)
- 🟡 List view toggle in library (Grid/List tabs; List disabled for now)
- 🟡 Projects feature — picker in top bar is decorative; Projects page
  is a stub. Real dual-root + active-project switching lands with 0.6

---

## Milestone tree

Each milestone has: **Goal** (one sentence), **Scope** (in), **Out of
scope** (explicit cuts), **Exit criteria** (concrete checklist).

Effort estimates are in *dev builds*, not calendar time. A "dev build"
≈ 1–3 hours of focused work that produces a testable state.

```
dev0 ──┐
       ▼
     0.1.0  ✅  boilerplate + sidecar smoke test
       │
       ▼
     0.2.0  ✅  single-URL download
       │
       ▼
     0.3.0  ✅  segment download + transcode pipeline   ← absorbed original 0.5
       │
       ▼
     0.4.0  ✅  batch queue (proper, parallel, persistent)
       │
       ▼
     0.5.0  ✅  library MVP (SQLite, tags, search) + UI overhaul
     0.5.1  ✅  local thumbnails
       │
       ▼
     0.6.A  ✅  project foundations (schema, CRUD, active scope)
     0.6.B  ✅  filesystem routing + physical move + delete-from-disk + Ctrl override
     0.6.C  ✅  duplicate detection + Finish Project (OS trash)
     0.6.D  ✅  in-app scrubber preview (HTML5 video + I/O markers + keyboard)
       │
       ▼
     0.6.1  🟡  multi-segment marking + library sibling indicator   ← NEXT
       │
       ▼
     0.8.0  🟡  packaging, polish, public-ready (cookies, installer, onboarding)
       │
       ▼
     1.0.0  🟡  release
       │
       ▼  post-1.0
     1.x    🟡  platform abstraction + Twitter/X/TikTok (was 0.7)
       │
       ▼
     0.7.0  🟡  Twitter/X support + platform abstraction
       │
       ▼
     0.8.0  🟡  packaging, polish, public-ready (audience decision lives here)
       │
       ▼
     1.0.0  🟡  release
```

**Numbering note:** the milestone tree shifted twice as we built.
We collapsed the original "0.5 transcode pipeline" into 0.3 because
the segment-trim ffmpeg work already had ffmpeg wired up; doing
transcode presets in the same pass cost almost nothing extra. That
shifted the original "0.6 library" down to 0.5, and so on. The
**dual-root library** (originally part of 0.6 library) and **in-app
scrubber** (originally 0.7) are now bundled as 0.6 because the UI
overhaul we did with 0.5 ate the "Library page UI" chunk of the
original 0.6 scope — what's left of 0.6 is the project-folder
mechanic plus the scrubber, which pair naturally. See decision log
2026-05-20 entry.

---

### 0.1.0 — Boilerplate & sidecar smoke test *(~2–3 dev builds)* ✅ SHIPPED

**Goal:** Prove the entire pipeline from React button → Rust handler →
sidecar binary → output back to UI works end-to-end. Nothing real yet,
just the rails.

**Scope (in):**

- Tauri 2 + React + TypeScript + Vite scaffold under `media-hub/`
- Tailwind + shadcn/ui installed and a single demo component renders
- `yt-dlp.exe` + `ffmpeg.exe` (Win) and `yt-dlp` + `ffmpeg` (Mac, intel + arm64)
  placed at `src-tauri/binaries/` with proper Tauri sidecar naming
- Rust command `binaries:version` that spawns each sidecar with `--version`
  and returns the parsed version string
- React "Smoke Test" page that calls the command and displays both versions
- Git repo initialized with a sensible `.gitignore` (sidecar binaries
  excluded — fetched separately, see `docs/sidecars.md` once written)
- README at repo root with the one-line "what this is" + "how to run dev"

**Out of scope (cut):**

- ❌ Any download functionality
- ❌ UI design / branding
- ❌ macOS testing (Win-first while we get the loop right)
- ❌ Packaging / installer

**Exit criteria:**

- [ ] `cargo tauri dev` opens the app on Windows
- [ ] Clicking "Smoke Test" shows `yt-dlp x.y.z` and `ffmpeg x.y.z`
- [ ] App rebuilds cleanly after edits to both .tsx and .rs files (HMR working)
- [ ] Repo pushed locally (no remote yet)

---

### 0.2.0 — Single-URL download *(~4–6 dev builds)* ✅ SHIPPED

**Goal:** Paste a YouTube URL, see the title/thumbnail/format list, pick
a format, download the full file to a folder. Proves the
metadata-fetch + download-with-progress pipeline.

**Scope (in):**

- Rust command `yt:fetchMetadata(url)` → spawns `yt-dlp -j --no-download`,
  parses JSON, returns `{title, thumbnail, duration, formats[]}`
- Format list UI: shows resolution + codec + filesize estimate per format
- Rust command `yt:download(url, formatId, destDir)` that streams yt-dlp
  stdout and emits per-line progress events via Tauri events
- React download row with progress bar, ETA, speed
- Output folder picker (defaults to `~/Media Hub/Downloads/` for now;
  dual-root library structure comes in 0.6)
- Error handling: bad URL, network failure, yt-dlp non-zero exit — surface
  in UI, don't crash

**Out of scope (cut):**

- ❌ Batch / queue (that's 0.4)
- ❌ Segment / In-Out (that's 0.3)
- ❌ Transcoding (absorbed into 0.3)
- ❌ Twitter/X (that's 0.7 — for now, YouTube-only is fine)

**Exit criteria:**

- [ ] Paste a YouTube URL, metadata loads in <3 seconds
- [ ] Pick a 720p MP4 format, click Download, progress bar moves smoothly
- [ ] Completed file plays in default video player
- [ ] Download a 5-min video while monitoring memory — Rust process stays under 100 MB

---

### 0.3.0 — Segment download + transcode pipeline *(~4–6 dev builds)* ✅ SHIPPED

**Numbering note:** original tree had transcode as its own 0.5
milestone. Consolidated here because ffmpeg was already wired up for
segment trim — adding presets was incremental work.

**Goal:** Two text inputs (In / Out, `HH:MM:SS` or `MM:SS`), click
Download, get a file containing only that segment. This is *the*
differentiator vs every other downloader.

**Scope (in):**

- In/Out timestamp inputs with validation (Out > In, both within video duration)
- Rust command `yt:downloadSegment(url, formatId, inSec, outSec, destDir)` that:
  - Uses `yt-dlp --download-sections "*<in>-<out>"` for true segment download
    where the format supports it
  - Falls back to download-full-then-ffmpeg-trim for formats that don't
    support byte-range segment fetch
  - Logs which path was taken (we'll surface this in UI later)
- "Segment preview" panel: shows duration, estimated filesize, source-vs-trim path
- Output naming: `<title>__<HH-MM-SS>_<HH-MM-SS>.<ext>`
- See NOTES.md "segment-download mechanics" — the doc that explains the
  range-vs-fallback distinction in detail

**Out of scope (cut):**

- ❌ In-app player / scrubber (that's 0.6)
- ❌ Frame-accurate timestamps (HH:MM:SS.ms) — second-precision is fine for MVP
- ❌ Multi-segment (one In/Out per download for now)

**Exit criteria:**

- [ ] Mark `01:30` → `01:45` on a 1-hour YouTube video; downloaded file is
      ~15 seconds long, plays correctly
- [ ] For a format with native segment support, downloaded bytes are
      ≪ full video size (verify in network monitor)
- [ ] For a format requiring fallback trim, UI shows "(full download + trim)"
      indicator so user understands the cost
- [ ] Invalid timestamps (Out < In, Out > duration) surface a clear error

---

### 0.4.0 — Batch queue *(~5–7 dev builds)* ✅ SHIPPED

**Implementation note:** the queue ended up living in the **renderer**
(React state + localStorage), not Rust. Pause/resume was deferred
because Windows process signaling for child processes requires extra
ceremony — see ARCHITECTURE.md §5. Worker pool: 3 parallel downloads,
separate CPU/GPU transcode semaphores so an libx264 + an NVENC job
can run simultaneously.

**Goal:** Multi-URL input, parallel workers, per-job progress, pause /
resume / cancel. The user's "I have 30 reference videos to grab" workflow.

**Scope (in):**

- Batch input: textarea (one URL per line) OR clipboard-paste auto-split
- Per-URL: pick format + (optional) In/Out segment before queuing
- Rust job queue (`tokio` channels + worker pool):
  - Configurable concurrency (default 3, max 6 — yt-dlp is bandwidth-bound,
    too many workers thrash)
  - Per-job state: queued / running / paused / done / failed
  - Pause / resume sends signal to the running yt-dlp process (POSIX
    `SIGSTOP`/`SIGCONT`; on Windows use `--external-downloader` aria2 with
    `--continue`, OR accept "cancel + re-queue from byte offset")
- Queue UI: sortable list with progress bars, per-row actions
- Retry logic: failed downloads auto-retry once with 5s backoff; second
  failure surfaces error to user
- On app close: persist queue state to disk, restore on next launch

**Out of scope (cut):**

- ❌ Bandwidth throttling per-job (global throttle in settings is fine)
- ❌ Cross-machine queue / remote workers
- ❌ Scheduled downloads ("download at 3am")

**Exit criteria:**

- [ ] Queue 10 URLs, 3 run in parallel, others pending
- [ ] Pause one mid-download, resume it, file completes correctly
- [ ] Cancel one, partial file is cleaned up (no `.part` left behind)
- [ ] Kill the app mid-queue, relaunch, queue restored with correct states
- [ ] Failed URL retries once, then surfaces error — doesn't infinite-loop

---

### 0.5.0 — Library MVP + UI overhaul *(~8–12 dev builds)* ✅ SHIPPED

**Numbering note:** original tree had this as 0.6 with the dual-root
Library/Projects model included. We split: the **SQLite + tags +
search + UI overhaul** shipped as 0.5, and the **dual-root + project
folders** got moved to 0.6 (paired with the in-app scrubber, since
both want a richer Library page than 0.5 ships).

What actually landed in 0.5:

**Goal:** Downloads stop being a Downloads folder dump. SQLite-backed
library with tags, search, thumbnails, rename rules. The "I downloaded
that explosion clip 2 months ago, where is it" problem solved.

**Scope (in):**

- Dual-root layout (`~/Media Hub/Library/` + `~/Media Hub/Projects/<name>/`),
  same internal organization per root:
  ```
  Library/                          Projects/My-Reel/
    YouTube/<channel>/<YYYY-MM>/    YouTube/<channel>/<YYYY-MM>/
    Twitter/<@user>/<YYYY-MM>/      Twitter/<@user>/<YYYY-MM>/
    _thumbnails/                    _thumbnails/
    library.db (shared)             project.json
  ```
- Top-bar "Active Project" picker (sticky setting); Library is the
  explicit one-click alternative
- SQLite schema (`sqlx` migrations): `assets`, `projects`, `tags`,
  `asset_tags`, with `assets.scope` = 'library' | 'project:<id>'
- Library + Project grid UI: thumbnail + title + duration + tags
  (same component, different scope filter)
- Tag editor: add/remove tags per asset, tag autocomplete
- Search box: matches title / channel / tags (FTS5 SQLite virtual table)
- Rename rules in settings: tokens like `{channel}`, `{title}`, `{date}`
- Right-click asset → "Reveal in Finder/Explorer"
- Right-click asset → "Export to project folder" (copy to user-picked dir)
- Right-click in Project → "Promote to Library" (move + reference pointer)
- Right-click in Library → "Copy to Project: <name>"
- "Finish Project" action: opens promote-first dialog, then moves
  project folder to OS trash
- Duplicate detection on download attempt — see NOTES.md "Duplicate /
  re-download handling" for the two-tier rules
- Auto-thumbnail: ffmpeg extracts mid-clip frame on download complete

**Out of scope (cut):**

- ❌ Watched-folders mode (we only index what we downloaded)
- ❌ Tag colors / tag groups (flat tags only)
- ❌ Smart playlists / saved searches
- ❌ Multi-machine library sync
- ❌ Duplicate detection across the library (post-1.0; just don't re-download
      from URLs that already exist)

**Exit criteria (as shipped):**

- [x] SQLite library auto-populates on every download
- [x] Tag any asset; tag-AND filter narrows the grid; free-text search
      matches title + channel with 150ms debounce
- [x] Real grid UI with sidebar facets (Source / Tags / Added)
- [x] Slide-over asset detail drawer with metadata + tag editor +
      Reveal in Explorer + Forget
- [x] Library page opens in <500ms with hundreds of assets
- [x] Local thumbnails extracted from disk file (0.5.1) — correct for
      segment downloads where the source's YT thumb doesn't represent
      the trimmed clip

**Deferred to 0.6 (was in the original 0.6 scope):**

- 🟡 Dual-root `Library/` + `Projects/<name>/` filesystem layout
- 🟡 Project-aware folder routing on download
- 🟡 Export to project folder (needs `@tauri-apps/plugin-dialog`)
- 🟡 Rename rules with `{channel}` / `{title}` / `{date}` tokens
- 🟡 FTS5 search upgrade (LIKE is fine for now)

---

### 0.6.0 — Dual-root library + in-app scrubber *(~8–12 dev builds)*

**Goal:** Two big pieces that pair naturally because they share UI
real estate (the In/Out timeline component) and both need a richer
Library page (project filter, project breadcrumb). Doing them
together is half the work of doing them separately.

**Scope (in) — dual-root + projects:**

- Dual-root layout:
  ```
  Library/                          Projects/My-Reel/
    YouTube/<channel>/<YYYY-MM>/    YouTube/<channel>/<YYYY-MM>/
    Twitter/<@user>/<YYYY-MM>/      Twitter/<@user>/<YYYY-MM>/
    project.json
  _thumbnails/  (shared at root)
  library.db    (shared at root)
  ```
- Top-bar "Active Project" picker stops being decorative; sticky
  default; Library is the one-click escape hatch
- New SQL: `projects` table, `assets.project_id` (NULL = Library)
- Project-aware download routing
- Right-click asset → Reveal / Export to chosen folder
- Right-click in Project → Promote to Library
- Right-click in Library → Copy to Project
- "Finish Project" action → promote-first dialog → moves folder to OS trash
- Rename rules in settings (`{channel}`, `{title}`, `{date}`)
- Duplicate detection on download (NOTES.md "Duplicate/re-download")
- `@tauri-apps/plugin-dialog` for the folder picker + capability scope

**Scope (in) — in-app scrubber:**

- HTML5 `<video>` element pointing at the direct stream URL
  (`yt-dlp -g` resolves) — no download needed for scrub
- Custom transport: play/pause, scrub bar with In/Out markers,
  ← → for frame-step, `I` / `O` to mark
- "Download segment" button uses the marked In/Out
- Fallback: low-res proxy download if direct streaming fails — see
  NOTES.md "scratch-preview tier"

**Out of scope (cut):**

- ❌ Watched-folders mode (we only index what we downloaded)
- ❌ Tag colors / tag groups (flat tags only)
- ❌ Smart playlists / saved searches
- ❌ Multi-machine library sync
- ❌ Frame-accurate seeking (yt-dlp segment cut is keyframe-aligned)
- ❌ Waveform display for audio
- ❌ Side-by-side version comparison

**Exit criteria:**

- [ ] Create a project, download into it, files land under
      `Projects/<name>/Platform/Channel/Month/`
- [ ] Switch active project from top-bar picker; library/grid scope changes
- [ ] Promote an asset from project → library and vice versa
- [ ] Finish Project moves the folder to OS trash (recoverable)
- [ ] Paste URL, scrub a 1-hour video without downloading; frame-step
      with arrows; `I` / `O` mark In/Out; download fires the marked segment
- [ ] Proxy fallback kicks in when direct streaming fails

---

### 0.6.1 — Multi-segment marking + library sibling indicator *(~1–2 dev builds)*

**Goal:** Mark N segments from a single source, download the source
**once**, ffmpeg-trim into N independent assets. Library makes it
obvious when multiple clips share a source.

**Scope (in):**

- Scrubber UI: hitting `I`/`O` builds up an array of `{in, out}` pairs
  instead of replacing a single pair. Visual: scrub bar shows all
  completed segments as green chunks + the current in-progress
  segment in a lighter tint
- "Segments" list below the bar with `<title> <in→out> <duration> [×]`
  per row. Click a row to seek the playhead to its In.
- Download button label scales: "Download" / "Download 3 segments"
- `yt_download` extends to accept `segments: Vec<(f64, f64)>`. When
  set, downloads source once, ffmpeg `-c copy` trims each segment,
  deletes the source.
- Each segment lands as its own asset row in the library, sharing
  `source_url` across siblings.
- `library_siblings(source_url, exclude_id)` returns peer assets.
- Library card: a small `#1/N` chip when an asset has siblings.
- Asset drawer: "Other clips from this source" section with thumbnails
  of sibling assets (click → opens that asset's drawer).

**Out of scope (cut):**

- ❌ Drag-to-reorder segments (just append-only)
- ❌ Per-segment transcode preset (whole batch uses one preset)
- ❌ Per-segment file naming overrides (auto-named from In/Out)
- ❌ Combining segments from different sources into one batch

**Exit criteria:**

- [ ] Mark 3 segments on a 10-min video, click Download once,
      receive 3 trimmed files
- [ ] Library page shows the 3 cards each with `#N/3` sibling chip
- [ ] Open any of the 3 in the drawer, see the other 2 in
      "Other clips from this source"
- [ ] Source file is cleaned up after successful trim
- [ ] One-segment download still works unchanged (back-compat)

---

### 0.7.0 — Twitter/X + platform abstraction *(~4–6 dev builds)*  *(deferred to post-1.0)*

**Status (2026-05-21):** moved to post-1.0. Owner: "twitter/x is
necessary at some point, but no rush, it's not my main source." See
decision log. The original scope below stays for when we pick it up
— probably as 1.1 or 1.2 once 1.0 has shipped and real-world usage
informs which other platforms (TikTok, Vimeo, Reddit) matter.

**Goal:** Twitter/X public tweets work end-to-end through every pipeline
above. Architecture refactored to a `Platform` trait so adding the next
source is a contained change.

**Scope (in):**

- Rust `Platform` trait: `fetchMetadata`, `getStreamUrl`, `download`,
  `downloadSegment`. YouTube + Twitter are implementations.
- URL routing: paste-to-detect routes to the right platform
- Twitter-specific quirks:
  - Tweet → highest-bitrate variant (Twitter ladders are simpler than YT)
  - Multi-video tweets: prompt user to pick which video
  - Quote-tweet videos handled correctly
- Library folder layout supports `Twitter/@user/...` from 0.6 dual-root
- Settings: optional Twitter cookie input (for following-only / sensitive
  content; defaulted to disabled, opt-in only)

**Out of scope (cut):**

- ❌ Twitter Spaces audio
- ❌ Twitter image / GIF download (it's a video tool, scope creep)
- ❌ Envato / Vimeo / TikTok / Reddit (parking lot, post-1.0)
- ❌ Auth flow UI beyond a single "paste cookie string" field

**Exit criteria:**

- [ ] Paste a public Twitter video URL, full pipeline (preview → segment →
      download → transcode → library) works
- [ ] Multi-video tweet shows a picker
- [ ] Author can add a TikTok platform impl in <500 LOC if they wanted to
      (architectural smell test — actual TikTok is post-1.0)

---

### 0.8.0 — Packaging, polish, public-ready *(~5–8 dev builds)*

**Goal:** Cross the "I'd give this to a friend" line. Real installers for
Win+Mac. Sidecar binaries bundled correctly. Onboarding flow. Audience
decision made.

**Scope (in):**

- Tauri bundler producing `.msi` (Win) and `.dmg` (Mac, both intel + arm64)
- Sidecar binaries bundled inside the installer (no separate download step)
- First-run onboarding:
  - Pick library root (or accept default)
  - Pick transcode default preset (ProRes 422 LT / DNxHR SQ / H.264 MP4 / skip)
  - Show 3-screen "this is how segment download works" tutorial
- Settings panel: library root, concurrency, default transcode, Twitter
  cookie field
- About panel: version, build hash, links to yt-dlp / ffmpeg licenses
- README polish: screenshots, what it is, install link, supported sites
- LICENSE file (likely MIT — confirm)
- Audience decision: public GitHub release? Private friends-only zip?
  Document in decision log.
- Test coverage backfill: anything load-bearing without tests gets some

**Out of scope (cut):**

- ❌ Code signing (cost — defer until distribution warrants it)
- ❌ Auto-updater (manual download for 1.0)
- ❌ App-store distribution (Mac App Store sandboxing is incompatible with
      sidecars; Microsoft Store is possible but not worth the bureaucracy)
- ❌ Localization (English only for 1.0)

**Exit criteria:**

- [ ] Clean Windows VM: install via .msi, launch, full pipeline works
- [ ] Clean Mac (intel + arm64): install via .dmg, launch, full pipeline works
- [ ] Onboarding completes in <60 seconds on first launch
- [ ] README + LICENSE + screenshots present
- [ ] Decision made + logged: public release or friends-only

---

### 1.0.0 — Release *(~2–4 dev builds)*

**Goal:** Tag it, ship it, use it. Whichever distribution the 0.8
decision picked.

**Scope (in):**

- Final QA matrix run on 2 machines (Win + Mac; matrix doc written
  closer to milestone — see `docs/v1_acceptance.md` once it exists)
- Release notes consolidating 0.1 → 1.0
- Git tag `v1.0.0`
- Installer attached to GitHub release (if public path chosen)
- Final pass over ARCHITECTURE.md + ROADMAP.md + NOTES.md so the
  public-facing docs match reality

**Out of scope (cut):**

- ❌ Marketing / launch posts
- ❌ v1.1 planning (write it after 1.0 ships and you see what you actually need)

**Exit criteria:**

- [ ] QA matrix green on both target platforms
- [ ] `v1.0.0` git tag pushed
- [ ] Author uses media-hub for at least 3 real B-roll sourcing sessions
      without falling back to other tools

---

## Post-1.0 — speculative, do not plan yet

Captured here so we don't lose ideas, but explicitly **not** scoped
until 1.0 ships:

**1.1 — platform abstraction + first new platform** (was 0.7)
- `Platform` trait refactor in Rust (YouTube + N impls)
- Twitter/X public tweets (no auth)
- URL routing on paste
- Designed against ≥2 real platforms, not guessed

**1.2 — workflow polish from real usage**
- Whatever the author actually needs after using 1.0 daily
- Likely candidates: command palette (Ctrl+Space, see NOTES), drag
  cards to NLE, color labels / star rating / per-asset notes, source
  attribution export (credits TXT for video descriptions)

**1.3 — more platforms (use-driven)**
- TikTok, Vimeo, Reddit — whichever shows up in actual workflow
- Envato Elements stays risky (no API, ToS-sensitive) — re-evaluate

**1.5 — library structure expansions**
- Library folders alongside tags (parked in NOTES)
- Watched-folders mode
- Eagle integration (folder export → API push)

**2.0 — chiral-network integration**
- Drop clips directly into a Chiral project's source folder
- Possibly Resolve media-pool import via Chiral's Python bridge

**2.x — long-tail**
- Smart playlists / saved searches
- Custom transcode presets
- Cross-library duplicate detection (more than just URL-match)
- Burned-in subtitle detection
- Export library subset as CSV
- `mediahub://` custom URL protocol handler

Anything more speculative than this belongs in `docs/NOTES.md` under
"parking lot," not the roadmap.

---

## Decision log

Newest first. Every entry: what we decided, when, and *why*.

### 2026-05-21 — Replan: 0.6.1 → 0.8 → 1.0, 0.7 post-1.0

- Decision: after shipping 0.6, the path to 1.0 is **0.6.1**
  (multi-segment marking + sibling indicator) → **0.8** (packaging +
  settings) → **1.0** (release). The original 0.7 (Twitter/X +
  platform abstraction) moves to **post-1.0** as 1.1.
- Why:
  - Owner's signal: Twitter is "necessary at some point, but no rush,
    it's not my main source." YouTube covers 95%+ of editorial B-roll.
  - Multi-segment is a real bandwidth-saving workflow improvement
    that came up organically — "wanna be able to cut multiple parts
    before downloading instead of redownloading per cut."
  - 0.8 (cookies + settings + installer) unlocks age-restricted YT
    **today** AND crosses the "I'd give this to a friend" line.
  - 0.7 (Platform trait) is architecturally important but designs
    better against ≥2 real platforms than against YT + speculative
    Twitter. Deferring lets us shape the abstraction around concrete
    usage (TikTok + Twitter? Vimeo + Reddit?) instead of guessing.
- Trade-off: ship date for Twitter slips. Owner explicitly accepted.

### 2026-05-20 — Milestone renumbering after consolidating transcode + UI

- Decision: collapse original "0.5 transcode pipeline" into 0.3
  (shipped together since segment-trim already had ffmpeg wired up).
  Original "0.6 library" becomes 0.5, with **dual-root + projects**
  pulled out into a new 0.6 that pairs with the **in-app scrubber**
  (originally 0.7) because both want a richer Library page than 0.5
  ships and they share the In/Out timeline component. Downstream
  milestones shift by one: 0.7 platform, 0.8 packaging, 1.0 release.
- Why: track the actual order of work, not the planned order. The
  consolidation in 0.3 was natural (no extra surface area); the 0.6
  pairing is efficiency (don't redo the library page twice).
- Effect: see updated milestone tree. Section headings below match
  the new numbers; backlinks across the doc updated.

### 2026-05-20 — Download queue lives in the renderer, not Rust

- Decision: the batch download queue is React state + localStorage
  persistence, not a Rust-side `JobQueue` daemon as originally
  planned in ARCHITECTURE.md.
- Why: progress events already flowed to the UI; React owned the
  worker-pool-orchestration sweet spot with `useEffect` + refs;
  localStorage gave persistence for free. Rust stays the single-
  purpose "run one yt-dlp / ffmpeg with progress" worker.
- Trade-off: closing the app mid-job kills that job. No
  Rust-daemon-keeps-downloading-while-window-closed flow. Accept
  for now — the actual yt-dlp invocation is short enough that
  restart-on-relaunch is fine. Revisit if the app is going to be
  used as a "run overnight" tool.

### 2026-05-19 — Dual-root library structure (Library + Projects)
- Decision: Two top-level roots — `Library/` (reusable, permanent) and
  `Projects/<name>/` (scoped, deletable). Active project is sticky
  default. Library is the one-click exception.
- Why: Owner's workflow is 90% project-focused. A folder you can move to
  OS trash is concrete, recoverable, and matches mental model. Project-as-tag
  is scary to delete and easy to get wrong. See NOTES.md for the killer
  interactions (Promote / Copy / Finish Project).

### 2026-05-19 — Multi-segment marking in 0.6 scrubber (was 0.7)
- Decision: The in-app scrubber supports multiple In/Out pairs per
  preview session. Queue them all in one go.
- Why: User confirmed it's a high-value workflow. Architecturally cheap —
  the segment download command already takes one pair; the scrubber UI
  iterates. Avoids the "scrub the same video 4 times" tax.

### 2026-05-19 — AI b-roll search is post-1.0, as query translator (not video judge)
- Decision: Parked as v1.5/v2.0. AI generates editorial search queries
  from transcript + markers; results from YouTube/Pexels/Pixabay
  pipelines. NOT "AI watches video to evaluate fit."
- Why: Video-frame evaluation by AI is slow + expensive; bad fit for a
  free personal tool. Query translation is doable, useful, and needs only
  a BYO API key. Pexels/Pixabay are first-class platforms for this use
  case (free APIs + editorial tags + license-clear stock).
- How to apply: NO architectural change needed now. Platform trait
  handles new sources for free. Just don't paint into a corner that
  makes adding AI-driven search hard.

### 2026-05-19 — Tauri + Rust over Electron + Node
- Decision: Tauri 2 with Rust backend. Pivot allowed in week 1 if Rust
  friction stalls progress.
- Why: Bundle size and RAM matter when shipping 150 MB+ of sidecars
  already. Author is open to learning Rust; the Rust surface is
  template-friendly (spawn process, parse stdout, emit event).

### 2026-05-19 — App-managed library root, not watched folders
- Decision: Media Hub owns `~/Media Hub/Library/` with platform-organized
  subfolders. "Export to project" action copies clips out.
- Why: Cleanest for tagging/search. Watched-folders is Lightroom-style
  flexibility we don't need yet — adds many edge cases (files moving
  outside the app) for little MVP gain.

### 2026-05-19 — Envato Elements is post-1.0
- Decision: Envato Elements is parked as 1.2 speculative, NOT a v1.0
  feature.
- Why: No public API, ToS-sensitive, authenticated session is fragile.
  Better to ship YT+X polished than YT+X+broken-Envato. Re-evaluate
  after 1.0 if author still wants it.

### 2026-05-19 — ProRes 422 LT as the default transcode preset
- Decision: 422 LT is the recommended default. DNxHR SQ + H.264 MP4 as
  other presets. No custom presets in MVP.
- Why: 422 LT is the sweet spot for B-roll source footage (small enough
  for storage, plenty of quality for source). 4444+alpha is rare for
  downloaded clips. Custom presets are a rabbit hole worth deferring.

### 2026-05-19 — Text inputs for In/Out in MVP; in-app scrubber by 0.6 (was 0.7)
- Decision: Ship segment download in 0.3 with text inputs. Real scrubber
  is a separate milestone.
- Why: Decouples the killer feature (segment download) from the polish
  layer (UX). Lets us validate the download pipeline before investing
  in player UX. The fallback proxy mechanic for scrubbing has its own
  unknowns — better isolated.

### 2026-05-19 — Windows + macOS only through 1.x
- Decision: No Linux in 1.x.
- Why: Tauri makes Linux nearly free in build terms, but doubles QA.
  Editors aren't on Linux in meaningful numbers. Match the chiral-network
  posture: ship for the platforms the real users are on.

---

## How to use this document

- **Pick the next milestone**, read its scope + out-of-scope, work it.
- **When tempted to add scope mid-milestone**, ask: is this in scope? If
  no, write it down in the *next* milestone's scope, or in NOTES.md
  parking lot. Don't expand the current milestone.
- **When a decision feels uncertain**, search the Decision Log first. If
  it's there, the rationale is captured. If it's not, add a new entry
  once you decide.
- **When this doc drifts from reality**, fix the doc. A stale roadmap is
  worse than no roadmap.

Companion docs:
- `docs/ARCHITECTURE.md` — planned system shape (will update to match
  reality as code lands)
- `docs/NOTES.md` — working notes, ideas parking lot, gotchas to
  remember
- `docs/v1_acceptance.md` — QA matrix for 1.0 *(write closer to 0.8)*
- `CHANGELOG.md` — what shipped, in order *(start at 0.1)*
