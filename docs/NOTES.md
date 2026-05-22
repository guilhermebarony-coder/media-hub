# Media Hub — Working Notes

Status: living doc, last refreshed 2026-05-20 (post 0.5.1). This is
the parking lot for ideas, gotchas, and things-to-remember that don't
belong in ROADMAP (too speculative or too small) or ARCHITECTURE (not
a structural decision).

Format: dated sections, newest at top. Each entry self-contained —
written so future-me (or future-Claude) can pick it up cold.

**Companion docs:**
- `ARCHITECTURE.md` — what's actually built + how it fits together
- `ROADMAP.md` — milestone tree + decision log + cut-lines
- `FEEDBACK.md` — collaboration notes (personal, timeless)

**Milestone numbering note:** as of 2026-05-20 we collapsed the
original "0.5 transcode" into 0.3 and split the original "0.6
library" into 0.5 (SQLite + tags + UI overhaul, shipped) and 0.6
(dual-root + projects + in-app scrubber). Downstream shifts by one.
Some entries below pre-date the renumbering — check ROADMAP's
decision log for the mapping if a milestone number reads weird.

---

## 2026-05-22 (parked, owner to test) — Cookies story: where we landed after morning testing

Real-user testing this morning confirmed:

**Chrome family is broken upstream.** Chrome 127+ (Aug 2024) moved
cookies to "App-Bound Encryption." yt-dlp can't decrypt cookies
from any Chromium browser anymore (Chrome / Brave / Edge / Vivaldi
/ Opera). Tracked at yt-dlp/yt-dlp#10927. Symptom: `Failed to
decrypt with DPAPI` error. We added a translation that names this
exactly + the Settings → Sources page now shows an amber warning
callout when a Chromium browser is picked. We can't fix the root
cause — it's a deliberate Google security change.

**cookies.txt mode tested but still hit age-gate.** Owner exported
via "Get cookies.txt LOCALLY" while signed in (multiple accounts
visible in the export). cookies WERE applied (yt-dlp didn't fail
on the file load — it failed on YouTube's response). Two
hypotheses, owner to test:

1. **Google account isn't age-verified at the account level.**
   YouTube's age-gate often needs more than session cookies —
   most regions require ID verification before treating an account
   as confirmed-adult. Being signed in ≠ being age-verified.
   Sanity check: try a PUBLIC video with the same cookies.txt;
   if that works, problem is account-level verification.
2. **cookies.txt missing tokens.** Re-export while ON the actual
   age-restricted video page (not just youtube.com root) — some
   auth tokens are scoped tighter than expected.

**Recommended workaround going forward:** Firefox-by-default in
docs + onboarding wording. It's the only browser whose cookies
yt-dlp can still read. Update 0.8.D onboarding cookies screen at
some point in 0.9.D to surface Firefox as the recommended option
(not just "one option among several"). Tracked here.

**One more polish item if Firefox doesn't pan out for owner:**
- A "Diagnose cookies" Settings button that runs `yt-dlp -j`
  against a known public + a known age-restricted reference URL
  and reports both results. Would isolate "cookies aren't loading"
  from "account isn't verified." ~1hr. Slots into 0.9.C.

---

## 2026-05-21 (parked, target 0.9 / 1.2) — Multi-root library (Steam-style)

**Owner note (2026-05-21):** "Want some of the footage to be on C:/
and others on D:/ maybe, so might want to set places to set up our
library and either set more than one completely or at least being
able to manage between them inside the library page, maybe some
kind of tag system, or like steam where you can set up games
library and change where the game is saved, help me decide."

**The asks (two flavors):**

1. **Multi-root library** — register multiple folders as "library
   roots" (e.g. `C:\Media Hub` + `D:\Footage`). Every asset belongs
   to one root. On download, user picks which root (default = last
   used).
2. **Per-asset relocate** — Steam's "Move install location" pattern:
   pick an asset (or batch), choose target root, files physically
   move; DB updates `file_path`.

**Recommendation when picked up:** ship them as one feature — Steam's
mental model is the right reference. Adopt the same vocabulary
("library locations" or "storage locations") so users coming from
Steam feel at home.

**Why this fits well architecturally:**
- DB already stores full `file_path` per asset — multi-location is
  "free" at the data layer.
- The 0.8.C `settings.library_root` single-override is a special
  case of N-roots-with-one-default. Generalizing is a clean upgrade
  path, not a rewrite.
- `asset_set_project` already has the physical-move + cross-volume
  + collision logic. The "move to another root" command reuses 90%
  of it.

**What's actually new:**
- Settings schema: `library_roots: Vec<{ id, name, path }>` instead
  of single `library_root: Option<String>`. Migrate by promoting the
  current single value into a one-element list.
- New Rust command `asset_relocate(asset_id, target_root_id)`.
- Library page: per-root filter (sidebar facet alongside Source /
  Tags / Added), per-asset "Move to →" in the drawer, batch action
  once multi-select lands.
- Free-disk-space chip per root in the picker — Steam shows this
  and it matters when picking where 50 GB lands.

**Decisions to make at pickup time:**
- Can an asset live in MULTIPLE roots (linked copies) or strictly
  one? Vote: strictly one — simpler mental model, matches Steam.
- Root removal: what happens to its assets? Probably "merge into
  another root" (move files first) or "forget without deleting
  files." Steam refuses to remove a root with games in it; we can
  do the same.
- Default root: explicit (user-picked) vs sticky-last-used. Probably
  sticky.

**Target milestone:** this is meaningful work, paired well with the
**0.9 health checkup** (storage management is part of "feels like
a real app") OR slipped to **1.2 Eagle overhaul** (since folders +
multi-root + multi-select + bulk-ops belong together). Owner: "let's
sit on it" — pinged for revisit after 0.8.E.

---

## 2026-05-21 (parked, target 0.9) — Per-project external root

**Owner note (2026-05-21):** "Projects might want the projects
library to be inside my project folder, so a way to do that either."

**The idea:** when creating (or editing) a project, point it at an
arbitrary folder OUTSIDE `~/Media Hub/Projects/`. Example: user has
a `D:\Work\ClientX\` folder; setting that as the project's root
means downloaded clips land under `D:\Work\ClientX\raw\` instead of
`~/Media Hub/Projects/ClientX/raw\`.

**Why this matters:** professional editors organize on a per-job
basis. The whole job lives in `D:\Work\ClientX\` — premiere project,
exports, AAFs, the works. Forcing them to keep B-roll in
`~/Media Hub/Projects/ClientX/` and reach across paths is friction.

**Implementation sketch:**
- `projects.root_override: Option<String>` column.
- `resolve_download_dir` consults `root_override` before falling
  back to `<content_root>/Projects/<slug>/raw/`.
- Project create / edit gains a folder-picker (needs the
  `plugin-dialog` install we keep deferring — natural to land it
  here).
- "Finish Project" trashes the override folder same as today.
  Caveat: if the user pointed at a shared work folder, finishing
  trashes the whole folder. We need a CLEAR warning at finish
  time if `root_override` is set.

**Pairs with multi-root** — both are forms of "asset doesn't have
to live under the default tree." Implementing them together is
half the work of implementing them separately. Suggest bundling
into the **0.9 storage milestone** if we pull it forward, or 1.2
otherwise.

---

## 2026-05-21 (parked, target 0.8.E / 0.8.D onboarding) — Cookies UX: closed-browser pain + extraction tutorial

**Owner note (2026-05-21):** "Is there a way we can extract the
cookies easily for our users? Does Brave gotta be closed as well to
work? This is kinda of a dealbreaker."

**Reality check on the closed-browser requirement:**

| Browser | Windows | macOS |
|---------|---------|-------|
| Chrome / Brave / Edge / Vivaldi / Opera | **Must be closed** — Cookies SQLite file-locked. yt-dlp errors immediately. | Closed strongly recommended; sometimes works open. |
| Firefox | Usually works while open (different locking model). | Same. |
| Safari | macOS only; works while open. | — |

So yes — Brave specifically has the same constraint as Chrome
because both are Chromium derivatives sharing the same cookies-store
implementation. **Dealbreaker is fair.**

**What we can do without browser changes:**

1. **Auto-detect the file lock and surface a CLEAR error.** Today
   the yt-dlp error is buried in stderr ("Could not copy Chrome
   cookie database"). We can recognize the pattern and pop a row
   saying "Brave must be closed for cookie access — close it and
   retry, or switch to a cookies.txt export."
2. **Cookies.txt export tutorial** — short 4-step inline note in
   Settings → Sources when "From file" is selected, with link to
   the canonical "Get cookies.txt LOCALLY" Chrome/Firefox
   extension (open-source, no network). Pattern: paste the
   download link, follow the extension's "export current site",
   point Media Hub at the result.
3. **Auto-test the cookies on save** — when user picks a browser
   or path, immediately run a no-op `yt-dlp --cookies-from-browser
   X --simulate <known-public-url>` and report success/failure
   inline. Catches the locked-file case before the user wastes a
   real download attempt.

**What we CAN'T do well:**
- Read the SQLite cookies file directly from our Rust process —
  same lock applies, just moves the error message.
- "Headless export" via a CDP debugger session — only works if
  the user launches their browser with `--remote-debugging-port`
  which is way more friction than just closing the browser.
- Bundle a separate cookies-reader binary — Chromium changes the
  encryption scheme between versions; we'd be playing constant
  catch-up.

**Recommended action plan:**
- **0.8.D onboarding:** include a "Cookies (optional)" screen
  with the closed-browser warning visible upfront. Set the
  expectation BEFORE the user hits the wall.
- **0.8.D Settings → Sources:** add inline help when "From browser"
  is selected showing the closed-browser table above (or the
  short version of it). Add a "Test cookies" button.
- **0.8.E:** ship the auto-detect-and-translate-error patch so the
  failure mode is friendly when it happens anyway.
- **Cookies.txt tutorial:** inline expandable in Settings →
  Sources → "From file" mode. Links to the recommended extension.

**Long-term (post-1.0):** investigate Firefox-by-default in our
suggestion text since it's the only browser that doesn't have the
lock issue. Most editors won't switch browsers for our tool, but
"Firefox if you can, otherwise close your browser" is honest UX.

---

## 2026-05-21 (parked, target 0.9) — App health checkup milestone

**Owner note (2026-05-21):** "Before our 1.0, since we don't have
a 0.9 anymore i want to make 0.9 a full health checkup on the app,
splitting into phases to check stability, how reactive it is, UX
stutters, UI issues, check to make sure the app is as light as it
can, bugs, a full checkup, just to make sure everything is tight
together."

**Total agreement.** This is the move. Renaming the milestone tree:

```
... 0.8.E (packaging)
     │
     ▼
   0.9.0  health checkup  ← NEW
     │
     ▼
   1.0.0  release
