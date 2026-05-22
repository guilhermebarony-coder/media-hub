# Media Hub — 1.0 Plan

Written 2026-05-22, the day 0.9.0 tagged. 1.0 = "ship it to other
humans." Two pillars: (1) finish the owner-active audit slices
carried over from 0.9, (2) packaging — installer, slim ffmpeg,
README/icon/license polish, tagged release artifacts.

**Discipline rule for 1.0:** still no new features. New ideas
land in NOTES.md for 1.x. The only things that should land on
main between now and tag-1.0 are: audit follow-ups, packaging
infrastructure, polish.

**Cadence:** P → A (audit carryover) → R (release). Each lettered
slice is a natural stopping point.

---

## Phase P — Packaging (the big one)

**Goal:** producing a downloadable `.msi` / `.exe` that anyone can
install on Windows, runs without dev tooling, includes all sidecars,
shows a real icon, has a license + readme.

### P.1 — Slim ffmpeg build (~3-5 hr CI work)
ffmpeg right now is 202 MB — 85% of the install footprint. The full
build has codecs / muxers / filters we never call. A custom slim
build (only h264/h265/aac/opus encoders, mp4/webm muxers, scale +
fps + atempo filters) typically lands at ~25-40 MB.

**Plan:**
1. Decide: link to a public slim build (BtbN nightly minimal variant)
   vs. produce one ourselves via a GitHub Actions workflow that runs
   `ffmpeg-build-script` with a curated `--enable-*` list.
2. If self-built: workflow caches the build, drops the binary as an
   artifact, we pull during release.
3. Audit the actual ffmpeg invocations we make (transcode presets,
   thumbnail extract, scrubber stream resolve helper). Confirm the
   slim build supports every one.
4. Update sidecars/README documenting which build we ship.
5. Re-baseline install size in `PERF_BASELINE.md`.

**Success:** total installer < 80 MB compressed, < 120 MB installed.

### P.2 — Windows installer (~2 hr)
Tauri 2 ships a bundler. We need to configure it.

**Plan:**
1. Pick: NSIS (smaller, friendlier UX) vs MSI (corp-friendly, larger).
   Default to NSIS unless reason otherwise.
2. Set `bundle.targets`, `bundle.identifier`, `bundle.windows.*` in
   tauri.conf.json — installer language, signing config (skip for
   now — unsigned ships, owner adds cert later if desired).
3. Wire icon (P.3) and license (P.4) into bundler.
4. Verify `cargo tauri build --bundles nsis` produces working installer.
5. Install on a clean VM if available, confirm app runs end-to-end.

**Success:** double-click installer → next-next-finish → Media Hub
shortcut on Start menu → launches, library works, download works.

### P.3 — Icon polish (~1 hr)
We've been running with the default Tauri icon since day 1.

**Plan:**
1. Owner designs / picks the wordmark. The brand-mark in TopBar is
   a clean reference — formalize that as the app icon if liked.
2. Generate the full Windows icon set (.ico with 16/24/32/48/64/256
   sizes), `icon.png` for installer, taskbar icon.
3. Use Tauri's `tauri icon` CLI from a single 1024×1024 source.
4. Drop into `src-tauri/icons/`, wire in tauri.conf.json.

**Success:** taskbar / Start menu / Alt-Tab / installer all show
the real brand mark, not the default.

### P.4 — LICENSE + README + about pass (~1-2 hr)
**Plan:**
1. LICENSE file — pick. MIT or GPLv3 are the obvious candidates;
   GPLv3 is the safer default given ffmpeg + yt-dlp dependencies
   (ffmpeg LGPL/GPL split — depends on slim-build flags from P.1).
2. README — what is Media Hub, who is it for, screenshots,
   install link, credit yt-dlp + ffmpeg, link to issues.
3. Settings → About section already exists — verify links resolve,
   add license + GitHub link.
4. Onboarding wording sweep — anything that says "0.9 / Phase X" cleaned up.

### P.5 — Release artifact + tag (~30 min)
**Plan:**
1. GitHub release workflow: on tag `v1.0.0` push, run `cargo tauri
   build`, attach installer artifacts to the release.
2. Tag `v1.0.0`, push, verify the workflow produces a clean download.

**Phase P estimated session count:** 3-4
**Owner involvement:** P.1 codec audit decisions, P.3 icon design,
P.4 license pick. ~30-45 min total of synchronous input.

---

## Phase A — Audit carryover from 0.9

These are owner-active or owner-verify slices that didn't ship
inside 0.9 because they take real time / multiple evenings. They
weren't blocking 0.9 tag — soak data and render audits are about
confidence in long-term health, not about shipping correctness.

Land them as 1.0.x patches whenever the owner has the evening for them.

### A.1 — React render audit (was 0.9 A.4)
Owner-active ~30 min. React DevTools, "Highlight updates", screenshot
over-rendering, I add `React.memo` / fix dependency arrays after.

