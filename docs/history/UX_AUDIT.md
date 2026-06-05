# Media Hub — UX Audit (2026-05-22)

Full walk through every user flow, looking for friction. Grounded in
the actual code, not generic advice. Findings sorted by impact —
top of each section is "biggest win" — and tagged by effort.

🔥 = critical (visible to anyone) · 💡 = real friction · 🟢 = polish

---

## TL;DR

**The app is in genuinely good shape.** 0.8 shipped solid foundations,
0.9.A perf work was clean. The audit found ~25 friction points, of
which **4 are critical and should ship in 0.9**, the rest are polish
or post-1.0 territory.

**Critical findings (the 4 to fix in 0.9):**
1. 🔥 Nav keyboard shortcuts are displayed but not wired (1/2/3/, do nothing)
2. 🔥 First download takes 4+ clicks; a "best format" auto-pick could halve that
3. 🔥 Format list is collapsed by default — new users won't find it
4. 🔥 Right-click context menus don't exist — every card action is 2+ clicks via drawer

**On the browser-extension question:** **don't build it.** Custom URL
protocol (`mediahub://download?url=...`) gets 80% of the value at 5%
of the cost. Details in section 6.

---

## 1. The "Critical Path" — paste URL → grab clip

This is THE flow. Run it a hundred times a week. Every saved click
compounds.

### Current path (single-URL, public video)

| # | Action | Why it's friction |
|---|--------|-------------------|
| 1 | Open app (lands on /library) | Wrong default for the most common task |
| 2 | Click "Download" in nav | Should be the default route, or 1-key away |
| 3 | Click URL input (or Tab to it) | Auto-focus on /download mount would help |
| 4 | Paste URL | OK |
| 5 | Click Fetch button (or Tab + Enter) | Could fire on paste if URL pattern matches |
| 6 | Wait ~1s for metadata + scrubber | Necessary; loading state is fine |
| 7 | Click ▸ to expand format list | **Hidden by default** — biggest UX miss |
| 8 | Click a format row to select | No default selection, must pick |
| 9 | (Optional) Scrub I/O | OK |
| 10 | (Optional) Pick transcode preset | OK if user set a default in Settings |
| 11 | Click Download | OK |

**11 steps for a basic download.** Realistically a user does:
- 4 minimum (paste URL, fetch, pick format, download)
- 6-7 with manual nav + scrub

### Concrete wins

🔥 **Auto-pick "best video + audio" as the default selected format.**
On metadata-fetch success, set `selectedFormat` to the highest-res
muxed video format (or video-only with best audio implied). Show a
"Best — 1080p mp4" chip next to the URL bar. User can click "Show
formats" to override. **Saves clicks #7 + #8 entirely.** Most downloads.

🔥 **Default route → /download.** The current default `/library`
makes sense once you have a library. For a fresh install, the
first interaction is "I want to get a clip." `/download` should
be the default until the library has, say, 5+ assets. Easy
heuristic via library_count.

💡 **Auto-fetch on paste.** When the user pastes a URL into the
input and the URL matches a known platform pattern (youtube.com /
youtu.be), fire Fetch automatically after a 300ms debounce. The
Fetch button stays for manual edge cases. **Saves click #5.**

💡 **Auto-focus URL input on /download mount.** Right now Tab cycles
through nav to get there. `useEffect(() => inputRef.current?.focus(), [])`
on the URL input.

🟢 **"Download" button stays at top of card too.** When the user has
selected a format, the download button should also surface at the top
near the URL bar so scrolling down isn't required for long format lists.

### Quick win bundle: Critical Path improvements
- Auto-select best muxed format on fetch
- Auto-focus URL input on /download mount
- Auto-fetch on paste (debounced)
- Default route → /download until library has assets

Combined: cuts most downloads to 2-3 clicks. **Maybe 1 hour of work.**

---

## 2. Nav & global shortcuts

### Critical bug
🔥 **The keyboard shortcuts shown in nav are not wired.**
- Shell.tsx renders `<span className="kbd">1</span>` etc. on each NavItem
- No corresponding global keydown handler routes them
- Users see "1 / 2 / 3 / ," chips and reasonably assume they work
- This is a credibility hit — showing a shortcut that doesn't fire feels broken