```

**Suggested phase breakdown for 0.9:**

- **0.9.A — Performance audit.** Library page render time with N=100,
  500, 1000+ assets. SQL query plans (EXPLAIN). Settings reads. Are
  we re-rendering whole grids on every event? Memo the asset cards.
  Bundle size (`npm run build` size report). Startup time from
  click-to-window-visible.
- **0.9.B — Memory + leak hunting.** Run the app for 4+ hours,
  watch RAM in Task Manager / Activity Monitor. Open/close 50
  asset drawers, queue/clear 100 jobs, verify no unbounded growth.
  Tauri process + WebView2 process both. Check for retained event
  listeners (the listen/unlisten dance).
- **0.9.C — Bug census.** Walk every feature methodically with the
  "what could break this" hat on. Race conditions in queue,
  filesystem edge cases (long paths, non-ASCII, hidden files),
  yt-dlp error variations, ffmpeg failures, settings race like the
  one we just fixed. Aim for 0 known bugs at release.
- **0.9.D — UX polish.** Animation easing, focus states, keyboard
  navigation gaps, empty states for every list, loading states
  for every async action, error messages reviewed for clarity.
  "Does every dead-end feel like a dead-end?"
- **0.9.E — Accessibility + small details.** Tab order. Screen
  reader labels on icon-only buttons. Color contrast (lime on
  dark — verify WCAG AA). Keyboard shortcuts surfaced in tooltips.

Each phase = its own session, its own commit, its own fixes batch.
Same A→B→C cadence that worked for 0.6 and 0.8.

**What this DOESN'T include:** new features. 0.9 is exclusively
"make existing stuff better." Any new-feature ideas that come up
during 0.9 go into NOTES for 1.x. Discipline that keeps 0.9 from
becoming "and one more thing" creep.

---

## 2026-05-21 (shipped) — 0.8.C: rename rules, bandwidth, sticky format, library root

**Shipped:**

- **Library root override** (`settings.library_root`). New downloads
  + thumbnails route under the override path. `library.db` stays at
  the default `~/Media Hub/library.db` — moving an open SQLite file
  mid-session is fiddly and the user win is small. Existing files
  don't move; the override applies forward only.
  - New helper `settings::content_root(state, home)` is the single
    source of truth for "where does new content land." Callers:
    `yt_download`, `media_extract_thumbnail`, `asset_set_project`,
    `project_finish`, `library_delete` (thumb cleanup).
  - `library::resolve_download_dir` signature change: was
    `(state, home, project_id)`, now `(state, content_root,
    project_id)`. Keeps library.rs free of any settings dep.

- **Rename template** (`settings.rename_template`). Tokens
  `{title}` / `{channel}` / `{date}` / `{id}` map to yt-dlp's
  `%(...)s` placeholders. Empty = legacy default
  (`%(title).180B [%(id)s].%(ext)s`). Extension is auto-appended if
  the user forgets `{ext}`. `settings::build_filename_template` is
  the converter; tested by inspection.
  - Settings UI: preset dropdown with 4 patterns + a freeform
    template input. The dropdown shows "Custom" when the freeform
    value doesn't match a built-in — selecting Custom is a no-op,
    just a display affordance.

- **Bandwidth throttle** (`settings.bandwidth_limit_kbps`). Off by
  default (None / unlimited). When set, injects yt-dlp's
  `--limit-rate <N>K` per process. Note the per-process semantics:
  with N parallel workers the effective ceiling is N × limit. UI
  has a toggle + number input pair; off disables the field and
  preserves the last-typed value.

- **Sticky last-format per platform** (`settings.last_formats:
  HashMap<String, String>`). On metadata load, if a sticky format_id
  exists for the detected platform AND is still in the fetched
  format list, pre-select it. On download click, save the picked
  format_id under the platform key. Platform detection by URL
  substring (`youtube.com` / `youtu.be` → "youtube", same for
  twitter/tiktok placeholders — only YouTube is functional today
  but the shape is 1.x-ready).
  - Settings UI lists remembered platforms with per-row "Forget"
    buttons. Auto-populates on first download per platform, no
    user setup.

**Decisions worth keeping:**

- Library root scope: content only, not DB. The Settings hint
  explains this upfront so the asymmetry isn't surprising.
- Rename template doesn't sanitize unsafe chars at this layer —
  yt-dlp's always-on `--restrict-filenames` handles that
  downstream. Keeps the template logic readable.
- Sticky format storage in `settings.json` (not localStorage) so
  it's covered by the same atomic-write + survival semantics as
  every other preference. Will also auto-sync if we ever ship
  multi-window or settings export.

**What's left for 0.8:**
- **0.8.D** — first-run onboarding (3-screen tutorial: welcome,
  pick library root + transcode default, segment-download walkthrough
  + NLE watch-folder tip).
- **0.8.E** — packaging (.msi/.dmg installers, sidecar bundling,
  README polish, LICENSE, app icon).

---

## 2026-05-21 (parked, target 1.2) — Command palette (Ctrl+Space)

**Owner note (2026-05-21):** wants to reserve Ctrl+Space for a future
**fx-console / search palette**. The Ctrl-only override for "send to
Library" is in place; Ctrl+Space stays free.

**The idea:** Cmd-K style global palette, but invoked with Ctrl+Space.
Fuzzy-search across:
- Library / project assets (title, channel, tags)
- Project list (jump-to-project)
- Actions (download, settings, etc.)
- Tags (filter library by tag in one keystroke)

**Why Ctrl+Space (not Ctrl+K):** owner's pick. Ctrl+K is the web-app
convention; Ctrl+Space is more native-feeling and conflicts less with
browser muscle memory (Tauri webview inherits some browser
shortcuts).

**Where it fits:** somewhere between 0.7 (after platform abstraction)
and 0.8 (packaging polish). Not on the blocking path for 1.0 unless
the library gets big enough that finding things is painful.

**Implementation sketch (don't build yet):**
- Global keydown listener at the Shell level
- Modal overlay component (centered on viewport, dim background)
- Use a small fuzzy lib (`fuse.js` is ~12KB minified) or hand-roll a
  scorer — corpus is small (low thousands at most)
- Result rows have keyboard nav (↑↓ Enter Esc) + click
- Categories: header rows ("ASSETS · 12 results", "PROJECTS · 2",
  etc.) above grouped results

---

## 2026-05-21 (parked, target 1.2) — Eagle-style library overhaul

**Status update (2026-05-21):** target moved up from 1.5 to 1.2 after
owner asked whether to do this as 0.9 (pre-1.0). Decision: defer to
post-1.0 but make it the first major milestone after the "drag-to-NLE
+ daily-use polish" 1.1. See ROADMAP decision log
2026-05-21 entry "Eagle-style overhaul lands post-1.0, not as 0.9."

Includes: library folders, color labels, star ratings, per-asset notes,
better filter sidebar, multi-select + bulk ops. Folder export with
sidecar JSON (the simplest Eagle integration path) folds in here too.

---

## 2026-05-21 (parked, target 1.5) — Eagle integration (deeper, API-based)

**Owner note (2026-05-21):** "we can get some of the library controls
from eagle app, and maybe even do a integration somehow, being able
to export it to eagle or something."

Eagle (eagle.cool) is a popular media-manager app with strong patterns
worth borrowing or directly integrating with.

**Inspiration to borrow (no Eagle needed):**
- **Smart folders** — saved searches that materialize as folders.
  We already have tag filters; saving a filter combo as a named
  "smart project" would be the natural next step. Pairs with
  command palette.
- **Color labels** — a 5–6 color palette assignable per asset for
  fast at-a-glance status (review / approved / b-roll / hero / etc.)
- **Star rating** — 0–5 stars per asset, sortable
- **Note field per asset** — free-form text alongside tags
- **Visual similarity search** — find clips that look like the
  selected one (CLIP embeddings; medium-effort)
- **Multi-select grid + bulk operations** — already on the
  no-brainer list for any decent library page

**Eagle integration paths (decide if/when):**
1. **Folder export** (easiest): "Export to Eagle" action in asset
   drawer that copies the file + a sidecar `.json` with our tags
   into a user-picked folder. Eagle has an "Import folder" feature
   that picks this up. Bidirectional sync is NOT the goal — just
   "send these to Eagle and let Eagle take it from there."
2. **Eagle HTTP API** (Eagle ships with a local API on
   `localhost:41595` — public, documented). Could push assets +
   tags + thumbnails directly without filesystem dance.
   - https://api.eagle.cool/
   - Endpoints: `/api/item/addFromPath`, `/api/folder/create`,
     `/api/item/info`, etc.
   - Trade-off: requires Eagle running, tight coupling, but
     genuinely seamless ("send to Eagle" → asset appears there
     instantly)
3. **Two-way watch** (don't): trying to sync Media Hub library ↔
   Eagle library two-way is a rabbit hole. We're a sourcing tool;
   Eagle is a manager. One-way push is the clean integration.

**Recommended approach if owner pulls the trigger:**
- Start with #1 (folder export with sidecar JSON) — no runtime
  dependency, works offline, low risk
- Upgrade to #2 (Eagle API push) once #1 proves the workflow is
  used
- Skip #3

---

## 2026-05-21 (partially shipped) — File management vision

**Status (2026-05-21 update):** ✅ #1 delete-from-disk shipped in Phase B.
🟡 #2 drag-to-NLE → target 1.2. ✅ #3 NLE watch-folder works today
(point your NLE at `Projects/<name>/raw/`); needs docs in 0.8 onboarding.

**Owner notes (2026-05-21):** "we also need a good way to manage our
files properly, wanna be able to delete them from directory from the
app and if possible, drag them from the app to import directly to the
apps, or even a watch folder that when you download on a project it
imports to the project on a folder for you, anyways, i want it to be a
good way to manage my footage."

Three distinct asks here, each with a different difficulty / payoff:

### 1. Delete files from disk via the app
**Easy.** Today's "Forget" button removes the DB row but leaves the
file on disk. Add a "Delete file" option (with double-confirm — this
is destructive) that also `std::fs::remove_file`s the path. Use OS
trash if we can find a small crate (`trash` crate on crates.io does
this cross-platform). Should land in Phase B alongside the routing
work — natural pair.

### 2. Drag-from-app to NLE / external app
**Doable, ~medium.** Tauri webviews participate in OS drag-drop. The
recipe:
- HTML5 `<img>` or `<div draggable>` fires `ondragstart`
- We need to call `event.dataTransfer.setData("DownloadURL", ...)`
  with a `file://<path>` and a sensible mime type