### A.2 — Synthesized library scale test (was 0.9 A.6)
Owner-free ~30 min. Seed 100/500/1k/5k assets, measure
library_list + first render, decide on react-window threshold.

### A.3 — Overnight soak test (was 0.9 B.1)
Owner-active "one evening of doing nothing." Snapshot at launch,
30 min, 2 hr, 6 hr, overnight. Looking for any leak > 50% growth.

### A.4 — Library-root migration command (was 0.9 C.6, HIGH PRIO)
Owner-free + verify. The footgun: today there's no way to move
your library to a new drive without manually editing the DB. This
needs to ship before 1.0 if anyone other than the owner uses the app.

Adds Settings → Library → "Move library to…" button. Atomic
transaction over filesystem + DB.

### A.5 — Empty + loading state screenshots (was 0.9 D.1/D.2)
Owner-active ~15 min screenshot session. Identifies any bare empty
state ("nothing here yet" missing) or any async action that doesn't
show progress.

### A.6 — Scrubber sensitivity verify (was 0.9 D.6)
Owner-active ~5 min. Slider shipped in 0.9; confirm feel across the
0.25× / 1× / 2× range matches expectation.

### A.7 — Tab order + contrast (was 0.9 E.1/E.3)
Owner-active ~15 min. Tab through each page, screenshot anywhere
focus jumps weirdly. Spot anything too dim to read.

**Phase A estimated sessions:** 2-3 over multiple evenings
**Phase A commits:** 4-8

---

## Phase R — Release readiness checks

The last-mile QA pass before tagging 1.0.

### R.1 — Clean-install smoke test
Owner-active. Install the produced installer on a clean Windows
account (or VM if available). Run through:
1. First launch → onboarding
2. Add one library root
3. Download one video (regular)
4. Download one cookies-gated video (have a Firefox profile ready)
5. Apply a transcode
6. Scrub one asset
7. Tag, search, project, finish project
8. Settings → reset section
9. Restart app, verify everything persisted

Anything that requires editor-level technical knowledge to recover
from is a bug. Note them, fix them.

### R.2 — Edge case URLs (was 0.9 C.3)
Owner-active. Try: private video, deleted video, geo-blocked video,
livestream, Shorts, playlist, YouTube Music. Share raw errors. I
extend the error translator.

### R.3 — "Test cookies" button (was 0.9 C.5)
Owner-free + verify. Settings → Sources gets a "Test" button that
runs `yt-dlp -j --simulate` against a known public + age-restricted
URL, reports both results clearly.

### R.4 — Final commit log review
Sweep `git log v0.9.0..HEAD` looking for half-finished work,
TODO comments worth resolving, dead code introduced during audit.

---

## What's explicitly NOT in 1.0

Documented so we don't drift:

- **Audio-only / MP3 download** — feature, parked for 1.x
- **Better library filters** (sort by name/size/duration) — feature, parked
- **Multi-root library / per-project external root** — feature, parked 1.2
- **URL protocol handler (mediahub://)** — feature, parked 1.0+
- **Linux / macOS builds** — Windows-first, others when there's demand
- **Code signing certificate** — corp-only concern, defer
- **Auto-updater** — defer until user count justifies infra

---

## Estimated path to 1.0 tag

| Phase | Sessions | Commits | Owner-active time |
|-------|----------|---------|-------------------|
| P packaging | 3-4 | 6-10 | 30-45 min |
| A audit carry | 2-3 | 4-8 | 1-1.5 hr |
| R release | 1-2 | 2-4 | 1-2 hr (clean install) |
| **Total** | **6-9 sessions** | **12-22 commits** | ~3-4 hr |

Realistic ETA: a few weekends of focused work, or several weeks
of evening passes. The audit carryover can happen in parallel with
packaging — they don't conflict.

---

## "Where you should check" — owner checklist

### A.1 — Render audit
React DevTools → Components → Highlight updates. Click around
Library, screenshot anything that shouldn't be highlighting.

### A.3 — Soak test
Launch app, snapshot RAM. Leave open overnight on Library page.
Snapshot next morning. Drop numbers in `docs/SOAK_TEST_LOG.md`.
Within ±10% = clean.

### A.4 — Library root migration verify
When I ship the button, test on a *copy* of your library.db first.

### A.6 — Scrubber sensitivity verify
Drag the new slider in Settings → Downloads across 0.25 / 1 / 2.5.
Confirm it feels right. The 1.0× should match today's behavior exactly.

### R.1 — Clean install smoke
When the first installer drops, install on a clean Windows account
or a fresh VM, walk through the 9-step list above.

### R.2 — Edge URLs
During real use, when something fails: paste the URL + the raw
error here. I extend the translator.

### P.3 — Icon design
The brand-mark on TopBar (the lime square) is your reference. Want
to formalize that? Or design something new? Need a 1024×1024 source.
