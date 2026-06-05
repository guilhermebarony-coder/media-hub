# Media Hub — 0.9 Health Checkup Plan

> **STATUS: 0.9.0 TAGGED — 2026-05-22 PM.**
> What shipped landed. Remaining owner-active audit slices
> (A.4 render, A.6 scale, B.1 soak, C.6 root migration, D.1/D.2/D.6,
> E.1/E.3) carried forward into `1_0_PLAN.md`. This doc is the
> historical record of what 0.9 did. Don't add new work here.

Written 2026-05-22, updated as slices land. The full A→E breakdown
of what 0.9 covers, what needs owner involvement vs what can be
done solo, expected effort per slice, and success criteria.

**Status at a glance (2026-05-22 PM):**
- ✅ A.1 baseline · ✅ A.2 SQL indexes · 🟡 A.3 partial · ✅ A.5 code-split
- ✅ B.2 listener leak hook
- ✅ C.7 stale-string sweep
- ✅ D.5 dead indexes dropped · ✅ D.7 Firefox-default onboarding
- All remaining solo + owner-active slices below.

**Discipline rule for 0.9:** no new features. Any new idea that
surfaces during the audit lands in NOTES.md for 1.x. We're
hardening what exists, not extending it.

**Cadence:** A → B → C → D → E in order. Each phase ships its
own commits. Between phases is a natural stopping point.

---

## Phase A — Performance audit

**Goal:** measurable improvements to time-to-interactive, render
performance, and query latency. Establish numerical "before" so
later phases can prove regressions don't happen.

### A.1 — Bundle + binary baseline ✅ (shipped 2026-05-22)
- Captured in `PERF_BASELINE.md`
- Findings: 1.2 MB dist/, 15.74 MB Rust binary, ffmpeg = 85% of install

### A.2 — SQL query plan analysis ✅ (shipped 2026-05-22)
- Found missing `idx_assets_source_url` (3 hot queries depended on it)
- Migration 005 added the index
- Flagged 2 dead indexes for 0.9.D drop

### A.3 — Owner RAM snapshot 🟢 done (2026-05-22)
- Rust host (media-hub.exe): 6.2 MB private idle, +0.2 MB after actions
- WebView2 children total: 121 MB idle, 155 MB during downloads, 192 MB peak (scrubber+GPU)
- 18 KB per library asset (linear)
- One follow-up flagged in B.2: verify GPU process returns to baseline after leaving Download page

### A.3 — Owner stopwatch startup ✅ done (2026-05-22 lunch)
- **Median: < 1 second (couldn't reliably stopwatch — too fast).**
- Vite dev server: ready in 207ms per CLI output.
- Cold start barely measurable. Excellent.
- First-launch-after-changes takes a moment longer (compile),
  but that's the dev compile cost not the app startup.

### B.5 — Settings save spam ✅ done (2026-05-22 lunch)
- Slider spammed 30s — no flicker, no issues. Race fix from 0.8.D holds.

### B.4 — Queue stress ✅ done (2026-05-22 lunch)
- 20 short downloads × 3 cycles — RAM steady, no issues.

### B.3 — Drawer stress 🟡 partial signal (2026-05-22 lunch)
- Total memory spiked to **240 MB** during repeated open/close
  cycles. Settled back to **175 MB** when activity stopped.
- The growing child was **"WebView2: Tauri + React + Typescript"**
  (not the GPU process this time — the React renderer itself).
- Maximum observed: 240 MB. Memory DID release when activity stopped.
- **Verdict:** classic React allocation churn from rapid drawer
  mount/unmount cycles. Garbage collected on idle. Not a leak.
  But worth checking that the AssetDrawer's heavy children (Tags
  editor, siblings list, drawer state) properly tear down. Park
  for B.2 deeper-audit follow-up.
**What you do (~10 min):**
1. Close all media-hub processes (Task Manager → end any leftover)
2. Launch via `npm run tauri dev`, time click→window-visible
3. Repeat 2 more times, take median
4. Open Task Manager → Details tab. Find `media-hub.exe` + `msedgewebview2.exe`. Note RAM.
5. Click through Library / Download / Projects / Settings. Snapshot RAM again.
6. Drop one download. Snapshot.
7. Fill in the empty tables in `PERF_BASELINE.md`

**No code changes — pure measurement.** Output: complete baseline numbers.