- For native OS drag-drop (drag the card OUT of the app window into
  Premiere / Resolve / Finder), Tauri 2 has experimental support via
  `window.start_drag_drop` (Rust side) — needs verification
- Drop targets that accept file paths: Resolve media pool, Premiere
  bin, Final Cut event, system Finder/Explorer. They all accept a
  dropped MP4 / MOV file.
- Multi-select drag (drag 5 cards in) is a stretch goal

**Catch:** the dragged file needs to physically exist at a stable
path. Phase B's project routing helps here — once files live in
`Library/raw/...` or `Projects/<slug>/raw/...`, those paths are
durable and editor-friendly.

### 3. NLE watch-folder integration
**Not really our problem — but we can make it trivial.** Most NLEs
support watching a folder and auto-importing new files:
- Resolve: Media Pool → right-click bin → "Auto-Sync to Bin"
- Premiere: Media Browser is a near-equivalent
- Final Cut: drop into Smart Collections via watched event folder

The user-side workflow becomes: "point Premiere's media browser at
`~/Media Hub/Projects/<active>/raw/`. From now on, every clip you
download into that project auto-imports." This needs ZERO Media Hub
work — the dual-root structure already enables it. We just need to
document it in a "Set up your NLE" onboarding section (0.8).

### Priority call
- **#1 (delete from disk)** ships in Phase B tonight.
- **#3 (NLE watch folder docs)** ships as part of 0.8 onboarding.
- **#2 (drag-to-NLE)** is a 0.7-ish polish feature. Worth a session
  of its own once we know Phase B routing works.

---

## 2026-05-21 (parked, target 0.8) — Age-restricted YouTube videos / cookies

**The bug (2026-05-21):** age-restricted YouTube URLs (e.g. game
trailers with violence flags) fail with:
> Sign in to confirm your age. This video may be inappropriate for
> some users. Use --cookies-from-browser or --cookies for the
> authentication.

**The fix yt-dlp offers** is to pass cookies. Two approaches:

1. `--cookies-from-browser <browser>` — yt-dlp reads cookies directly
   from a browser's local profile. Browsers supported: chrome,
   chromium, brave, edge, firefox, opera, safari, vivaldi.
   - Pros: zero user effort, just pick the browser once
   - Cons: requires user to be signed in to YouTube in that browser;
     on Windows the browser must be closed (file lock) for Chrome
     family, Firefox is more forgiving

2. `--cookies <path/to/cookies.txt>` — user exports their cookies
   manually via a browser extension (e.g. "Get cookies.txt")
   - Pros: works even with closed/locked browsers
   - Cons: user effort, file goes stale, gross UX

**Recommended implementation** (paired with 0.8 settings panel):
- Settings field: "YouTube cookies source" with options:
  - None (default — most public videos work)
  - From browser: dropdown (Chrome / Firefox / Edge)
  - From file: path picker
- When set, `yt_fetch_metadata` and `yt_download` add the relevant
  flag to the yt-dlp argv
- Visual indicator on the Download page header: "Cookies: Chrome ●"
  matching the handoff design

**Until then:** the error message is captured and shown (works
today). User has to know to skip these URLs. Annoying but not
blocking — most editorial B-roll isn't age-restricted.

**Note:** the handoff design's Download screen mockup explicitly
shows "Cookies: Loaded" in the top-right, so this was always part of
the design intent.

---

## 2026-05-21 (post-lunch) — 0.6.1: multi-segment + library siblings

**Shipped:** the bandwidth-saving workflow. Mark N segments on one
source, hit Download once, get N independent clips. Library makes
sibling relationships visible without clicking through.

**Backend (lib.rs):**
- `yt_download` signature breaking change: replaced `in_sec`/`out_sec`
  pair with `segments: Option<Vec<(f64, f64)>>`. Returns
  `Vec<DownloadResult>` (single-element vec for full-video and
  single-segment modes — clean back-compat).
- Logic flow:
  - Always full source download (yt-dlp), regardless of segment count
  - If segments present: ffmpeg `-c copy` trim per pair, deletes
    source after all trims succeed
  - Per-trim filename: `<title> [<id>] [seg_<in>_<out>].<ext>`
  - Partial failure leaves the source on disk + any successful
    trims, so the user has something to recover

**Backend (library.rs):**
- `library_siblings(asset_id)` returns peers sharing the same
  `source_url`, sorted by in_sec (so siblings appear in temporal
  order from the source video).
- New `SiblingSummary` projection (compact — id, title, thumbnails,
  in/out, scope label) since the drawer's row UI doesn't need full
  Asset rows. Less IPC payload, faster render.
- `library_list` query now includes a `sibling_count` column via a
  correlated `SELECT COUNT(*) FROM assets WHERE source_url = a.source_url AND id != a.id`.
  Cost: O(N) per result row but each lookup hits the implicit
  source_url index. Fine for <10k assets. Switch to a precomputed
  count if it ever bottlenecks.

**Frontend (Scrubber):**
- Props: `segments: Segment[]` + `onSegmentsChange`. Replaces the
  old inSec/outSec single-pair shape.
- New `draftIn` local state. The mark flow is:
  1. Hit `I` (or Set In button) → `draftIn` set to current time
  2. Scrub to desired Out point
  3. Hit `O` → segment auto-committed to the parent's array,
     `draftIn` clears. Ready for the next `I` to start segment #2.
- Visual:
  - Each committed segment is a green band on the scrub bar
  - Draft (after `I`, before `O`) renders as a lighter-tint band
    that grows as the playhead moves
  - Single IN marker on the bar while drafting (no OUT marker —
    the committed band shows it)
  - Segments list below the bar with `#1 0:24 → 1:15 (0:51) [×]`
    rows. Click times to seek. × removes the segment.
- Transient warning chip for invalid marks ("Set In first" /
  "Out must be after In"). Auto-fades after ~2s.
- Set Out button is disabled when no draft is open — visual nudge
  to hit Set In first.

**Frontend (Download flow):**
- `MetadataCard` now drives `segments` state instead of inSec/outSec.
- Manual fallback stays single-segment (the text-input row only
  supports one pair). Acceptable: the manual fallback is for "stream
  failed, type your one segment" edge case; multi-segment users will
  rely on the working scrubber.
- Download invoke passes `segments: [[in, out], ...]` (or null for
  full video).
- Result is `Vec<DownloadResult>` — iterate, transcode + library
  insert + thumbnail per segment. Transcode failures on segment N
  don't abort segments N+1..M, but the source clip is preserved as
  the asset for the failed transcode.
- Download button label scales: "Download" / "Download 3 segments"
  (with Ctrl override variant: "Download 3 → Library").
- Success row shows the list of N filenames when multi-segment;
  single-file path otherwise.

**Frontend (Library):**
- Library card shows a small `+N` lime chip next to the channel
  when `sibling_count > 0`.
- Asset drawer adds "Other clips from this source · N" section
  showing each sibling with a mini-thumb + title + in→out + scope.
- Click any sibling row → drawer re-points at that asset (single
  state change, scroll resets gracefully).
- Sibling list refreshes on `library:changed` so newly-trimmed
  peers appear without closing the drawer.

**Queue card (back-compat tweak):**
- `QueueCard.processOne` now unwraps `results[0]` from the new
  Vec-shaped return. Batch queue stays single-clip per URL — multi-
  segment is single-URL-only by design (out of scope for batch).

**Exit criteria from ROADMAP 0.6.1 — verified by code review:**
- [x] yt_download accepts segments array, returns Vec<DownloadResult>
- [x] Source file deleted after all trims succeed
- [x] Single-segment back-compat (queue keeps working)
- [x] Library siblings command + drawer section
- [x] Sibling chip on cards
- [x] Click sibling → drawer switches

**To verify manually next test session:** mark 3 segments on a long
video, click download once, confirm 3 files land + 3 library rows
appear + each card shows `+2` sibling chip + clicking through the
drawer cycles between them.