**Fix (~15 min):** add a global keydown listener in Shell that
checks `e.key === "1" / "2" / "3" / ","` AND the active element
isn't a text input AND no modifier keys are held, then navigates.

### Other gaps
💡 **No "Ctrl+L" / "Ctrl+/" to focus URL input** like browsers. Power
users expect this for downloads.

💡 **No "?" key for shortcut overlay.** Users have no way to
discover what shortcuts exist beyond the visible nav chips.

💡 **Ctrl+K shows in the search bar as a chip** but the search itself
is decorative (placeholder UI). Showing the keybind is over-promising
something that doesn't work — either build the cmd palette now or
drop the chip. The current state mis-sets expectations.

🟢 **No Ctrl+W / window close handling for in-progress jobs.** If user
closes the window mid-download, no confirm. Possibly intentional ("yes
let me bail") but worth confirming for accidental clicks.

---

## 3. Download page

Beyond the critical path:

💡 **Manual timestamp entry is hidden behind a toggle.** Good default
(scrubber is preferred), but the toggle says "Manual timestamp entry
(use when stream playback fails)" — a new user who just typed exact
timestamps from a transcript won't know they have to expand this.
Make the toggle label more discoverable: "Type timestamps instead".

💡 **Format spec is shown but unclickable.** The line `spec: 313+bestaudio/best`
is informative but reads as debug output. Move it to a `<details>`
disclosure or only show it on hover.

💡 **Scope indicator could be more visual.** Current text "saving to
Library" works but is plain. A small lime/orange chip showing the
target scope (Library vs Project) at the top would be more obvious.
Currently the user has to read the words. Visual chunking matters.

💡 **No way to retry a failed download from the success/error state.**
If download fails, you have to re-paste the URL. Add a "Retry" button
in the error row.

🟢 **"× segments" UI: the segment list rows could be drag-reorderable.**
Currently segments are displayed in mark order. No way to reorder.
Probably not critical.

🟢 **Progress bars don't show segment numbers in multi-segment download.**
"Downloading 50%" doesn't say which segment we're on. Add "segment 2/3 · 50%".

🟢 **Transcode is silent when preset = "none".** Fine, but a quick
flash of "Saved — no transcode" would close the loop better.

### Batch queue card

💡 **Queue card is below the single-URL card on the same page.** Users
who want batch first have to scroll. Consider a Single-URL / Batch
tab toggle at the top of the Download page.

💡 **No "save as new project" affordance.** If a user pastes 20 URLs
for a new shoot, they have to: create project → switch active → come
back to Download → queue. Could have a "Save these as: [new project name]"
inline.

🟢 **Queue history isn't browsable.** Completed jobs scroll out of
view; clearing loses them. They ARE in the Library, but the queue UI
doesn't surface that. Add a "View in Library" link on each completed row.

---

## 4. Library page

🔥 **No right-click context menu on cards.** The most common actions
(Reveal in Explorer, Open, Copy URL, Remove) all require: click card
→ drawer opens → scroll for the action → click. That's 2-3 clicks
for what should be one right-click.

🔥 **No multi-select.** Cannot tag 10 things at once, delete 10 things,
move 10 things to a project. For any library >100 items this is going
to hurt.

💡 **Drawer doesn't preserve scroll position.** Open card #15 in a
list of 30, close drawer, you're back at top. `scrollIntoView` on close
or freeze scroll while drawer is open.

💡 **Tag editor is in the drawer.** To re-tag without opening every
card, you have no shortcut. Could add inline tag edit on hover (small
+/× icons appear).

💡 **Search is title-only.** Filenames, channel names, and content
tags are all there but search only hits title via LIKE. Channel is
COALESCE'd in, but tags aren't included. Some users expect tag search
to be in the same box.

💡 **No "recent downloads" view.** Library sorts by downloaded_at DESC
but doesn't pin "just downloaded in this session" to the top with
any visual treatment.

🟢 **Empty state when library has zero assets.** Renders nothing or
"0 clips" only. Should have a friendly "Paste a URL on Download to
get started" with a button. (Listed as D.1 in 0_9_PLAN.md.)

🟢 **Sibling chip on cards is great but not clickable.** Clicking
the "+2" chip should open the drawer scrolled to the siblings list.

🟢 **List view tab is shown but disabled.** Same issue as the Ctrl+K
chip — promising something that doesn't deliver.

---

## 5. Projects page + active scope

💡 **Active project picker isn't discoverable.** It looks like a label
("ACTIVE · Project Name"), not a click target. The chevron is small.
Most users won't realize they can click it for ~10 seconds on first
launch.

💡 **No keyboard shortcut to switch project.** Cmd-` style cycle
would be sweet.

💡 **Switching projects mid-download = ambiguity.** If user has a
download in flight and switches active project, the in-flight one
already has its scope locked (correct), but the UX doesn't ACKNOWLEDGE
this. They might think they "switched too late" and panic-cancel.
Add a small "this download → original scope" note in the queue row.

💡 **Project rename has no immediate feedback** that the slug stays
the same (the on-disk folder doesn't rename). Could add a small
"folder stays at: <slug>/" caption.

🟢 **No "duplicate project" option.** For users with recurring shoot
templates ("Client X Weekly Update"), duplicating an existing project
shell would be useful. Post-1.0.

🟢 **Finish Project flow uses TWO native confirms.** The "promote
then trash" two-prompt UX is functional but jarring. Replace with a
single modal that has both checkboxes + a confirm button. (Already
noted in NOTES.md.)

---

## 6. The browser extension question

Owner has flagged this as a possible solution to "alt-tab to copy URL"
friction. Honest analysis:

### Path A: Build a browser extension

**Pros:**
- Right-click YouTube video → "Send to Media Hub" with one click
- Could capture current playback position as suggested In timestamp
- Multi-select on YouTube search pages

**Cons:**
- Need to maintain extensions for Chrome / Firefox (different APIs)
- Chrome Web Store requires Google developer account ($5) + review
- Firefox Add-ons store is friendlier but still review-gated
- Each browser update can break things
- Auto-update story is gnarly
- Needs an HTTP server in the Tauri app (security surface)
- Effort: probably 2-3 sessions for the extension + 1 session for
  the HTTP server + capability work in Tauri

### Path B: Custom URL protocol handler — `mediahub://download?url=...`

**Pros:**
- One-time registration on install (Tauri supports this natively)
- Works from ANY browser, any context — bookmarklets, links, even
  email signatures or clipboard managers
- Zero ongoing maintenance — it's just a URL scheme
- No HTTP server, no security surface
- User installs a one-line bookmarklet for YouTube once, drags it to
  their bookmarks bar, clicks it on any YouTube page → opens Media
  Hub with URL pre-filled
- Effort: probably 1 session including the bookmarklet doc

**Cons vs extension:**
- Can't capture playback position from the browser (bookmarklet runs
  in the page context but exporting that is limited)