### A.4 — React render audit 🟡 needs owner
**What you do (~30 min):**
1. Open DevTools → Components tab (React DevTools extension)
2. Enable "Highlight updates when components render"
3. Click around the Library page, toggle tag filters, search, open drawer
4. Note which components highlight when they shouldn't
5. Screenshot anything obviously over-rendering

**What I do after (~45 min):**
1. Add `React.memo` to AssetCard
2. Stabilize useCallback dependencies if any are recreating per render
3. Check that `library:changed` doesn't cascade unnecessarily
4. Re-test by your screenshots
5. Commit with measurements

### A.5 — Code-splitting 🟢 done (2026-05-22)
- Initial JS chunk: 98.58 kB gz → 78.30 kB gz (-20.6%)
- 4 page routes + Onboarding modal now in separate chunks
- Loads on navigation, fallback "loading…" rarely flashes
- Skipped block (replaced by status above):
**What I do (~30 min):**
1. `React.lazy()` each page route in `App.tsx`
2. `React.lazy()` the Onboarding modal
3. `React.lazy()` the Scrubber
4. Re-build, measure new bundle sizes
5. Update PERF_BASELINE.md with "after" numbers
6. Verify all routes still load correctly

**Success:** initial chunk < 150 kB gzipped (down from 322 kB raw / 98 kB gz).
Per-route chunks load on navigation.

### A.6 — Synthesized library scale test (owner-free)
**What I do (~30 min):**
1. Add a debug-only "seed N fake assets" Rust command (gated behind cfg or env var)
2. Run with N = 100, 500, 1000, 5000
3. Time library_list query + first render
4. Identify whether react-window virtualization is needed
5. Document threshold in PERF_BASELINE.md

**Success:** library_list responds < 50ms at N=1000. Render time < 100ms
on first paint. Decide virtualization yes/no based on data.

**Phase A estimated session count:** 2 sessions
**Phase A estimated commits:** 4-6

---

## Phase B — Memory + leak hunting

**Goal:** confirm long-running idle sessions don't grow RAM,
event listeners get cleaned up, no resource handles leak.

### B.1 — Soak test baseline 🟡 needs owner
**What you do (one evening):**
1. Launch the app, snapshot RAM (both processes)
2. Leave it open, idle on Library page
3. Snapshot at 30 min, 2 hr, 6 hr, overnight
4. Drop numbers into a new `docs/SOAK_TEST_LOG.md`

**Success criteria:** RAM at 6 hours ≈ RAM at 30 min (±10%). If it grew >50%,
we have a leak and need to hunt.

### B.2 — Listener leak audit 🟢 done (2026-05-22)
- Found real race in every listen() useEffect: if unmount before .then() resolved, listener orphaned
- Worst-case site: Library asset drawer (remounts per asset click)
- Fixed via new src/lib/useTauriEvent.ts hook + inline race-safe pattern where the hook didn't fit
- Applied to Library page, Projects page, ActiveProjectProvider, Library drawer

### B.2 — _(original block, kept for reference)_
**What I do (~45 min):**
1. Grep every `listen(` call. Each MUST have a matching `unlisten?.()` in cleanup.
2. Check all useEffect hooks return cleanup functions when they listen
3. Check Scrubber component — multiple listeners (keyboard, video events, polling)
4. Check QueueCard — progress event listeners
5. Document any leaks found, fix, commit

### B.3 — Drawer open/close stress test 🟡 needs owner
**What you do (~5 min):**
1. Open Library, click any card to open the drawer
2. Press Escape to close. Repeat 50 times rapid-fire
3. Check RAM didn't climb. Check no console errors

**What I do if it fails:** investigate drawer lifecycle, fix.

### B.4 — Queue stress test 🟡 needs owner
**What you do (~15 min):**
1. Queue 20 batch downloads (any short videos)
2. Let them all complete
3. Click "Clear completed"
4. Snapshot RAM
5. Repeat the cycle 3 times
6. Final RAM snapshot

**Success criteria:** RAM after 3 cycles ≈ RAM before first cycle.

### B.5 — Settings save spam test 🟡 needs owner
**What you do (~3 min):**
1. Open Settings → Downloads → drag the slider rapidly back and forth for 30 seconds
2. Watch the dev console for [cookies] log spam (we should NOT see one per drag tick)
3. Confirm the slider settles at the last value, no flicker