---

## 2026-05-21 (final) — 0.6 Phase D: in-app scrubber (closes 0.6)

**Shipped:** the scrubber finally replaces the text-input In/Out row
on the Download page. 0.6 is now complete end-to-end.

**Rust:** `yt_resolve_stream_url(url)` runs `yt-dlp -g` with a format
spec biased toward "browser-playable muxed MP4 ≤720p" (with falls
back). Returns `{ url, has_audio }`. No download required — just the
direct CDN URL the browser can stream via Range requests. Resolves
in ~1-2s typical (network bound).

**Frontend:** new `Scrubber` component in `src/components/` —
- HTML5 `<video>` element points at the resolved URL
- Custom transport: play/pause button, current/total time, fps indicator
- Scrub bar with click-and-drag seek, In/Out vertical markers,
  highlighted region between them, current-position playhead
- Global keyboard listener (skips when a text input has focus):
  - `Space`: play/pause
  - `←` / `→`: frame-step (1/fps, fallback 1/30)
  - `Shift + ←/→`: 1-second skip
  - `I`: mark In at current time
  - `O`: mark Out at current time
- Set In / Set Out buttons mirror the keys for mouse-only users
- Clear button when at least one marker is set
- Resets on URL change; stream re-resolves automatically

**Integration:** scrubber state (inSec/outSec as numbers) is now
the source of truth on the Download page. Text inputs still exist
but only when the user opens the "Manual timestamp entry" toggle —
they override the scrubber when open. Useful for the cases where:
- The stream URL fails (age-restricted etc.)
- The user wants frame-perfect precision via typing
- The user already knows the exact seconds without scrubbing

**Why kept manual mode behind a toggle:** every user-facing field
that exists "just in case" is permanent visual noise. Most of the
time the scrubber is what you want. Manual is one click away when
needed, invisible the rest of the time.

**Format pick for streaming:** `best[ext=mp4][height<=720]` first,
falls back. 720p is the sweet spot — plenty of resolution to mark
In/Out by eye, well-supported by every browser/webview, ~5 MB to
buffer the first chunk vs ~30 MB for 1080p. The DOWNLOAD itself
still uses whatever format the user picks; the SCRUB is intentionally
lower-fi.

**Frame-step caveat:** HTML5 video has no native frame-step API. We
step by `1 / fps` seconds. Close enough for editorial decisions; not
suitable for color-bar level frame analysis (overkill for our use
case anyway).

**What I didn't ship in 0.6.D:**
- Proxy fallback download (the NOTES.md "scratch-preview tier"
  parking-lot idea). Reason: in practice, the `best[ext=mp4]≤720p`
  format spec resolves to a playable URL for ~95% of public videos.
  Build the proxy fallback only after we have data showing direct
  stream fails often enough to bother
- Waveform display (parked from the start)
- Multi-segment marking from one scrub session (parked)
- Drag-to-NLE on the scrubber's current frame (different feature
  — file management vision note)

**0.6 is now done.** The dual-root library + scrubber milestone
closes. Next up: 0.7 (Twitter/X + platform abstraction) or 0.8
(packaging + settings panel that addresses the cookies issue).

---

## 2026-05-21 (later still) — 0.6 Phase C: duplicate detection + Finish Project

**Shipped:**
- `library_find_by_url(source_url)` — returns the most recent existing
  asset matching a URL, with scope label ("Library" or project name)
  joined in SQL so the renderer doesn't need a second round-trip
- Download page runs the dupe check in parallel with metadata fetch
  (both are I/O — no reason to sequence them). If a match exists, a
  lime-tinted "already saved" chip appears between the metadata hero
  and the segment bar, with an "Open existing" button. Doesn't BLOCK
  the download — sometimes you want a different format, segment, or
  transcode preset of the same source
- `project_finish(id, promote)` — the lifecycle endgame. Optionally
  promotes all project assets to Library (physically moves files
  into `Library/raw/`), then OS-trashes the project folder via the
  `trash` crate, then deletes the project row. Folder is recoverable
  from Recycle Bin / Trash but not from inside the app
- Projects page row gains a "Finish" button with three-way confirm:
  promote-to-library / trash-everything / cancel. Active project
  auto-falls-back to Library when finished

**Three-way confirm UX:** native `confirm()` is yes/no only, so the
finish flow does two prompts in sequence. First asks "promote
assets?" — OK = promote, Cancel = (don't bail, continue). Second
asks "trash everything?" — OK = nuke, Cancel = back out entirely.
Not as polished as a custom modal but works without dragging in a
dialog library. Replace with a real modal when we ship a settings
panel (0.8) and have the modal scaffolding anyway.

**`trash` crate:** cross-platform OS trash via Microsoft's
SHFileOperation on Windows, NSFileManager on macOS, freedesktop.org
spec on Linux. ~3MB of compile-time deps but the integration is
trivial (`trash::delete(path)`) and the UX win is huge — "Finish
Project" being recoverable is the whole reason it's a different
action from "Delete project."

**Polish in this commit:**
- Picker alignment: "ACTIVE" label now has 14px left padding so its
  first letter aligns with the project name's first letter. The dot
  hangs out to the left of the name row only
- Ctrl+Space → plain Ctrl: holding Ctrl alone is the override.
  Ctrl+Space is parked for the future command palette (see note
  above)

**Deferred to Phase D (or its own session):**
- In-app scrubber preview — the headline 0.6 visual feature
- Export-to-folder (needs plugin-dialog install)
- Custom modal component to replace native confirm() chains

---

## 2026-05-21 (later) — 0.6 Phase B: filesystem routing + scope moves

**Shipped:**
- `yt_download` accepts `project_id`. Rust resolves the slug from the
  projects table and computes the dest dir:
    - `None`            → `~/Media Hub/Library/raw/`
    - `Some(id)`        → `~/Media Hub/Projects/<slug>/raw/`
- `asset_set_project` is no longer metadata-only. It physically moves
  the file from source → target scope's folder, updates `file_path`
  in the DB, then sets `project_id`. Robust to: source-file-missing
  (DB-only update), target-dir-missing (creates), filename collisions
  (appends ` (2)`, ` (3)`...), cross-volume renames (copy + delete
  fallback).
- `library_delete` accepts an optional `delete_file: bool`. With
  `false` (default), preserves the file. With `true`, removes the
  file AND the thumbnail. Asset drawer now has two buttons: "Forget"
  (DB only) and "Delete file" (DB + disk + thumbnail), the latter
  double-confirmed.
- **Ctrl+Space override:** hold during the Download click and the
  asset routes to Library instead of the active project. Button
  swaps to "Download → Library" / "Queue → Library" while held,
  with a subtle outline+glow so the change is unmissable. Works for
  both single-URL and batch (whole batch inherits the override at
  enqueue time).

**Filesystem layout now:**
```
~/Media Hub/
├── Library/raw/<title> [<id>].<ext>
├── Projects/<slug>/raw/<title> [<id>].<ext>
├── _thumbnails/<asset_id>.jpg
└── library.db
```
The `raw/` subfolder per scope gives room for future siblings
(`proxies/` for the scrubber, `exports/` if we ever produce derived
files) without reorganizing. NLEs pointed at the project root pick
up `raw/` automatically.

**Slug stability:** project slug is computed at create-time and
NEVER recomputed on rename. Renaming a project's display name keeps
the folder name on disk stable. Visible in the projects page where
the slug shows next to the name as `mono faint` text.

**Migration note:** existing assets in `Downloads/_test/` keep
their old file_path strings. Reveal will fail for any whose file
the user deleted (most of them, since author has been pruning). New
downloads land in the new structure. Eventually we could add a
"relocate orphans" maintenance command, but for the author's actual
use case (clean library) it's not worth the engineering.

**What's left for Phase C:**
- Finish Project action (promote-first dialog, then OS trash on
  the folder)
- Duplicate detection on download (skip / overwrite / rename UX)
- `plugin-dialog` install + Export-to-folder action
- Scrubber (Phase D)

---

## 2026-05-21 — 0.6 Phase A: project foundations (metadata-only)

**Shipped:** the dual-root mental model lands, schema-first. New
migration `004_projects.sql` adds a `projects` table and an
`assets.project_id` column (nullable; NULL = Library). Every asset is
in exactly one scope: Library or one specific project.

**What's wired:**
- Rust commands: `project_create / list / rename / delete` +
  `asset_set_project` for moving an asset between scopes
- `LibraryScope` filter on `library_list` and `library_count` —
  tagged enum (`any` / `library` / `project { id }`) so the JSON
  shape is unambiguous from the renderer
- React `ActiveProjectProvider` context, persisted to localStorage
  (`mh.activeScope.v1`). Subscribes to `library:changed` so the
  picker refreshes when projects are created/renamed/deleted from
  any screen
- Top-bar picker is real now (dropdown listing Library + projects +
  "New project…" shortcut to /projects)