- Visible URL bar redirect briefly (the browser opens the protocol
  before Media Hub takes over). Tolerable.

### Path C: System clipboard watcher (don't build)

App polls the clipboard for YouTube URLs and offers to download.
Too creepy, too noisy, ignores the user's autonomy. Don't.

### Recommendation: **Path B (URL protocol).**

It hits 80% of the value at 5% of the cost. Ship in 1.0 alongside
packaging. The bookmarklet doc lives in onboarding + Settings →
Sources. Real-world UX:

```
1. User installs Media Hub (one-time)
2. User drags the "Send to Media Hub" bookmarklet to their
   bookmarks bar (provided as copy-paste in onboarding)
3. User browses YouTube. Sees a clip they want.
4. Clicks the bookmarklet → Media Hub opens with URL pre-filled
   on the Download page.
5. Hit Fetch → download.
```

Versus the extension's "right-click → send" path: one extra click,
but the bookmarklet path covers all browsers including weird ones
the user might switch to. And we save 2-3 sessions of dev time.

**Parking this analysis in NOTES.md for the post-1.0 roadmap.** The
extension idea was originally targeted at 0.7+ post-1.0 per ROADMAP.
URL protocol is the same target with a smaller cost.

---

## 7. Onboarding (already shipped in 0.8.D — what could improve)

💡 **4 screens is one too many.** The cookies screen is the most
likely skip. Could merge Welcome + Workflow into one "What is Media
Hub" screen with the loop diagram inline. Cuts to 3 screens.

💡 **The configure screen's library root field is unnecessary for
~90% of users.** Hide it behind a "Show advanced" toggle. Default is
fine; only power users care.

🟢 **No way to re-trigger onboarding from Settings.** If user skips
it and wants to see it later, they have to edit settings.json
manually. Add Settings → About → "Replay onboarding" link.

