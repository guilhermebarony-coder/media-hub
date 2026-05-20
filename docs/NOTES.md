# Media Hub — Working Notes

Status: living doc, dev0 (2026-05-19). This is the parking lot for
ideas, gotchas, and things-to-remember that don't belong in ROADMAP
(too speculative or too small) or ARCHITECTURE (not a structural
decision).

Format: dated sections, newest at top. Each entry self-contained —
written so future-me (or future-Claude) can pick it up cold.

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

## 2026-05-19 — Segment download mechanics (the honest version)

`yt-dlp --download-sections "*<in>-<out>"` does NOT always mean
"download only those bytes." There are two regimes:

**Regime A — true byte-range fetch:** Works when:
- The format is a fragmented MP4/WebM with random-access fragments
- The CDN honors HTTP Range requests
- yt-dlp has `--hls-use-mpegts` or similar where needed
For most modern YouTube MP4 formats, this works.

**Regime B — full download + ffmpeg trim:** Falls back when:
- The format is a single monolithic file (some live-stream archives)
- Range requests are blocked by the CDN
- yt-dlp internally chooses this path with no easy override

**How we surface this to the user:** Per-job log line + UI indicator
"(full download + trim)" so the user knows when they're paying full
bandwidth. Don't lie to the user about what the network is doing.

**`--force-keyframes-at-cuts` warning:** This flag makes cuts
frame-accurate by re-encoding around cut points. It defeats the
"no bloat" win because re-encode is slow and CPU-heavy. Default OFF.
Add as an opt-in "frame-accurate trim" toggle in settings if anyone
asks; tell them it's slow.

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