- Projects page has list, create form, rename, delete. Creating
  auto-activates the new project (matches "I just made this, where
  is it" reflex)
- Library page filters by the active scope; content-header title
  reflects the active scope name
- Download page header shows where new downloads will be assigned
  (metadata-level only)
- Queue jobs capture the project assignment at enqueue time
  (matching how transcode preset is locked at enqueue)
- Asset drawer has a Scope dropdown so any asset can be moved
  between Library / projects without re-downloading

**What's NOT wired (intentional, Phase B):**
- File on disk stays in `Downloads/_test/`. The `slug` column is
  stored at create-time so Phase B can route into `Projects/<slug>/`
  without renaming directories on rename
- Ctrl+Space "send to Library" download shortcut — only meaningful
  once routing actually exists. See "Ctrl+Space shortcut" note below
- Promote / Copy / Finish Project / Reveal — also Phase B

**Schema gotcha (carry from 0.5.1):** `ALTER TABLE ADD COLUMN` isn't
idempotent in SQLite. We added `assets.project_id` as the second
ALTER and the migration loop already swallows "duplicate column name"
errors. Worked first try. Pattern still holds — when we hit the
fifth ALTER it's time for a real migrations-tracking table.

**Why metadata-only Phase A is the right slice:**
- The risky cross-cutting work is the schema + Rust contract + state
  shape. All of that landed tonight, build-verified
- Phase B is now isolated: just file-routing in `yt_download` (and
  the move-on-scope-change in `asset_set_project`). No more
  user-facing types to design
- We get a usable scope filter immediately — you can create projects
  and start tagging assets into them tonight even though the files
  haven't physically moved

---

## 2026-05-20 (parked, target 1.5) — Library folders (in addition to tags)

**Owner note (2026-05-20):** "starting to think we're gonna need
folders to organize the library besides the tags, i'll sit on it but
write it and remember me when i ask"

**The idea:** keep the flat tag model AND give users hierarchical
folders (or collections, or whatever we end up calling them) for
project-y organization. Tags are good for cross-cutting metadata
("aerial", "golden-hour", "tutorial") but folders are good for
"everything belonging to the Q3 brand spot, in the order I dragged
them in."

**Why this might be more than tags + projects can cover:**
- The dual-root Library/Projects split (0.6) is one-level: each asset
  is in EXACTLY one project (or the Library). That's fine for
  "deletable as a unit" but not for "I want subgrouping inside a
  project" (e.g. Project/Interviews/, Project/B-roll/, Project/Stills/).
- Tags don't preserve order. Folders do (drag-reorder, manual
  curation, hand-built reels).
- Some workflows are folder-native and force-fitting them into tags
  feels wrong (e.g. "scene 1 / scene 2 / scene 3").

**Open questions to revisit when owner picks this up:**
- Are folders nested under projects, or a parallel concept?
- Can an asset live in multiple folders (symlink-style) or only one?
- Do folders carry their own tag-set / facets, or inherit?
- UX: tree in the left sidebar? Or breadcrumbs? Both?
- Does this push us toward a fully tree-shaped library (chiral-style
  collections) or stay flat-with-grouping?

**Implementation sketch (don't build yet):**
- New `folders` table (id, name, parent_id nullable, project_id
  nullable, sort_order)
- New `asset_folders` linking table (asset_id, folder_id,
  position) — many-to-many if we go symlink-style
- Library sidebar gets a "Folders" group above "Tags" with the tree
- Asset detail drawer gets a "Folders" section alongside Tags

**When to revisit:** owner will surface this. Pinged in this session
to keep the idea from disappearing into chat.

---

## 2026-05-20 (late) — Local thumbnails

**Shipped:** every download (single-URL or batch) triggers a fire-and-
forget ffmpeg pass that extracts a mid-clip frame into
`~/Media Hub/_thumbnails/<asset_id>.jpg` (480px wide, JPG q=4 → ~30-80
KB each). The path is stored in a new `thumbnail_path` column.

**Why local-preferred:** segment downloads are the killer feature.
Their YouTube CDN thumbnail shows the FULL video's representative
frame, which usually has nothing to do with the 15-second clip the
user actually downloaded. A frame extracted from the file on disk
shows what's actually there.

**Seek strategy:** jump to `duration/2` when known, else `1.0s`.
Mid-clip dodges intros / title cards. We use `-ss` BEFORE `-i` for
fast keyframe seek — frame-accurate seek would need `-ss` after `-i`
and is overkill for a thumbnail.

**Backfill:** on Library mount we query `library_thumbnails_missing`
and walk the list serially with a 150ms breather between extractions.
That fills in pre-feature assets over time without CPU thrashing.
Each successful set fires `library:changed` so cards update live.

**Asset protocol:** `tauri.conf.json` got `assetProtocol.enable = true`
with scope `$HOME/**`. Frontend uses `convertFileSrc(localPath)` to
turn a Windows path into an `asset.localhost/...` URL the webview can
load. Works identically in dev and packaged builds.

**Schema migration:** added `003_thumbnails.sql` with a single
`ALTER TABLE assets ADD COLUMN thumbnail_path TEXT`. SQLite's ALTER
isn't idempotent so the migration loop now swallows "duplicate column
name" errors specifically — a graceful workaround until we adopt a
real migrations tracking table.

---

## 2026-05-20 (evening) — UI shell: react-router + handoff tokens

**Shipped:** the dev-stack layout (three cards in a column under a
single header) is gone. Replaced with a real shell mirroring the
`design-reference/Media Hub Wireframes.html` spec: 44px top bar
(brand · active-project picker · search · settings), 216px left nav
(Workspace: Download/Library/Projects · System: Settings), routed
content area. `react-router-dom` with **HashRouter** — `tauri://` in
prod and `http://localhost` in dev have different origins, hash
routing sidesteps that completely.

**Design tokens:** lifted verbatim from the handoff CSS (bg-0..4,
text-0..3, line/line-hi, mono/sans, ok/err semantic colors) with one
swap — the handoff's amber accent (`oklch(0.78 0.13 75)`) is replaced
by our lime `#c7f154`. Same role, different identity. Brand square
in the top-left is lime-stroked. Bundled Geist + Geist Mono via
`@fontsource` so no network at runtime.

**Why not shadcn (yet):** the handoff is pure-CSS components, not
Tailwind utilities. Adding shadcn would require Tailwind + postcss
config + migrating every existing class. None of the screens we
needed (Download, Library, Projects, Settings) used primitives
complex enough to be worth that cost. Defer until we actually need
a Dialog or Combobox we don't want to hand-roll.

**Library page (real grid):** auto-fill 220px column grid. Cards
have placeholder thumbnail (diagonal-stripe) + title + sub-line +
up-to-3 tag chips. Sidebar facets for **Source, Tags, Added** with
counts from the SQL-filtered set (reflect current context). Search
box in the toolbar (debounced 150ms, event-driven refresh on
`library:changed`). Selecting a card opens a **slide-over drawer**
from the right with full metadata table, inline tag editor,
Reveal-in-Explorer, Forget. `Escape` closes.

**Deliberate gaps:** thumbnails are placeholders (need ffmpeg
mid-clip frame extract on download complete — separate task). The
List/Grid toggle shows both tabs but List is disabled. cmd-K
palette is decorative. Projects picker is decorative. Settings
panel is a stub. Each gap is logged in ROADMAP "deferred" so they
don't get lost.

**Default route is `/library`:** "open app → see what you have →
click Download when you need more" is the actual workflow.

---

## 2026-05-19 — Scratch-preview tier (idea, possibly killer)

**The idea:** Before any "real" download, fetch a tiny low-res proxy
(480p or even 240p, ~5MB for an hour). User scrubs/marks In/Out on the
proxy. *Then* fetch only the marked segment at full quality from the
original source.

**Why it's interesting:** It's a second-order application of the "no
bloat" philosophy. Most users would only think to avoid downloading the
full *final* clip. We can *also* avoid downloading the full *source*
just to find the right In/Out.

**Where this fits in the roadmap:**
- 0.3 ships segment download with text-input timestamps — no preview at all
- 0.7 ships in-app scrubber, default is direct streaming the YT URL
- The scratch-preview is the **fallback** when direct streaming fails
- IF direct streaming turns out to be unreliable in practice, promote
  scratch-preview to the default

**Open question:** for very long videos (>2hr Twitch VODs etc.), is
even the 240p proxy too big? Maybe segment the proxy itself? Don't
solve this until we measure it.

**Decision needed at 0.7:** measure direct-stream reliability first;
decide proxy-vs-direct based on data, not opinion.

---

## 2026-05-20 — Segment downloads: full-then-trim is the right architecture

After fighting `--download-sections` for a session and getting
audio-only output even with `--force-keyframes-at-cuts`, **we
abandoned yt-dlp's built-in trim and do it ourselves**:

1. yt-dlp downloads the full source normally (all our progress +
   muxing logic works)
2. After yt-dlp succeeds, if a segment was requested, run our bundled
   ffmpeg: `ffmpeg -ss <in> -i <full> -t <dur> -c copy -movflags +faststart <segment>`
3. Delete the full intermediate, return the segment path

Why this won:
- yt-dlp's `--download-sections` produced empty/audio-only video for
  AV1 high-res content. Even with `--force-keyframes-at-cuts`. The
  failure mode is silent — no error, just wrong file.
- yt-dlp's section-trim staging happens in a temp dir we can't reach
  from our polling, so the bar sat at 0 the whole time.
- Doing the trim ourselves with `-c copy` is fast (5-15s for 1GB),
  uses ffmpeg we already ship, and the failure mode is loud (ffmpeg
  exits non-zero with a clear stderr).
- We get real progress during the long download phase, then a brief
  trim. Total UX is fine.

Trade-offs we accept:
- **Full source bandwidth, always.** No way around this without
  byte-range support from the source (YouTube doesn't expose it for
  these formats).
- **Keyframe snapping on cuts.** With `-c copy`, ffmpeg can only cut
  on I-frames. The In point snaps to the nearest keyframe at or
  before the requested time (giving lead-in frames — good for
  editing). The Out point snaps to the next-keyframe boundary. For
  B-roll this is a feature, not a bug. For exact-cut needs (music
  sync etc.), would need re-encode at cuts — future "frame-accurate
  trim" toggle.
- **Quality: zero loss.** Both streams are byte-copied. Final file
  bytes within the [in, out] window are bit-identical to the full
  download. ffmpeg's `+faststart` rewrites only container metadata
  (moov atom position), not stream data.

---

## 2026-05-19 — Segment download mechanics (historical, superseded above)

**Earlier framing was wrong** — verified the hard way on 2026-05-20.
`yt-dlp --download-sections "*<in>-<out>"` does NOT do byte-range
fetching for any format. It ALWAYS downloads the full source video,
then trims via ffmpeg.

Cost of a segment download = full download bandwidth + small
trim/re-encode overhead. Same network cost as grabbing the whole file,
slightly more CPU/time.

**`--force-keyframes-at-cuts` is required for correctness**, not
optional. First test produced a 238 KB audio-only .mp4 instead of the
expected ~50 MB video segment from a 4K AV1 video. Root cause:

Modern high-res codecs (AV1, VP9 4K, HEVC) use long keyframe intervals
(4-10s between keyframes). A cut at an arbitrary timestamp (e.g. 0:30)
almost never lands on a keyframe. Without `--force-keyframes-at-cuts`,
ffmpeg's `-ss` seek produces empty/broken video frames at the boundary
and yt-dlp silently drops the broken video stream, keeping just audio.

With the flag, ffmpeg re-encodes a tiny window around each cut to
insert real keyframes at the user's chosen boundaries. The rest of
the segment is still byte-copied — no full re-encode. Cost: a few
seconds of CPU at cut points. Benefit: correct video every time.

**Temp dir forcing (`-P temp:<dest>`):** `--download-sections` stages
the full source in a temp dir before trimming. By default yt-dlp's
temp is wherever it likes (varies by platform/install). We force the
temp dir to be our dest dir so the in-flight file lands where our
filesystem-polling progress task watches. Without this, segment
downloads look frozen at 0% the entire time even though they're
actively pulling bytes.

**UI surfacing:** When the user types into the segment In/Out fields,
the help text below switches to "Segment downloads pull the full
source then trim — same download time, plus a few seconds of
re-encode at the cuts." Sets expectations honestly.

---

## 2026-05-19 — Transcode preset reasoning

**Default: ProRes 422 LT.** Reasons:
- Big enough quality headroom for grading/regrading B-roll
- ~3x smaller than 422 HQ (matters for library footprint)
- Plays well in Resolve, AE, Premiere, FCP — universal
- Available on both Win and Mac via ffmpeg's `prores_ks` encoder

**Alternative: DNxHR SQ.** For:
- Avid Media Composer users (DNxHR is its native intermediate)
- Slightly faster decode on some hardware than ProRes

**Alternative: H.264 MP4 "optimized."** For:
- User wants a small file, not an edit-friendly file
- Use `-preset slow -crf 18 -movflags +faststart` (faststart = web-streamable)
- Document clearly: "this is for upload/preview, not editing"

**NOT shipping in 1.0:**
- ProRes 4444 / 4444 XQ — only matters for VFX plates with alpha
- ProRes 422 HQ — overkill for source material
- DNxHR HQX / 444 — same
- HEVC — decode performance on edit timelines is bad; don't recommend

Custom presets are a post-1.0 feature. The 3 above cover ~99% of cases.

---

## 2026-05-19 — Library folder naming gotchas

YouTube channel names can contain almost anything — including
slashes, emojis, RTL characters, and "PRN"/"CON"/"AUX" on Windows.
Need a `sanitize_path_segment()` helper that:
- Replaces filesystem-illegal chars with `_`
- Truncates to a sane length (255 chars total path on Windows; budget
  ~100 chars per segment)
- Detects Windows reserved names and prefixes with `_`
- Preserves enough of the original to be human-recognizable

Same for video titles. Same for tweet IDs (those are safer — numeric).

**Reference the chiral-network experience here:** `lib/projects.js` and
related likely have this exact sanitization battle-tested. If we
re-implement, we'll re-discover the same edge cases.

---

## 2026-05-19 — Chiral integration (parking lot for v2.0)

The author already builds chiral-network. Natural integration points:

1. **"Send to Chiral" action on a library asset.** Right-click a clip
   → "Send to Chiral as reference for Shot_NNN." This drops the clip
   into a chiral shot's `source/` directory (or wherever Chiral expects
   reference footage to live).
