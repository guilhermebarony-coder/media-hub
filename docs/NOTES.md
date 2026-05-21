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

## 2026-05-21 (parked) — Command palette (Ctrl+Space)

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

## 2026-05-21 (parked) — Eagle integration / inspiration

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

## 2026-05-21 (parked) — File management vision

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

## 2026-05-21 (parked) — Age-restricted YouTube videos / cookies

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

## 2026-05-21 (parked) — Ctrl+Space "send to Library" shortcut

**Owner request (2026-05-20):** when an active project is set,
default routing should send new downloads to that project, BUT a
keyboard shortcut like Ctrl+Space should re-route the click to
Library instead. The reasoning: mid-project sometimes you grab a
piece of B-roll / a background clip that doesn't belong to the
current project — without a shortcut you'd have to switch project,
download, switch back. The handoff design has a `⌘⇧V` modifier on
the Download button for this.

**When to build:** Phase B (file routing). The shortcut is
meaningless without actual routing — tonight everything still lands
in `Downloads/_test/`. Once Phase B lands, the implementation is:
- Add a `targetScope?: LibraryScope` parameter to recordInLibrary
- Wire a `useEffect` on the Download button that listens for
  `keydown` with `code === "Space"` and `ctrlKey`, sets a transient
  state "next click → Library"
- Visual feedback: button label changes to "Download to Library"
  while the modifier is held (matches handoff design)
- Same for the Queue Card's "Queue all" — Ctrl+Space → queue into
  Library regardless of active scope

**Alternative:** could be a UI toggle next to the button instead of
a keyboard-only modifier. Two clicks is still fewer than switch +
download + switch-back. Decide when we build.

---

## 2026-05-20 (parked) — Library folders (in addition to tags)

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

## 2026-05-20 (parked) — Download page header copy reads weird

**The page-header subtitle "paste · pick · trim · transcode"** sits
next to the "Download" title and reads more like a stage indicator
than a useful label. Owner: "this words seem weird, either we change
or remove, can decide when we change the UI tho."

**Decision:** parked. Revisit when we do the Download page redesign
(handoff `screen-download.jsx` layout) — that pass will rework the
content-header anyway, so changing the copy in isolation now is
wasted churn.

**Candidate replacements to consider:**
- Remove entirely (let the page title carry it)
- Replace with active-state info ("Queue: 3 active · 1 done")
- Replace with destination ("Saving to: Library" / active project)

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

## Parking lot (uncategorized ideas, drop in here as they surface)

- Bandwidth throttle in settings (single global limit, applies across queue)
- Per-platform format-preset memory (last format chosen for YouTube stays sticky)
- Auto-rename rule presets (a few common patterns shipped, not just
  freeform tokens)
- "Mark for re-download at higher quality" — when you grabbed a 480p
  proxy and want the real thing later
- Dark mode (just inherit from OS; no separate light/dark toggle)
- Export library subset as CSV (for inventory / handoff to clients)
- Detect when a downloaded video has burned-in subtitles and warn
  (some YouTube videos have hardcoded captions; bad for editing)
- "Source attribution" export — generate a credits-list TXT/CSV of
  all clips used in a project, for video descriptions / due diligence
- Custom URL protocol handler (`mediahub://`) — possibly subsumes
  browser extension for the 80% case
