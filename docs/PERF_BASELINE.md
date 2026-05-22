# Media Hub — 0.9.A Performance Baseline

Captured 2026-05-22, post 0.8.D + e524eab/6ed00b8 cookies polish.
The point of this doc: an honest "before" snapshot so 0.9.B (leaks)
+ 0.9.D (UX polish) can answer "did we get faster?" with numbers
instead of vibes.

When 0.9 wraps, compare 1.0 measurements against these. If
something got worse, that's a regression and we own it.

---

## Frontend bundle (`npm run build` output)

| Artifact | Size | Gzipped | Notes |
|----------|------|---------|-------|
| `dist/assets/index-*.js` | **322.90 kB** | **98.58 kB** | Single chunk, no code-splitting |
| `dist/assets/index-*.css` | **158.59 kB** | **84.27 kB** | Single file (App.css) |
| Fonts (64 files, Geist + Geist Mono, all weights × charsets) | **575 kB total** | n/a | Browser lazy-loads on-demand |
| `dist/` total | **1.2 MB** | — | |

**Red flags identified:**
- 🟡 **Single JS chunk.** Every page loads every component (Library
  grid, Download flow, Scrubber, Onboarding modal) regardless of
  which route is active. Not a download concern in Tauri (filesystem
  load, not network), but is a time-to-interactive concern and
  parse-cost concern on first paint.
- 🟡 **CSS is monolithic** at 2300 lines. Onboarding-only styles,
  Scrubber-only styles, Library-only styles all ship together.
  Pairs with JS code-splitting if we go that route.
- 🟢 **Fonts at 575 kB across 64 files** look heavy on paper but
  the browser only fetches the weight + charset variant it actually
  uses for a given page. Verify in DevTools Network tab during 0.9.C.

**Code-splitting candidates (0.9.A action items):**
1. `React.lazy()` each page route in `App.tsx`. Library, Download,
   Projects, Settings become separate chunks. Initial load only
   pulls the active route + Shell. Expected JS chunk reduction:
   probably 60-80 kB on the initial bundle.
2. `React.lazy()` the Onboarding modal — it renders for ~5 seconds
   on first launch and never again. ~10-15 kB savings.
3. `React.lazy()` the Scrubber — only renders after metadata loads.
   Could shave another 10-20 kB off initial.

---

## Source size (LOC)

| Layer | Lines | Largest file |
|-------|-------|--------------|
| Frontend TS/TSX | 5,493 | `Download.tsx` (1303) |
| Frontend CSS | 2,300 | `App.css` (monolith) |
| Rust | 3,170 | `lib.rs` (1363) |

**Per-file frontend (top 6):**
- `src/pages/Download.tsx` — **1303** ← splitting target (MetadataCard + QueueCard are distinct concerns)
- `src/pages/Library.tsx` — **948** ← potentially fine, but the drawer is a sub-component worth extracting
- `src/components/Scrubber.tsx` — **709**
- `src/pages/Settings.tsx` — **661**
- `src/components/Onboarding.tsx` — **456**
- `src/pages/Projects.tsx` — **319**

**Per-file Rust:**
- `src-tauri/src/lib.rs` — **1363** ← biggest. Three concerns crammed in:
  sidecar smoke test, yt-dlp commands, transcode + thumbnail commands.
  Splitting candidate for 0.9 if it helps readability.
- `src-tauri/src/library.rs` — **1315** ← assets + tags + projects.
  Borderline — could split into `assets.rs` / `tags.rs` / `projects.rs`
  but the SqlitePool is shared and they cross-reference.
- `src-tauri/src/settings.rs` — **486** ← healthy size.

---

## Bundled sidecars (the install-size elephant)

| Sidecar | Size | % of total install |
|---------|------|-------------------|
| `ffmpeg-x86_64-pc-windows-msvc.exe` | **202 MB** | ~92% |
| `yt-dlp-x86_64-pc-windows-msvc.exe` | **18 MB** | ~8% |
| **Total sidecars** | **~220 MB** | — |