**What this catches:** any regression on the 0.8.D race fix.

**Phase B estimated session count:** 1-2 sessions
**Phase B estimated commits:** 2-4

---

## Phase C — Bug census

**Goal:** sweep methodically through every feature looking for
"what could break this" cases. Target zero known bugs at 1.0.

### C.1 — Race condition audit (owner-free)
**What I do (~1 hr):**
1. Walk the queue worker code — can two workers grab the same job?
2. Walk the Settings save → listen → save chain
3. Walk the library:changed event consumers
4. Walk the scrubber's frame-step + play/pause interaction
5. Document anything fragile + fix obvious ones

### C.2 — Filesystem edge cases (owner-free + light owner verify)
**What I do:**
- Long paths (Windows MAX_PATH 260 char limit)
- Non-ASCII characters in titles / channels / paths (we just hit this with cookies)
- Filenames hitting Windows reserved names (PRN, CON, AUX, NUL, COM1..9, LPT1..9)
- Disk-full simulation
- File-locked-by-another-process simulation
- Sanitize where needed

### C.3 — yt-dlp error variations (collaborative)
**What I do:** review the error translator, add missing patterns
**What you do:** try edge-case URLs (private, deleted, geo-blocked, livestream) and share the raw errors

### C.4 — ffmpeg failure modes (owner-free)
**What I do:** invalid input simulation, codec mismatch, partial reads, ensure cleanup on failure

### C.5 — "Test cookies" button 🟡 needs owner verify
**What I do:** Add a Settings → Sources button that runs `yt-dlp -j --simulate` against a known public + age-restricted reference, reports both results
**What you do:** test with your various cookie configs

### C.6 — Library-root migration command (HIGH PRIORITY, owner-free + verify)
**What I do (~2 hr):**
1. Add a "Migrate library to new root" button in Settings → Library
2. New Rust command moves Library/, Projects/, _thumbnails/ contents
3. Rewrites all asset file_path rows
4. DB stays put as documented
5. Atomic (transaction): all-or-nothing rollback

**What you do (~5 min):** test on a copy of your library to confirm move works without breaking Reveal/Open

### C.7 — Stale-string sweep (owner-free)
**What I do (~30 min):**
1. Grep for "Downloads/_test", hardcoded paths, old route names
2. Check all hint text in Settings is current
3. Check Onboarding wording — does it still reflect what the app does?
4. Single commit with all the cleanup

**Phase C estimated session count:** 2-3 sessions
**Phase C estimated commits:** 5-8

---

## Phase D — UX polish

**Goal:** every dead-end feels like a dead-end. Every loading state
is visible. Every empty state has personality. Every error message
tells you what to do next.

### D.1 — Empty states audit 🟡 needs owner verify
**What I do:** walk through every list/grid that can be empty:
- Library page with no assets → "Paste a URL on Download to get started"
- Library filtered by tag with no matches → "No clips with tag 'X'"
- Projects page with no projects → "+ Create your first project"
- Queue with no jobs → already has placeholder ✓
- Sibling list when no siblings → don't render the section at all
- Search with no results → "No matches. Try a broader query."
- Settings → Diagnostics on tool fetch fail → friendly retry

**What you do:** screenshot any empty state that still looks bare.

### D.2 — Loading states audit 🟡 needs owner verify
**What I do:** walk through every async action:
- Metadata fetch → has "Fetching…" ✓
- Library mount → ??? probably nothing visible
- Thumbnail backfill → silent today; add an unobtrusive indicator
- Settings page → has "loading…" ✓
- Scrubber stream resolve → has its own spinner ✓
- Cookies test (when shipped) → spinner during test

**What you do:** screenshot any action where you weren't sure if it was working.

### D.3 — Error messages clarity (owner-free)
**What I do:** review every Err() return string for actionability. The yt-dlp
translator did this for the big stuff; sweep the rest.

### D.4 — Animation easing + focus states (owner-free)
**What I do:**
- Tab focus rings on every interactive element
- Drawer slide-in easing
- Modal pop-in (Onboarding has this)
- Toast notifications (if we add them — probably not in 0.9)

### D.5 — Drop dead indexes (owner-free)
**What I do:** if grep confirms `idx_assets_platform_video_id` and
`idx_assets_platform_channel` truly have no consumers, drop them in
migration 006. Saves a sliver of INSERT throughput.