🟢 **Skip button could be more present.** It's top-right of the
header, but the user's eyes are on the body. A subtle "Skip · you
can configure everything in Settings later" link at the bottom right
of each screen would help.

---

## 8. Settings page

💡 **Six sections, scrollable, no table of contents.** Hard to jump
to "I want to fix cookies" without scrolling. Add a left rail nav
with anchors to each section, or sticky section headers.

💡 **No "Reset to defaults" anywhere.** If a user fiddles with too
many things and wants to start over, they have to remember each one.
Per-section "Reset" buttons or a global "Reset all settings".

🟢 **Diagnostics doesn't show settings.json path or library.db path.**
Useful debug info. Add to Diagnostics.

🟢 **About section is functional but bare.** Could include "Check for
updates" (no-op for now, but the scaffolding) and a "Report a bug"
link (mailto or GitHub issues).

---

## 9. Cross-cutting

### Loading + empty states (D.1 / D.2 in 0_9_PLAN.md)
- Library mount has no loading state — just empty until rows appear
- Thumbnail backfill is silent
- Project list with zero projects renders nothing visible
- Tag filter cloud could show "0 tags yet" instead of empty space

### Error states
- 0.8 yt-dlp error translator helps a lot
- But error messages STILL fill the entire viewport width in the
  metadata card — visually overwhelming. Constrain to a max-width
  and break long stderr at word boundaries.
- The retry button after errors is missing in most places (it exists
  on batch queue, missing on single-URL Download).

### Focus + accessibility (E.* in 0_9_PLAN.md)
- Most buttons lack visible focus rings (focus is browser default,
  which is muted on dark themes)
- Tab order works but isn't tested
- aria-labels are decent but not audited

### Animation
- Drawer slide-in works
- Onboarding modal pop-in works
- Most state transitions are instant — could ease the tag chip
  add/remove, the queue row state pills, etc. Adds personality.

### Mobile responsive
- Not relevant (Tauri desktop only) but the modal CSS does scale,
  which is good. Window-resize tested? Worth a 30-second pass.

---

## 10. The ranked quick-win list

If you had a free 4 hours and wanted maximum visible improvement,
this is the order:

| # | Win | Effort | Visible impact |
|---|-----|--------|----------------|
| 1 | Wire nav keyboard shortcuts (1/2/3/,) | 15 min | "actually does what it says" |
| 2 | Auto-pick best format on fetch | 20 min | -2 clicks per download |
| 3 | Auto-focus URL input on /download mount | 5 min | -1 click per download |
| 4 | Default route → /download for empty library | 15 min | new-user flow |
| 5 | Auto-fetch on paste | 30 min | -1 click per download |
| 6 | Right-click context menu on library cards | 60 min | -2 clicks per asset action |
| 7 | "Recent downloads" filter chip on Library | 30 min | "where's the thing I just made" |
| 8 | Show formats expanded by default | 5 min | discoverability |
| 9 | Retry button on single-URL download errors | 15 min | error recovery |
| 10 | "Reset to defaults" per Settings section | 30 min | safety net |

**Total: ~3.5 hours for 10 visible wins.** None require new dependencies
or big architectural changes.

---

## 11. The "wait, this could be much better post-1.0" list

For 1.1-1.3 future work, the big multipliers:

- **Multi-select + bulk ops** in Library (1.2 Eagle overhaul)
- **URL protocol handler** (`mediahub://`) for one-click sends from any browser (1.1)
- **Recent downloads pinned section** at top of Library
- **Smart folders / saved searches** (Eagle pattern)
- **Color labels + star ratings** per asset (Eagle pattern)
- **Command palette** (Ctrl+Space, parked for 1.2)
- **Drag-to-NLE** with native OS drag (1.1)

---

## 12. What I'd recommend for 0.9.D (UX polish phase)

When you start 0.9.D, this is the ranked agenda:

1. **The Critical Path bundle** (items 1-5 from section 10) — 1.5 hr
2. **Library context menu + empty states** (items 6, 8) — 1.5 hr
3. **Polish pass** (focus rings, easing, retry buttons) — 1 hr
4. **Onboarding trim** (4 → 3 screens) — 30 min

That's ~4.5 hours of work for almost everything in this audit that
matters before 1.0. Everything else is genuinely 1.x territory.