**Reality check:** the installer for Media Hub will be ~220 MB
primarily because of ffmpeg. The frontend bundle (1.2 MB) and
the Rust binary (TBD — release build running) are noise next to
this.

**1.0 packaging strategy candidates (parked, not 0.9 work):**
- Custom ffmpeg build with only the codecs we actually use (libx264,
  prores_ks, dnxhd, aac, pcm_s16le, scale, +faststart). Could
  realistically halve ffmpeg.exe → ~100 MB. Effort: a CI workflow
  to build ffmpeg with restricted `--enable-*` flags.
- Download ffmpeg on first run instead of bundling. Adds first-run
  friction, defers the install pain.
- Use the system ffmpeg if available, fall back to a download
  prompt. Hybrid.

**Owner decision needed at 1.0 packaging time** — leaving as a
NOTES.md parking lot entry.

---

## Rust release binary

| Artifact | Size |
|----------|------|
| `target/release/media-hub.exe` (release, default strip) | **15.74 MB** |

Healthy size for a Tauri + sqlx + tokio + WebView2-host binary.
sqlx ships its query parser at compile time (no embedded SQLite
engine — that comes from the system or bundled .dll separately on
some platforms). tauri runtime + serde + tokio account for most
of the weight.

**Optional shrinking knobs (parked for 1.0):**
- `Cargo.toml` `[profile.release]` add `strip = "symbols"` + `lto = "fat"`
  + `codegen-units = 1`. Typical savings: ~30% on similar-sized
  Rust binaries. Slower build, but release is infrequent.
- `panic = "abort"` shaves another ~5% but loses panic unwind info.

---

## Total install footprint

| Component | Size | % |
|-----------|------|---|
| ffmpeg.exe | 202.60 MB | **84.9%** |
| yt-dlp.exe | 18.45 MB | 7.7% |
| media-hub.exe (Rust) | 15.74 MB | 6.6% |
| dist/ (frontend bundle) | 1.2 MB | 0.5% |
| icons + misc | ~0.5 MB | 0.2% |
| **Total** | **~238 MB** | — |

Owner-facing installer + uninstaller + Tauri's WebView2 bootstrapper
overhead will add a small constant on top of this (probably 1-3 MB
of NSIS / WiX scaffolding).

---

## Startup time (owner stopwatch)

**Methodology** (owner to capture, fill in this table):

1. Close all Media Hub processes (Task Manager → end any leftover).
2. Click the launcher / `.exe` (or in dev: `npm run tauri dev`,
   wait for "Listening on http://...").
3. Time from click to **window visible**: ___ seconds (dev build) / ___ s (release build)
4. Time from window visible to **interactive** (can click Settings
   nav and it responds): ___ seconds.

Three runs each, take the median. Note CPU/RAM usage during
launch from Task Manager.

**Why both dev + release:** dev includes the Vite dev server
spin-up + hot-reload overhead. Release is what users actually
experience. The delta should be substantial (~3-5x).

---

## RAM baseline (owner snapshot)

**Methodology** (owner to capture):

Open Task Manager → Details tab. Find these two processes:
- `media-hub.exe` (the Tauri parent — Rust + WebView2 host)
- `msedgewebview2.exe` (the actual renderer)

Capture working-set RAM at three moments:

| Moment | media-hub.exe | msedgewebview2.exe | Total |
|--------|--------------|-------------------|-------|
| Just launched, idle on Library | | | |
| After clicking through all 4 routes | | | |
| After 1 download + 1 transcode | | | |
| After 5 min idle | | | |
| After 30 min idle | | | |

The "5 min idle" + "30 min idle" rows are 0.9.B (leak hunting)
data. If RAM at 30 min ≈ RAM at 5 min, we're clean. If it grew
significantly with no user actions, we have a leak.

---