2. **Resolve media-pool import via Chiral's Python bridge.** Chiral
   already has the Resolve scripting infra working — we could piggyback
   to import directly into the current Resolve project's media pool,
   bypassing manual import.
3. **Shared library?** Probably not — Chiral's Vault is per-project
   asset reuse; Media Hub's library is sourced footage. Different
   purposes. Don't conflate.

**Why park this:** Both projects need their own 1.0 first. Trying to
integrate before either is stable produces bidirectional bugs. Note it
here so we don't lose the idea.

---

## 2026-05-19 — Things I (Claude) want to remember about this codebase

A scratchpad for me. Future-Claude reading this in a later session:

- **Owner is learning Rust** — write Rust code in small, commented
  blocks; explain idioms (Result, Option, async/await, ownership) as
  they come up; don't dump 200 lines of Rust at once
- **Owner is learning programming generally** — bias toward fewer
  abstractions, more straight-line code. The chiral-network codebase
  shows the owner can hold a large mental model; don't dumb it down,
  but don't over-engineer either
- **Docs-first culture** — every meaningful decision goes into the
  decision log in ROADMAP.md or a section here. Don't bury decisions
  in commit messages alone
- **Match chiral-network's `lib/` discipline** — small focused
  modules, header comments that are the contract, atomic disk writes,
  path-safety asserts
- **The `assert_in_library_root` pattern is non-negotiable.** Any
  handler that deletes or moves files needs it. Don't ever skip.
- **Sidecars staging dir pattern** — same idea: write to a staging dir,
  atomic-move into library only on success. Never let a sidecar write
  directly into the library tree.

---

## 2026-05-20 — Library v1: SQLite, sqlx, tags, events

Shipped the library foundation + most of the v1 feature set in one
session. Decisions worth keeping:

**sqlx + manual migrations, no `sqlx::migrate!()`**

The macro requires DATABASE_URL at compile time, which means devs
checking out the repo need a DB file before `cargo build` works.
Avoided by embedding the migration SQL via `include_str!()` and running
it through `sqlx::query()` at startup. Migrations are CREATE ... IF
NOT EXISTS so applying them every launch is idempotent and cheap.

The `FromRow` derive doesn't need DATABASE_URL — only the `query!()`
macros do — so we enable the `macros` feature without paying that cost.

**Split AssetRow / Asset structs**

`sqlx::FromRow` can't decode a `Vec<String>` from a single column.
`#[sqlx(default)]` looked promising but still requires the field's
type to implement `Decode`. Cleanest workaround: one struct that maps
1:1 to the table for FromRow, another struct that adds the
denormalized `tags: Vec<String>` for serialization. Convert via
`impl From<AssetRow> for Asset` and populate tags from a second query.

For 0.5 this is fine. If we ever hit a query where we want tags
inline, we'd switch to `GROUP_CONCAT` + a custom FromRow impl.

**Tags: replace-all over add/remove**

The `tag_set_for_asset` command takes the WHOLE desired tag list and
diffs server-side (DELETE old links, INSERT new) inside a single
transaction. Pros vs add/remove:
- Atomic — no half-applied state if the renderer crashes mid-edit
- One round trip per edit, not N
- Renderer doesn't need to track which tags are "new vs existing"
- No race conditions between concurrent tag edits on the same asset

Con: sends slightly more data per edit. Negligible at our scale.

**Case-insensitive tags via COLLATE NOCASE**

`tags.name` uses `UNIQUE COLLATE NOCASE`, so "B-Roll" and "b-roll" are
the same tag. `INSERT OR IGNORE` preserves the original casing of the
existing row when a duplicate comes in — display reads naturally.
Filter matching also uses `COLLATE NOCASE` in WHERE clauses.

**Search: LIKE not FTS5**

For <10k assets, `LOWER(title) LIKE '%query%'` is plenty fast and
~5 LOC. FTS5 would give us ranked relevance and faster fuzzy match
but requires triggers to keep the virtual table synced with `assets`
+ `asset_tags`. Document as an upgrade path; revisit if perf becomes
visible. Not worth 50 LOC of trigger setup for a feature that doesn't
yet have its own bottleneck.

**Library event: `library:changed` from Rust**

Replaced the 3s polling on the dev view with a Tauri event emitted
from `library_insert` / `library_delete` / `tag_set_for_asset`.
Renderer subscribes once on mount, calls refresh on each event.
Cleaner than polling, scales to any update frequency, sets the
pattern for other view-on-data-change UIs (browser extension,
sibling AI assistant, etc.).

**DB location**

`~/Media Hub/library.db` — sits alongside `~/Media Hub/Downloads/`,
matches the planned dual-root structure from chiral-network days.
WAL journal mode + 5s busy timeout + foreign_keys=on. CASCADE on
asset_tags means deleting an asset auto-cleans its tag links.

---

## 2026-05-19 — Library vs Projects: dual-root structure

**Confirmed pattern:** Two top-level roots, same internal organization.

```
~/Media Hub/
├── Library/                  ← reusable, lives forever
│   └── <Platform>/<Channel>/<YYYY-MM>/...
└── Projects/
    └── <project-name>/       ← scoped, deletable as a unit
        ├── <Platform>/<Channel>/<YYYY-MM>/...
        └── project.json      ← name, created, status, notes
```

**Active project is sticky** — 90% of download sessions are
project-focused. Top-bar "Active Project" picker stays visible.
Library is the explicit one-click exception, not the default.

**Killer interactions** (must ship by 0.6):
- Right-click in Project → "Promote to Library" (file moves, project
  keeps a reference pointer with "in Library" indicator)
- Right-click in Library → "Copy to Project: <name>" (project gets
  its own working copy)
