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
| **Audience for 1.0** | Just the author + close circle. Maybe GitHub release as distribution, no community commitment. | Same posture as chiral-network. Decide for real at 0.9.0 — if it's polished, why not share. |
| **Platforms** | Windows + macOS for 1.0. Linux never (or 3.0+). | Tauri makes Linux ~free, but doubles QA. The two real platforms for editors are Win and Mac. |
| **Stack** | Tauri 2 + React + TS + Rust. yt-dlp and ffmpeg as sidecar binaries. SQLite for library. | Smaller install + better RAM than Electron; matters when shipping ~150 MB of sidecars already. Pivot to Electron+Node in week 1 if Rust friction stalls progress. |
| **Library model** | Dual-root: `~/Media Hub/Library/` (reusable, lives forever) + `~/Media Hub/Projects/<name>/` (scoped, deletable as a unit). Active project is sticky default — Library is the one-click exception. | Reflects 90% project-focused, 10% loose-browsing reality. Folder you can `rm -rf` (with OS trash safety net) beats fragile project tags. See NOTES.md "Library vs Projects" for details. |
| **Scrubber UX** | Text-input timestamps for MVP. In-app scrubber by 0.7.0. | Text inputs ship the killer feature (segment download) without blocking on player UX. Scrubber is the polish layer. |
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

## Current state — 2026-05-20

Two days in, milestones 0.1 → 0.4 shipped, 0.5 foundation + tags + search
shipped (proper library page UI deferred). 13 commits on `main`.

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

What's partially done (counts as 0.5 but not all of it):
- ✅ assets schema + insert/list/delete commands
- ✅ tags + asset_tags schema with CASCADE delete
- ✅ Per-asset tag editor in dev UI
- ✅ Tag cloud filter + free-text search
- 🟡 Library UI is the "dev view" — functional but not the proper grid
  from the design reference. Real library page lands with the UI overhaul.

What's deferred (not done, won't be done this session):
- 🟡 Pause / resume in batch queue (Windows process signaling)
- 🟡 Export to project folder (needs `@tauri-apps/plugin-dialog` for
  folder picker — separate plugin install + capability)
- 🟡 Rename rules with `{channel}` / `{title}` / `{date}` tokens (needs
  settings panel which doesn't exist)
- 🟡 FTS5 search upgrade (current LIKE is fine for <10k assets; revisit
  if needed)
- 🟡 Proper UI overhaul (top bar, nav, route-based screens) — pairs
  naturally with the library page rebuild

---

## Milestone tree

Each milestone has: **Goal** (one sentence), **Scope** (in), **Out of
scope** (explicit cuts), **Exit criteria** (concrete checklist).

Effort estimates are in *dev builds*, not calendar time. A "dev build"
≈ 1–3 hours of focused work that produces a testable state.

```
dev0 ──┐
       ▼
     0.1.0  ── boilerplate + sidecar smoke test
       │
       ▼
     0.2.0  ── single-URL download
       │
       ▼
     0.3.0  ── segment download (the killer feature)
       │
       ▼
     0.4.0  ── batch queue
       │
       ▼
     0.5.0  ── transcode pipeline
       │
       ▼
     0.6.0  ── library MVP
       │
       ▼
     0.7.0  ── in-app scrubber preview
       │
       ▼
     0.8.0  ── Twitter/X support + platform abstraction
       │
       ▼
     0.9.0  ── packaging, polish, public-ready (audience decision lives here)
       │
       ▼
     1.0.0  ── release
```

---

### 0.1.0 — Boilerplate & sidecar smoke test *(~2–3 dev builds)*

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

### 0.2.0 — Single-URL download *(~4–6 dev builds)*

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
  library structure comes in 0.6)
- Error handling: bad URL, network failure, yt-dlp non-zero exit — surface
  in UI, don't crash

**Out of scope (cut):**