### D.6 — Scrubber sensitivity setting 🟡 needs owner verify
**What I do:** add Settings → Downloads → "Scrub sensitivity" multiplier (0.5× / 1× / 2×)
**What you do:** confirm it feels right at each level

### D.7 — Firefox-by-default in onboarding (owner-free)
**What I do:** update Onboarding cookies screen wording to recommend Firefox
as the primary option, with Chromium-family in a "won't work right now" section

**Phase D estimated session count:** 2 sessions
**Phase D estimated commits:** 4-6

---

## Phase E — Accessibility + small details

**Goal:** every interaction is usable from keyboard, every icon
button has a label, color contrast hits WCAG AA.

### E.1 — Tab order audit 🟡 needs owner verify
**What I do:** add tabindex where missing, check focus order is logical per page
**What you do:** Tab through each page, screenshot any place focus jumps weirdly

### E.2 — Screen reader labels (owner-free)
**What I do:** every icon-only button gets `aria-label`. Audit the icons.tsx
consumers. Onboarding modal has proper role="dialog" + aria-modal ✓

### E.3 — Color contrast check 🟡 needs owner verify or automated tool
**What I do:** run `axe-core` or similar over the built app, document any failures
**What you do:** spot-check anything that looked low-contrast

### E.4 — Keyboard shortcut discovery (owner-free)
**What I do:** add a "?" key handler that shows a keyboard shortcut overlay. Or a small footer indicator. Discoverability for power users.

### E.5 — Tooltip pass (owner-free)
**What I do:** every icon-only button should have a `title` attribute that explains what it does on hover.

**Phase E estimated session count:** 1-2 sessions
**Phase E estimated commits:** 3-5

---

## Total estimate

| Phase | Sessions | Commits | Owner involvement |
|-------|----------|---------|-------------------|
| A perf | 2 | 4-6 | A.3 stopwatch + A.4 render |
| B leaks | 1-2 | 2-4 | B.1 soak + B.3/4/5 stress |
| C bugs | 2-3 | 5-8 | C.3 URLs + C.5 cookies + C.6 verify |
| D UX | 2 | 4-6 | D.1/2 screenshots + D.6 verify |
| E a11y | 1-2 | 3-5 | E.1 tab + E.3 contrast |
| **Total** | **8-11 sessions** | **18-29 commits** | About 1.5-2 hr owner-active time across all phases |

After 0.9.E ships, **1.0 packaging** starts. That's:
- Custom ffmpeg slim build (~3-5 hr CI workflow)
- Installer config (~2 hr)
- README/LICENSE/icon polish (~1 hr)
- Final QA + tag (~1 hr)

Realistic 1.0 ETA from here: ~12-15 sessions over a few weeks of evenings. Could be tighter if owner can dedicate full focus time, longer if interrupted.

---

## What I need from you to plan around

**No urgency on any of this** — the plan is the plan, we pace as you have energy.

If you want to maximize impact per evening, prioritize:
1. **The owner-active slices** (A.3, A.4, B.1, B.3/4/5, C.3, C.5, C.6, D.1/2, D.6, E.1, E.3). Those gate the most work for me. Batch a few in one evening when you've got 30-45 min of focus.
2. **The big payoff slices** if you want visible wins: A.5 code-splitting (startup feel), A.6 scale test (data-driven confidence), C.6 library-root migration (kills the footgun), D.1 empty states (the "feels real" pass).

Owner-free slices I can do whenever you say "go" without further input:
- ~~A.5 code-splitting~~ ✅ shipped
- A.6 synthesized scale test
- ~~B.2 listener leak audit~~ ✅ shipped
- C.1 race conditions
- C.2 filesystem edge cases
- ~~C.7 stale-string sweep~~ ✅ shipped
- D.3 error message review
- D.4 focus rings + easing
- ~~D.5 drop dead indexes~~ ✅ shipped
- ~~D.7 Firefox-by-default copy~~ ✅ shipped
- E.2 aria-labels (mostly done, ~~quick verification pass~~)
- E.4 keyboard discovery
- ~~E.5 tooltips~~ ✅ shipped (mostly already in place)

---

## "Where you should check" — owner-active checklist

Bookmark this section. Whenever you've got 10-15 min and want to
knock something out, pick from here. Each item is self-contained
and updates a specific file.