- "Finish Project" → dialog: list assets, tick any to promote to
  Library first, then move project folder to **OS Trash** (recoverable
  via Explorer/Finder — standard safety net)

**Why dual-root over project-as-tag:** `rm -rf` on a folder is
concrete, auditable, and matches mental model. Tag-based "delete all
clips tagged Project-X" is scary and easy to get wrong. Also makes
on-disk layout self-explanatory if someone pokes around in Explorer.

---

## 2026-05-19 — Duplicate / re-download handling

Two-tier detection on download attempt:

| Match condition | Behavior |
|-----------------|----------|
| URL + segment (in/out) match exactly | Inline warning: "Already downloaded on <date>. [Open file] [Force re-download as _v2]" |
| URL matches but filesize OR duration differs (re-upload, higher quality re-fetch) | Keep both. New file gets `_reup_<YYYY-MM-DD>` suffix. Metadata notes "previous version: <date>, <size>" |
| URL match, same filesize + duration | Treat as duplicate (same as row 1) |

**Why keep both for re-uploads:** Re-uploads are sometimes worse
(compressed) and sometimes better (remastered). Don't auto-replace —
let user pick which to trash later.

---

## 2026-05-19 — Browser extension architecture (when we build it)

**Decision:** HTTP server in the app + per-install token in a header.
NOT browser native messaging.

**Why:** Native messaging requires per-browser per-OS manifest
registration (painful on Mac). Local HTTP works on any browser
(Chrome/Brave/Firefox/Edge) with zero per-browser plumbing. Security
mitigated by a token stored in app settings + extension prefs.

**Forward-compat decision for 0.4:** The queue API should accept
HTTP POSTs (with token), not just in-app `invoke()` calls. That's
the only early decision we need to keep the extension path open.

**Scope when built (probably 0.7+ polish, possibly skipped entirely):**
- Right-click on a video page → "Send to Media Hub"
- Optional: read player current time, send as suggested In timestamp
  (per-platform DOM hook, YT and Twitter players differ)
- Send goes to active project by default; modifier key sends to Library

**Possibly not even necessary:** A "open in app" button via custom URL
protocol (`mediahub://download?url=...`) might cover 80% of the use
case without an extension. Decide closer to the milestone.

---

## 2026-05-20 — Transcript-to-markers assistant (sibling app sketch)

Owner refined the AI search idea after seeing media-hub in action.
Decision: build it as a **separate app**, not part of media-hub. Reasons:
different problem domain (LLM orchestration vs media tooling), different
release cadence (LLM APIs change monthly), different user paradigm
(transcript→marker review vs URL→download). They share exactly one
interface: an HTTP POST to media-hub's batch queue.

### Concrete flow

```
[ Sibling app — name TBD, possibly "transcript-mate" or similar ]
   ↓
Paste transcript (optionally + timeline markers from Resolve)
   ↓
LLM call (Claude Sonnet 4.6 or Haiku) with structured output schema:
   markers[]: { timestamp, category, brief, search_queries[], references[]? }
   - category: "animation" | "broll" | "roadmap_visual"
   - search_queries: 2-3 phrasings to feed downstream search
   - references (v2 only): Pinterest / image-search results
   ↓
Review UI: edit, delete, regenerate any marker. User's editorial
judgment is the QC gate — LLM produces a draft, editor makes it right.
   ↓
"Send to Media Hub" button
   ↓
HTTP POST to localhost:<port> on media-hub (the same endpoint we'll
build for the planned browser extension — one endpoint, two clients)
   ↓
Media-hub's batch queue picks up the URLs and downloads them
```

### Cost reality check (2026-05-20 figures)

- **LLM marker generation**: Claude Sonnet at typical transcript sizes
  ≈ $0.02-0.05 per video. Haiku is ~5× cheaper. $50/mo = thousands of
  videos. Dirt cheap.
- **Visual references (v2)**: this is the budget eater. Pinterest's
  public API is gone; scraping is fragile + ToS-questionable. Real
  options are SerpAPI / Bing Image Search ≈ $50/mo for 5k searches.
- **Realistic monthly spend for daily use**: $20-40 LLM + $30-50
  images = ~$80/mo total. Within the "$50 already worth it" budget
  if user mostly cares about text markers and uses image refs sparingly.

### Realistic v1 scope (ship-first ordering)

1. **Transcript → text markers**, no images yet. Marker = category +
   timestamp + search queries. User reviews/edits.
2. **Media-hub HTTP endpoint** for receiving queued URLs. Single
   POST handler in Rust, ~50 LOC. Builds on the existing queue
   architecture.
3. **Visual references** (v2): wire Pinterest / image-search APIs
   into the marker objects, render thumbnails in the review UI.
4. **Style guide prompting** (v3): user maintains a personal prompt
   prefix (aesthetic, channel patterns, past usage) that gets fed
   into every marker generation. This is where personal AI tools
   pull ahead of generic ChatGPT.

### Architectural notes (for future-us starting the sibling project)

- Stack: probably Tauri + React again (matches media-hub muscle memory
  and the design tokens), OR plain web app since no filesystem access
  needed. Web app is faster to ship.
- Repo: fresh, separate from media-hub. Own docs/ folder, own
  ROADMAP, own NOTES. Mirrors the same discipline.
- Integration: media-hub gets an HTTP server on localhost (token-
  protected, see "Browser extension architecture" section above for
  the same design). The sibling app POSTs `{ urls: string[], project?: string }`
  and media-hub appends to its batch queue.
- LLM client: use the official Anthropic SDK directly. Structured
  output via tool use / response_format. No middleware needed for
  this scale.

### The honest catch worth telling future-us

LLM marker suggestions are useful but not magic. First few uses, the
editor will spend more time fixing the LLM's bad suggestions than
manual search would have taken. The value **compounds** with:
- A personal style-guide prompt that learns user's taste
- Iteration on the marker schema (what fields actually help)
- Integration friction reduced to zero (the POST-to-media-hub piece)

Without all three, it's just ChatGPT with extra steps. With all three,
it's a real product moat for someone who edits daily.

---

## 2026-05-19 — AI b-roll search (v1.5+ exploration)

**Brainstormed but explicitly post-1.0.** Architecturally cheap to
support; expensive to actually build well.

**What does NOT work:** "AI watches candidate videos to evaluate b-roll
fit." Even with multimodal models (Gemini 2.0, Claude vision), running
on every frame is slow + expensive. Dead end for a free personal tool.

**What DOES work — AI as query translator, not video judge:**

```
INPUT:   transcript + timeline markers
         ("0:30 — glaciers melting", "1:15 — protesters marching")
   ↓
AI:      generates editorial search queries
         ("glaciers calving aerial drone", "ice timelapse 4K",
          "climate protest crowd march", ...)
   ↓
SEARCH:  hit YouTube + Pexels + Pixabay APIs in parallel
   ↓
UI:      top 5-10 candidates per marker, thumbnails + metadata
   ↓
USER:    previews, marks In/Out, downloads to active project
```

**Why Pexels + Pixabay matter here:**
- Free APIs with editorially-tagged stock footage
- License is clear (free for commercial use, attribution optional)
- Content is *meant* to be reused — fits "generic b-roll of X" much
  better than YouTube which is variable quality/licensing
- Add them as `Platform` trait impls; the 0.8 abstraction handles it
  with no special-casing

**Constraints to be honest about:**
- Needs user's own AI API key (BYO — Claude/OpenAI/Gemini). We're not
  paying for everyone's queries. Document clearly.
- Pexels/Pixabay weak for *specific* content (an event, a person).
  YouTube fills that, but quality/licensing variance returns.
