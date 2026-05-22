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

## RAM baseline (owner snapshot — partial, 2026-05-22)

**media-hub.exe (Rust host) — captured:**

| Moment | Private | Working Set | Notes |
|--------|---------|-------------|-------|
| Just launched, idle | 6.2 MB | ~38.8 MB | (PID 44040) |
| After download + transcode | 6.4 MB | ~39.6 MB | +0.2 MB delta |
| Library with 11 assets | ~7.2 MB | n/a | +18 KB per asset |
| 0% CPU at idle throughout | | | |

**Read:** Rust side is rock solid. Private memory under 10 MB, no
leak signal across normal operations, library scales linearly at
small N. Excellent starting point.

**WebView2 children (the actual React renderer) — captured 2026-05-22:**

WebView2 is multi-process (sandboxed children for GPU, network,
storage, audio, crashpad). All numbers below sum all children
under "Utilitário (6/7)" in Task Manager.

| Moment | Total WebView2 | Tauri+React proc | GPU proc | Notes |
|--------|----------------|------------------|----------|-------|
| Idle on Library | 121.2 MB | 43.4 MB | 34.8 MB | baseline |
| After clicks across routes | 130.1 MB | 49.6 MB | 39.3 MB | +9 MB nav cost |
| Library navigation, 11 assets | 132.6 MB | 52.3 MB | 38.1 MB | +2 MB delta |
| During download (peak) | 192.6 MB | 55.5 MB | **91.0 MB** | +60 MB GPU spike |
| After download settled | 145.6 MB | 51.2 MB | 48.7 MB | drops back |

**Owner-reported max during normal use: ~155 MB total.**

**Full app footprint** (WebView2 + Rust host):
- Idle: ~127 MB total
- Normal use (Library + Download): ~138 MB
- During downloads (typical max): ~155 MB
- Peak with scrubber active + decoding: ~199 MB

**Interpretation:**

✅ **Genuinely lean for a Tauri+React+video app.** For context:
   VS Code 300-500 MB · Spotify 250-400 MB · Discord 300-600 MB ·
   Slack 400-800 MB. We're under half.

✅ **Tauri + React process steady at 43-55 MB.** React state +
   DOM + JS engine. Not bloated.

✅ **Stable navigation cost.** +9 MB across all routes is the
   route components being instantiated for the first time
   (Library/Projects/Settings/Download). After that, navigation
   is free.

✅ **Library at 11 assets adds ~2 MB total.** Tracks with the
   Rust-side per-asset finding of ~18 KB. Scales linearly.

🟡 **GPU process spiked to 91 MB during download — investigate
   in B.2.** Likely the scrubber's `<video>` element holding
   decoded frame buffers. Dropped to 48 MB after. Confirm it
   returns to ~35 MB baseline when the user leaves the Download
   page entirely (no scrubber mounted).

**Code-splitting expected impact (A.5):** the 43-55 MB
"Tauri + React" process should drop ~5-10 MB once we lazy-load
Library/Projects/Settings off the initial path. Pages instantiate
only when navigated to instead of all-at-once on first load.

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