## SQL query analysis (0.9.A.2 — done)

**Index inventory before audit:**
- `idx_assets_downloaded_at` — ORDER BY in library_list ✅
- `idx_assets_platform_video_id` — composite, no current query uses it 🟡 dead
- `idx_assets_platform_channel` — composite, no current query uses it 🟡 dead
- `idx_asset_tags_tag_id` — tag joins ✅
- `idx_projects_created_at` — projects listing ✅
- `idx_assets_project_id` — scope filtering ✅
- Implicit composite on `asset_tags(asset_id, tag_id)` from PRIMARY KEY — serves
  asset-side lookups via leftmost-prefix rule ✅
- Implicit on `tags.name` from UNIQUE NOCASE ✅

**Real finding: `assets.source_url` has NO explicit index.** It's
used by three different queries:

1. `library_find_by_url(source_url)` — `WHERE source_url = ?`
2. `library_siblings(asset_id)` — looks up source_url for the
   input asset, then queries `WHERE source_url = ? AND id != ?`
3. **`library_list`'s correlated subquery for `sibling_count`** —
   `(SELECT COUNT(*) FROM assets s WHERE s.source_url = a.source_url AND s.id != a.id)`
   — **runs ONCE PER RESULT ROW.** Without an index, each sub-eval
   is a full assets scan. At N rows returned, that's O(N²) on the
   total table size.

SQLite's auto-index heuristic may eventually create one if the
table grows large enough, but we shouldn't rely on it. Shipped
explicit `idx_assets_source_url` in migration 005 (this commit).

**Impact estimate:**
- At 100 assets: a few ms either way, barely measurable
- At 1000 assets with 30% segment-siblings: ~10x improvement on
  library_list (subquery goes from full scan to index seek)
- At 10000+ assets: critical — without it, library_list becomes
  noticeably slow

**Other indexes worth dropping (cleanup, 0.9.D candidate, not now):**
- `idx_assets_platform_video_id` — no current consumer
- `idx_assets_platform_channel` — no current consumer
  Dead indexes cost INSERT throughput but don't help reads.
  Confirmed unused via Grep across the codebase. Keep until
  duplicate detection logic might grow into them, OR drop in
  0.9.D after one more pass.

**Tag-AND subquery cost (for future reference):**
- Each tag filter chip becomes a separate `EXISTS (...)` subquery
- Cost: O(tag_count) per result row, each EXISTS is an index seek
  on `idx_asset_tags_tag_id` + a tag.name lookup
- Practical limit: ~5 tag chips at once stays fast. Beyond that,
  consider rewriting as a JOIN with GROUP BY HAVING count() = N.
  Not pressing.

---

## What this baseline tells us (interpretation)

**Honest read on current state:**

1. **Bundle size is fine for a desktop app.** 1.2 MB total dist/
   loads off the filesystem at app start; it's not a network
   download. Time-to-interactive matters more than gzip size.
2. **Single-chunk JS is the biggest code-splittable win.** Should
   land in 0.9.A as a follow-up commit after we see real startup
   numbers from owner.
3. **ffmpeg is 92% of install weight.** Real conversation for 1.0,
   not 0.9.
4. **Two source files are pushing 1000+ lines.** `Download.tsx`
   and `lib.rs`. Splitting both is a 0.9.D readability win, not
   a perf win, but worth doing while we're in there.

**What 0.9.A will produce (committed action items):**
- `React.lazy` page-level code-splitting → measurable JS chunk
  reduction (target: initial chunk < 150 kB gzipped)
- Owner-captured startup time + RAM baseline numbers in this file
- SQL `EXPLAIN QUERY PLAN` results + any missing-index fixes

**What 0.9.A explicitly will NOT do:**
- Bundle size optimization beyond code-splitting (1.0 packaging concern)
- ffmpeg shrinking (1.0 packaging concern)
- Source file refactoring for LOC (0.9.D polish concern if at all)