- True visual similarity search ("find clips that look like THIS
  still") needs CLIP-style embeddings → v3 conversation, don't even
  think about it now.

**Nothing to do now.** Platform trait + library schema already
support adding new sources. AI query layer is a top-level module
added in v1.5/v2.0. Documented here so the idea survives.

---

## 2026-05-19 — UI design adopted as v1 reference

**Source files:** `F:\CLAUDE\media-hub\design-reference\media-hub\project\`
(JSX components for Download, Library, Project, Detail screens + shared
shell/nav)

**Adopting wholesale:**
- Top bar layout: brand + Active Project picker + universal search (⌘K) +
  settings icon
- Left nav with sections: Workspace (Download/Library/Projects) /
  Projects (list with counts + "+ New project ⌘N") / System (Settings)
- Nav footer: yt-dlp version + free disk space (diagnostic at a glance)
- Download screen: URL input row → metadata card with mini timeline →
  queue with filter chips (All/Active/Completed/Failed)
- Modifier-key download intent: `⌘ ⏎` = active project, `⌘ ⇧ ⏎` = Library
- Queue row layout: thumb · title · progress · destination · ETA · size · actions
- Status pills: live / queued / ok / err (with ↻ for failed → retry action)
- Detail screen (page 4 — the keeper): left filmstrip (related clips) /
  center player + chapters + your-markers / right inspector with
  File/Source/Tags/Notes sections
- Markers system (M to add) — perfect fit for our multi-segment download
- Chapters auto-imported from yt-dlp source metadata (free, no extra work)
- Keyboard shortcuts surfaced on every actionable element

**Dropping (per author feedback 2026-05-19):**
- ★ HERO amber tag (chiral-network "final version" UI leak; if "featured"
  is useful later, just use a regular tag named `featured`)

**Build-time discipline reminders:**
- Every label/button gets max-width + ellipsis (text-overflow issues
  were visible in the draft when grids got cramped)
- Active state styles (the nav-item highlight, button focus rings) need
  to actually feel responsive — chiral's keyboard-driven feel is the bar

**Design tokens (extracted from CSS for reuse):**
- Mono font for timestamps, paths, sizes, keys (`var(--mono)`)
- Tag color variants: `dot y` (yellow), `dot p` (purple), `dot g` (green),
  `dot r` (red), `dot t` (teal) — small colored dot prefix
- Background hierarchy: `bg-0` (deepest) → `bg-1` → `bg-2` → `bg-3` (raised)
- Text hierarchy: `text-0` (primary) → `text-3` (faint)
- Accent color used for In/Out markers, focus rings, primary buttons

---

## 2026-05-20 — Download progress on Windows: the buffering rabbit hole

Burned a session figuring out why streaming download progress didn't
work on Windows. Documenting the dead ends and the eventual fix so we
don't re-derive this when polishing the UI.

### The problem

We wanted yt-dlp progress events flowing to the UI in real time.
Naïve approach: `tauri-plugin-shell .spawn()` yt-dlp, parse the
`--progress-template` lines from stdout, emit Tauri events.

What actually happened: **stdout from yt-dlp arrived in one giant burst
at process exit**, not incrementally. The progress bar sat at "starting…
0 B" the entire download, then jumped straight to "done."

### Dead ends (each took 10–30 min to rule out)

1. **Switched `%(progress)j` JSON template → positional fields with `s`
   formatter.** No help. yt-dlp emitted nothing at all to stdout
   during the download regardless of template.
2. **Set `PYTHONUNBUFFERED=1` via `.env()` on the command.** Should
   force Python to unbuffer stdout. Doesn't work for PyInstaller
   bundles in practice — the bundled Python ignores it or sets it
   too late in startup.
3. **`--newline` flag** — already passed, makes no difference for the
   non-TTY pipe case.
4. **Watched `.part` files in the dest dir for size changes.** This
   was the breakthrough idea — bypass stdout entirely, get progress
   from the filesystem. *Almost* worked, but…

### The actual Windows-specific gotcha

On Windows, when a process is buffered-writing to a file,
**`std::fs::metadata(path).len()` returns the cached size from the MFT**,
which doesn't update until the file is closed/flushed. So during a
download:
- The `.part` file exists
- Data IS being written to disk (cluster contents update)
- But `metadata().len()` returns 0 the entire time, then jumps to
  the final size at process exit

This isn't a Tauri bug, a Python bug, or a yt-dlp bug. It's NTFS +
buffered I/O working as designed.

### The fix

Open the file and seek to end. The seek operation forces Windows to
report the *actual* current byte position, not the cached attribute:

```rust
fn live_file_size(path: &Path) -> Option<u64> {
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom};
    let mut f = OpenOptions::new().read(true).open(path).ok()?;
    f.seek(SeekFrom::End(0)).ok()
}
```

Concurrent read is allowed because Python opens its writes with
`FILE_SHARE_READ` on Windows by default.

Combined with `--concurrent-fragments 1` (so writes are sequential and
we see discrete checkpoints rather than one parallel burst), this
gives accurate live progress polled every 500ms.

### Implications for future work

- **ETA + speed are bursty** with this approach. Each 500ms poll
  produces a delta; yt-dlp's actual write pattern is bursty (network
  chunks land in clumps), so speed can swing from 0 → 200 MB/s → 0
  between adjacent polls. Smoothing: a 3-tick rolling average would
  calm this down a lot. Worth doing when we polish the UI but not
  blocking.
- **Percent is capped at 99.9%** during the download phase by design
  — when the file is being merged by ffmpeg, the polled total briefly
  exceeds the hint. Capping prevents the bar from showing 105%.
- **For composed specs, the bar dips between streams.** Video stream
  completes (90%+), gets renamed/moved, audio stream starts (small,
  rises fast). Acceptable for v1. Stream-aware progress (showing
  "video 1/2" and "audio 2/2" as separate phases) is a polish item.
- **For batch downloads (0.4), need per-file polling tasks**, each
  scoped to its own job. The current StopPolling drop guard pattern
  generalizes — just spawn one per active job.

### What we tried that didn't work, for future reference

- `%(progress)j` template — yt-dlp's JSON formatter may be unreliable
  for the full `progress` dict; positional `%(.field)s` works for
  individual fields but doesn't help when stdout itself is buffered
- `PYTHONUNBUFFERED=1` env var — doesn't override PyInstaller bundles
- `--newline` flag — only affects \r vs \n line endings, doesn't
  unbuffer
- ConPTY (pseudo-terminal allocation) — would solve the buffering by
  giving yt-dlp a fake TTY, but it's a Windows-specific dependency
  with version quirks across Win10/11. **Not worth it now that the
  filesystem polling works**, but documented here for completeness.

---

## 2026-05-20 — YouTube format selection gotcha

For any YouTube video above ~360p, video and audio are served as
**separate streams**. yt-dlp lists them as separate format rows: video
rows show `acodec: none`, audio rows show `vcodec: none`.

If the user picks a 1080p row directly, they get a video-only file
(no sound). That's the correct yt-dlp behavior, but bad UX as a default.

**Resolution (proper format picker, probably 0.2 final or 0.3):**
Default selection logic should map a user pick to a yt-dlp format spec:
- User clicks a video-only row at NNNNp → translate to
  `<id>+bestaudio/best` so yt-dlp grabs that video stream + the best
  audio stream + muxes them together via ffmpeg (we already ship it).
- User clicks a pre-muxed row (both codecs present) → use the id as-is.
- User clicks an audio-only row → use the id as-is (audio-only download).

This is a 1-line yt-dlp arg change but a real UX decision (do we
auto-promote video-only to video+audio silently? show a hint?). Worth
a quick decision when we build the proper picker.

**MVD workaround:** user picks format `18` (MP4 360p w/ audio) or
similar pre-muxed row for tests.

---

## Parking lot (categorized by target milestone)

When a parking-lot item gets picked up, it earns its own dated NOTES
section above. When milestones converge, the corresponding ROADMAP
section absorbs the item. New uncategorized ideas → add to **? open**
and we'll triage next pass.

### Target 0.8 — all shipped ✅

- ✅ Auto-rename rule presets (4 built-in + freeform) — 0.8.C
- ✅ Bandwidth throttle via `--limit-rate` — 0.8.C
- ✅ Per-platform sticky format memory — 0.8.C

### Target 0.9 (health checkup)

Promoted from "? open" — items worth touching during the 0.9 sweep:

- **Library-root change footgun (HIGH PRIORITY)** — 2026-05-22.
  Today the `library_root` override applies forward only. Existing
  `assets.file_path` rows still point at the OLD location, and
  `library.db` itself ALWAYS stays at `~/Media Hub/library.db`
  regardless of the override. If a user sets a new root and then
  deletes the old `~/Media Hub/` folder:
    - they wipe `library.db` → entire library history gone
    - they wipe existing files → every old asset's Reveal/Open breaks
  This is a real footgun shipped in 0.8.C. Three escalating fixes:
    1. **Cheap (0.9.C, ~30 min):** add a red warning in Settings →
       Library when `library_root` is changed: "Old downloads stay
       where they are; don't delete `~/Media Hub/` (your library
       database lives there). Use the Migrate button to move them
       safely once we ship it."
    2. **Medium (0.9.C, ~2 hrs):** add a `library_migrate_root`
       command that physically moves all `Library/` + `Projects/` +
       `_thumbnails/` content to the new root AND rewrites every
       `assets.file_path` row to point at the new location. DB
       stays put. Reveal/Open keeps working.
    3. **Big (1.2 multi-root):** the Steam-style multi-root model
       supersedes this entirely — each asset knows its root id, you
       can have N roots, "Move" between them is a first-class action.
- **Scrubber sensitivity setting** — 2026-05-22. Add a Settings →
  Downloads (or new Scrubber section) field for jog/scrub sensitivity
  so users can tune how fast the scrub bar reacts to drag. Probably
  a multiplier (0.5× / 1× / 2×). Frame-step keyboard shortcuts stay
  the same — this is for mouse drag feel. ~20 min, 0.9.D UX polish.
- **"Test cookies" button** in Settings → Sources — runs a
  `yt-dlp --simulate` no-op against a known-public URL to confirm
  the configured cookies actually work. Slots into 0.9.C bug
  census. ~30 min of work.
- **cookies.txt extension link** in Settings → Sources → "From
  file" hint — small inline link to the "Get cookies.txt LOCALLY"
  extension. 5-min copy change.
- **Stale string sweep** — comb the UI for any references to old
  paths / states / behaviors that drifted as features moved. (We
  caught `Downloads/_test/` in Download.tsx tonight; there may
  be more.)
- **Empty-state polish** — does every list (library grid, queue,
  projects, sibling list) have a friendly empty state? Some do,
  some don't. Visual + copy pass.
- **Loading-state polish** — same exercise for async actions.
  Metadata fetch shows "Fetching…", but does the library
  thumbnail backfill show ANY indicator? Probably not.

### Target 1.2 (workflow polish from real usage)

- **"Mark for re-download at higher quality"** — when you grabbed a
  480p proxy and want the real thing later. Adds a button on the
  asset drawer that re-runs the download with a different format
- **Source attribution export** — generate a credits-list TXT/CSV of
  all clips used in a project, for video descriptions / due diligence
- **Color labels** — Eagle-inspired 5-color palette per asset for
  fast at-a-glance status (review / approved / hero / etc.)
- **Star rating + per-asset notes** — also Eagle-inspired

### Target 2.x (long tail)

- **Detect burned-in subtitles** and warn (some YouTube videos have
  hardcoded captions; bad for editing)
- **Export library subset as CSV** — for inventory / handoff to clients
- **Custom URL protocol handler** (`mediahub://`) — possibly subsumes
  the browser extension for the 80% case

### ? open

(empty — drop new uncategorized ideas here as they surface)

### Cut (decided no)

- Dark mode toggle — we're dark, OS-inherit, no work needed