### A.3 — Startup time stopwatch
**Where:** `docs/PERF_BASELINE.md` → "Startup time" section
**What to do:**
1. Close all media-hub processes via Task Manager
2. Time click → window-visible 3 times, take median
3. Note dev build (`npm run tauri dev`) vs release build separately
4. Drop the numbers in the empty table

### A.4 — React DevTools render audit
**Where:** screenshot session, share findings here
**What to do:**
1. Install React DevTools browser extension if you don't have it
2. Open dev app (F12 → Components tab)
3. Enable "Highlight updates when components render"
4. Click around Library: toggle tag filters, search, open drawer 5×
5. Screenshot anything that highlights when it shouldn't (e.g. unrelated cards re-rendering on tag toggle)

### B.1 — Soak test (overnight)
**Where:** new `docs/SOAK_TEST_LOG.md` (create it)
**What to do:**
1. Launch app, snapshot RAM of all Media Hub processes
2. Leave the app open overnight on the Library page
3. Next morning, snapshot again
4. If RAM is within ±10% of starting → clean. If grew >50% → leak hunt time.

### B.2 follow-up — GPU process baseline check ✅ done (2026-05-22)
- Fresh launch baseline: 35.2 MB
- During scrubber active: 110.5 MB
- After multiple scrubber → nav-away cycles: **59.9 MB** (lower than
  single-cycle 67 MB — clear evidence of release, not accumulation)
- Conclusion: persistent ~25 MB is a one-time GPU decode pool
  allocation by WebView2 + Windows DXVA. Not our memory to free.
- **B.2 closed: no leak.**

### B.3 — Drawer stress test (~3 min)
**Where:** mental note + tell me what happened
**What to do:**
1. Open Library, snapshot RAM
2. Click any card → drawer opens
3. Press Escape → drawer closes
4. Repeat 50× rapid-fire (or use a number-spam tool)
5. Snapshot RAM
6. Tell me if it grew significantly or held steady

### B.4 — Queue stress test (~15 min)
**Where:** mental note
**What to do:**
1. Queue 20 short YouTube videos
2. Let them all complete
3. "Clear completed"
4. Snapshot RAM
5. Repeat the cycle 3 times
6. Compare RAM before cycle 1 vs after cycle 3

### B.5 — Settings save spam (~30 sec)
**Where:** mental note
**What to do:**
1. Open Settings → Downloads → Parallel workers slider
2. Drag rapidly back and forth for 30 seconds
3. Confirm: slider lands on final value, no flicker, no console errors
4. Watch dev terminal for `[cookies]` log spam (shouldn't fire on slider drags)

### C.3 — Edge case URLs
**Where:** share weird errors here when you find them
**What to do:** when testing in real use, share any of these that produce a weird error:
- A private video
- A deleted video
- A geo-blocked video
- A YouTube livestream (live, not VOD)
- A YouTube Shorts URL
- A playlist URL
- A YouTube Music URL

### C.5 — Test cookies button verify
**Where:** when I ship the button, you test
**What to do:** TBD — slice not yet shipped. Will gate on this when ready.

### C.6 — Library-root migration verify (HIGH PRIORITY)
**Where:** when I ship the migration command, you test
**What to do:** TBD — slice not yet shipped. Use a copy of your library.db first.

### D.1 — Empty-state screenshots
**Where:** save screenshots of bare empty states
**What to do:**
1. Visit Library when filtered by a tag that matches nothing
2. Visit Projects with no projects (delete them all first OR start fresh)
3. Visit a sibling list with no siblings
4. Use Search with no results
5. Screenshot anything that looks like a blank screen instead of an intentional "nothing here yet" state

### D.2 — Loading-state screenshots
**Where:** screenshots of "wait, did this even start?" moments
**What to do:**
1. Walk through every async action
2. Note any where you weren't sure if the app was working
3. Screenshot those moments

### D.6 — Scrubber sensitivity verify
**Where:** when I ship the multiplier setting, you test feel at 0.5×/1×/2×
**What to do:** TBD — slice not yet shipped.

### E.1 — Tab order
**Where:** mental note + screenshot
**What to do:**
1. On each page, press Tab repeatedly from the top
2. Note any place focus jumps to a weird spot or skips a button
3. Screenshot any cycles

### E.3 — Contrast spot check
**Where:** mental note
**What to do:** spot any text that looked too dim to read comfortably on dark mode. Faint helper text is intentional; actual content shouldn't strain.
