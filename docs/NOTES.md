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