- ❌ Batch / queue (that's 0.4)
- ❌ Segment / In-Out (that's 0.3)
- ❌ Transcoding (that's 0.5)
- ❌ Twitter/X (that's 0.8 — for now, YouTube-only is fine)

**Exit criteria:**

- [ ] Paste a YouTube URL, metadata loads in <3 seconds
- [ ] Pick a 720p MP4 format, click Download, progress bar moves smoothly
- [ ] Completed file plays in default video player
- [ ] Download a 5-min video while monitoring memory — Rust process stays under 100 MB

---

### 0.3.0 — Segment download (the killer feature) *(~4–6 dev builds)*

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

- ❌ In-app player / scrubber (that's 0.7)
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

### 0.4.0 — Batch queue *(~5–7 dev builds)*

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

### 0.5.0 — Transcode pipeline *(~4–6 dev builds)*

**Goal:** After download (or as part of the download job), ffmpeg
transcodes to an edit-friendly format. Drop into Resolve and it just
plays.

**Scope (in):**

- Transcode presets (built-in, not user-configurable in MVP):
  - **ProRes 422 LT** (default macOS, available on Win) — `prores_ks -profile:v 1`
  - **DNxHR SQ** (Avid users on Windows) — `dnxhd -profile:v dnxhr_sq`
  - **Optimized H.264 MP4** — `libx264 -preset slow -crf 18 -movflags +faststart`
- Per-job toggle: "Transcode after download" with preset dropdown
- Global default in settings: which preset to use when toggle is on
- Rust command `transcode:run(srcPath, preset, destPath)` that spawns ffmpeg
  with parsed progress events (parse `out_time_ms` from `-progress pipe:1`)
- UI: post-download row shows "Transcoding…" with its own progress bar
- Option: "Keep original" vs "Replace with transcode" (default: keep both
  initially, change default after user feedback)

**Out of scope (cut):**

- ❌ Custom user presets (post-1.0)
- ❌ Hardware-accelerated encoding (defer; CPU is fine for B-roll quantities)
- ❌ Audio-only / video-only extraction
- ❌ Resolution downscale during transcode (use source resolution)

**Exit criteria:**

- [ ] Download a 4K YouTube video, transcode to ProRes 422 LT, file imports
      cleanly into Resolve and plays without dropped frames on author's machine
- [ ] DNxHR SQ output imports cleanly into Avid (if testable)
- [ ] Transcode progress bar moves smoothly, doesn't stall the UI
- [ ] Cancel a transcode mid-run, partial output is cleaned up

---

### 0.6.0 — Library MVP *(~6–10 dev builds)*

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

**Exit criteria:**

- [ ] Download 5 videos with varying segments, all land in correct
      `Platform/Channel/Month/` folders with correct names
- [ ] Add 3 tags to an asset, search by tag returns the asset
- [ ] Search by partial title returns the asset (FTS working)
- [ ] Export-to-project copies the file into a chosen folder
- [ ] Thumbnails appear in grid within 5 seconds of download complete
- [ ] Library with 200+ assets opens in <500ms

---

### 0.7.0 — In-app scrubber preview *(~5–7 dev builds)*

**Goal:** Replace the text-input In/Out workflow with a real video player
that streams the source URL, scrubs, frame-steps, click-to-set In/Out.

**Scope (in):**

- HTML5 `<video>` element pointing at the direct stream URL `yt-dlp -g`
  resolves (no download needed for scrub)
- Custom transport controls: play/pause, scrub bar with frame ticks,
  ← → for frame-step (arrow keys), `I` and `O` to mark In/Out
- Two markers on the scrub bar showing current In/Out
- "Download segment" button uses the marked In/Out
- Fallback: if direct streaming fails (some YouTube formats reject
  cross-origin without cookies), download a low-res proxy (480p) and
  scrub that instead
- See NOTES.md "scratch-preview tier" — the proxy fallback might be
  worth making the default once we measure how often direct-stream fails

**Out of scope (cut):**

- ❌ Frame-accurate seeking (yt-dlp segment cut is keyframe-aligned anyway)
- ❌ Waveform display for audio (defer)
- ❌ Multi-segment marking from one preview session (post-1.0)
- ❌ Side-by-side comparison of versions

**Exit criteria:**

- [ ] Paste YouTube URL, scrub through a 1-hour video without downloading the source
- [ ] Frame-step with arrows works
- [ ] `I` and `O` set In/Out, segment downloads correctly
- [ ] Fallback to proxy works when direct streaming fails (test with a
      known-bad format / age-restricted video)

---

### 0.8.0 — Twitter/X + platform abstraction *(~4–6 dev builds)*

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
- Library folder layout already supports `Twitter/@user/...` from 0.6
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

### 0.9.0 — Packaging, polish, public-ready *(~5–8 dev builds)*

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

**Goal:** Tag it, ship it, use it. Whichever distribution the 0.9
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

- v1.1 — whatever the author actually needs after using 1.0 daily
- v1.2 — Envato Elements (authenticated session, careful ToS read)
- v1.3 — additional platforms (Vimeo, TikTok, Reddit — based on use)
- v1.5 — watched-folders mode for the library
- v2.0 — chiral-network integration (drop clips directly into a Chiral
  project's source folder; possibly Resolve media-pool import via the
  same Python bridge Chiral already uses)
- 2.x — duplicate detection, smart playlists, custom transcode presets

Anything more speculative than this belongs in `docs/NOTES.md` under
"parking lot," not the roadmap.

---

## Decision log

Newest first. Every entry: what we decided, when, and *why*.

### 2026-05-19 — Dual-root library structure (Library + Projects)
- Decision: Two top-level roots — `Library/` (reusable, permanent) and
  `Projects/<name>/` (scoped, deletable). Active project is sticky
  default. Library is the one-click exception.
- Why: Owner's workflow is 90% project-focused. A folder you can move to
  OS trash is concrete, recoverable, and matches mental model. Project-as-tag
  is scary to delete and easy to get wrong. See NOTES.md for the killer
  interactions (Promote / Copy / Finish Project).

### 2026-05-19 — Multi-segment marking in 0.7 scrubber
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

### 2026-05-19 — Text inputs for In/Out in MVP; in-app scrubber by 0.7
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
- `docs/v1_acceptance.md` — QA matrix for 1.0 *(write closer to 0.9)*
- `CHANGELOG.md` — what shipped, in order *(start at 0.1)*
