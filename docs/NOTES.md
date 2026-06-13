# Media Hub — Working Notes

Status: living doc, last refreshed 2026-06-01 (post 1.3.0 + Pinterest
support + portal-based extension overlay). This is
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

## 2026-06-13 — Cookie consent + "Sync browser logins" button (v1.9.0)

Two additions on top of the cookie-bridge: explicit consent (cookies =
credentials) and a way to warm the cache for the paste-in-app flow
without sending a download. (We considered Option B — an in-app WebView
login — but dropped it: Google blocks embedded-webview sign-in, which is
the exact case we'd need. The sync button is simpler and works for
Chromium browsers via the extension.)

**Consent (default OFF, non-blocking, two surfaces):**
- App: new `cookies_enabled` setting (+ `cookies_consent_seen`). Gates
  the bridge cache write AND `resolve_cookie_args` use — when off,
  cookies are never stored or used. Surfaced as a Settings → Sources
  "Browser login" toggle + a one-time first-run dialog (after onboarding,
  `CookieConsentPrompt` in App.tsx). Decline → downloads still work
  cookie-free; the friendly restricted-video error explains the fix.
- Extension: `harvestCookies` refuses until `chrome.storage.cookieConsent`
  is set; first-run consent panel in the popup. So nothing is read until
  the user opts in on BOTH sides.

**Sync button:** popup "↻ Sync browser logins" → harvests cookies for
every supported site the user is logged into (SYNC_SITES) → POSTs to the
new bridge `POST /cookies` endpoint, which caches per-platform WITHOUT
enqueuing. Fills the gap where you copy a link and paste it in the app
(vs. sending from the extension, which already auto-harvests on send).

**Gotchas:** harvest is centralized in `bridge.js::enqueue` +
`harvestCookies`, so the consent gate covers ALL send paths uniformly
(overlay pill, popup, context menu, hotkey). `/cookies` is auth + consent
gated (403 if the app toggle is off). App + extension → 1.9.0.

## 2026-06-13 — Extension cookie-bridge (Option A): always-fresh cookies

The durable fix for the auth gate (age/private). A static cookies.txt
rots in ~1-2 weeks; this reads cookies live from the browser at send
time, so they're never stale and never need re-export. Combined with the
Deno JS runtime (below), restricted YouTube now works with zero manual
cookie setup. Verified end-to-end: a restricted video downloaded with
Settings → Sources = None, purely off the extension cache.

**Flow:** extension `harvestCookies(target)` reads the site's cookies via
`chrome.cookies.getAll` (incl. httpOnly auth tokens document.cookie can't
see — confirmed SID/SAPISID/__Secure-*PSID landed) → serializes Netscape
cookies.txt → POSTs as `cookies` on `/enqueue` → bridge caches atomically
to `<home>/Media Hub/.cookies/<platform>.txt` (user-only perms, never
logged) → `resolve_cookie_args` (lib.rs) uses it when Settings resolves
to no cookies for that URL.

**Key details / gotchas:**
- Harvest lives in `bridge.js::enqueue` (not per-call-site) so EVERY send
  path benefits — popup, context menu, hotkey, overlay. First attempt
  wired only background.js's two paths and the popup send sent no cookies;
  centralizing in enqueue fixed it.
- The extension reads cookies from the browser IT RUNS IN. You must be
  logged into the site in that browser (tester was logged into YouTube in
  Brave, not the Chrome where they first tried).
- YouTube auth tokens also live on `.google.com`, so harvest grabs those
  too for youtube/youtu.be URLs — without them login doesn't take.
- Precedence: explicit Settings cookie source > extension cache > none.
  So an explicit user choice always wins; the cache fills the gap.
- bumped extension + app to 1.8.0. **Testers must update the unpacked
  extension manually** (app auto-updates; the extension does not) and
  accept the new `cookies` permission.

## 2026-06-13 — Bundled Deno JS runtime (fixes "no formats on restricted")

Diagnosed the long-standing "age-restricted / restricted videos show no
formats" bug. It was NOT cookies and NOT PO tokens (see
COOKIES_RESEARCH.md §0 for the live diagnostic). Real cause: yt-dlp
**2025.11+** moved YouTube's `sig`/`nsig` cipher solving to an **external
JS runtime ("EJS")**. Our yt-dlp is a frozen PyInstaller binary with no JS
engine → signature solving fails → only storyboards survive. Proven fix:
cookies (pass the age gate) **+** a JS runtime (`--js-runtimes node`
returned the full 1080p list in testing).

**Implementation:**
- Bundle **Deno** as a third sidecar (alongside yt-dlp + ffmpeg). Deno
  ships release assets already named by target-triple, so it drops into
  the existing pattern: added to `fetch-sidecars.ps1` +
  `fetch-sidecars-mac.sh`, `tauri.conf.json` externalBin, and
  `.gitignore` (`binaries/deno*`).
- New `js_runtime_args()` in lib.rs resolves the Deno sidecar next to the
  exe (mirrors the ffmpeg-location resolution) and emits
  `--js-runtimes deno:<path>`. Empty + warns if missing → yt-dlp falls
  back to its built-in Python solver (graceful, no error).
- Wired into all four yt-dlp call sites. For the three capture commands
  it goes into the shared `opts`, so the cookie retry-without-cookies
  fallback (`yt_dlp_capture`) keeps the runtime on both attempts.

**Caveat / future:** Deno is ~100 MB, which adds to an already-large
bundle (ffmpeg is ~200 MB) and therefore to every auto-update download.
Consistent with the current bundle-everything approach, but the eventual
fix for installer/update bloat is **lazy-download** of ffmpeg + deno on
first run into appdata (reuse the yt-dlp managed-binary pattern in
updater.rs) rather than bundling. Tracked as a follow-up.

**Next:** cookies still need to be *fresh* for the auth gate, and a
static cookies.txt rots in ~1-2 weeks (YouTube rotates them). The durable
answer is the **extension cookie-bridge (Option A)** — read cookies live
from the browser at download time so they're always fresh. See
COOKIES_RESEARCH.md §4.

## 2026-06-09 — v1.6.0: folder fixes (multi-select, delete, nesting UX)

Tester-driven batch of folder-sidebar fixes.

**Multi-select range bug.** Shift-click re-ranges from the original
anchor now (Library.tsx) — the handler used to move the anchor to the
just-clicked row each time, so repeated Shift-clicks scrambled the
selection. Removed the stray `setFolderAnchor` in the shift branch.

**Delete parent folder failed with UNIQUE error.** Root cause: schema
has `foreign_keys = ON` + `folders.parent_id … ON DELETE SET NULL`
(migration 011), so deleting a parent auto-nulled its children's
parent_id, colliding with `idx_folders_parent_name_unique` when a same-
named top-level folder existed. Fix: `folder_delete` / `folder_delete_many`
now CASCADE the whole subtree, deleting **leaf-first** (recursive CTE +
`ORDER BY depth DESC`) so a parent is always childless when removed and
the SET NULL action never fires on a survivor. Clips in any deleted
folder fall back to Uncategorized via their own FK (files stay on disk).
Confirm copy reworded ("…and any subfolders inside it").

**Drag-to-folder highlight legibility.** `.lib-folder.drop-hover` now
uses bright name + accent-green icon (matches the `.active` look)
instead of dark-on-green that washed to grey.

**Per-row "+" for subfolders.** Header "+" stays top-level; each folder
row gets a "+" (absolutely positioned in the count's column, swaps in on
hover so there's no reserved gap). Aligned to the header "+" (right:8 /
width:22) and the count is `pointer-events:none` so the button's whole
hitbox highlights (was only catching the edges — the count box overlapped
and ate the center hover). Child creation reuses `createFolderInline(parentId)`.

Extension unchanged (1.4.0). App + Cargo + tauri.conf → 1.6.0.

## 2026-06-09 — v1.5.0: per-site cookies + retry-without-cookies fallback

Fixes cross-site cookie bleed: one global cookie source was applied to
every yt-dlp call, so setting Instagram/browser cookies broke YouTube
(logged-in jar → "Sign in to confirm you're not a bot").

**Per-site rules.** New `cookies_overrides: HashMap<String, CookiesSource>`
in Settings (default empty) layered over the existing default
`cookies_source`. `settings::detect_platform(url)` buckets a URL by host
(youtube / instagram / tiktok / twitter / reddit / pinterest / facebook);
`cookies_args_for(state, url)` returns the override for that platform if
present, else the default. Wired into ALL four yt-dlp call sites
(metadata, playlist, download, scrubber stream-resolve). Settings →
Sources grew a "Per-site rules" editor below the default picker.
Typical fix: default None + Instagram→browser.

**Retry fallback.** `yt_dlp_capture(app, opts, cookie_args, url)` runs a
capture command and, if it fails *with cookies applied*, retries once
*without* cookies. Applied to the three capture commands (metadata,
playlist, stream-resolve). NOT applied to the streaming download — re-
running that mid-flight (progress polling + segment trim) is risky and
the per-site rule already makes its cookies deterministic. The retry is
what rescues the "fetching feels broken on YouTube" case.

Extension unchanged (stays 1.4.0). App + Cargo + tauri.conf → 1.5.0.

## 2026-06-09 — v1.4.0: macOS shipping + CI release pipeline + Eagle P1

First multi-platform release, first CI-built release. Three things
landed together under tag `v1.4.0`.

**CI release pipeline** (`.github/workflows/release.yml`): pushing a
`v*` tag now builds **macOS-14 (aarch64) + windows-latest in parallel**
via `tauri-apps/tauri-action`, signs the updater artifacts (secrets
`TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` live in repo Actions
secrets, set from `~/.tauri/media-hub.key`), and uploads to one **draft**
release. Big win: tauri-action **auto-generates + merges `latest.json`**
across both platform jobs — the hand-built manifest dance from the
manual Windows flow is gone. Review the draft → publish.

**macOS specifics:**
- Can't cross-compile from Windows (needs Xcode/macOS SDK) — hence CI.
- Sidecars: `scripts/fetch-sidecars-mac.sh` (mirror of the PS1) pulls
  `yt-dlp_macos` (universal2) + a **static** arm64 ffmpeg from
  `ffmpeg.martin-riedl.de` (static = no Homebrew dylib deps, bundles
  clean), named `{yt-dlp,ffmpeg}-aarch64-apple-darwin`. Gitignore's
  existing `yt-dlp*`/`ffmpeg*` globs already cover them.
- `.gitattributes` forces `*.sh` to LF so the shebang survives the mac
  runner (CRLF → "bad interpreter").
- **Unsigned for now** (no Apple Developer ID): testers right-click →
  Open once per install to clear Gatekeeper. Notarization is the next
  step before any wide release.
- Targeting Apple Silicon only (aarch64). Intel/universal deferred —
  testers are all M-series.

**Eagle P1** (manual send): `eagle.rs` + migration 012. Detects Eagle's
local API (`http://localhost:41595`), sends selected assets via
`addFromPaths` mapping tags→tags, source_url→website, title→name.
"Send to Eagle" in card context menu + inspector (single + batch),
live running-probe, toast feedback. **P2 (folder mirroring + id map)
and the auto-send toggle remain designed-but-unbuilt.**

**Extension corner-ghost fix** (`content-portal.js`): the overlay pill
was parked top-left the whole time at opacity:0, revealing on corner
hover. Root cause: `display` was gated behind a `visible !== lastVisible`
check that never fired on first paint. Fix: always apply `display` from
current visibility + start the button hidden at attach.

## 2026-06-04 — Nested folders (Eagle-style hybrid)

Shipped the full folder-nesting feature in four commits (P1 data model,
P2 sidebar tree, P2.1 alignment+rails, P3 drill-in, + multi-select).

**Model:** migration 011 adds `parent_id`/`color`/`position` to folders;
a guarded Rust step (`migrate_folders_for_nesting`) rebuilds the table
once to drop migration 007's global UNIQUE on name (incompatible with
nesting), replaced by a per-`(parent, name)` unique index. New commands:
`folder_move` (cycle-guarded reparent), `folder_set_color`,
`folder_reorder`, `folder_delete_many` (bulk, one tx). `folder_delete`
re-parents children + nulls assets explicitly (FK enforcement is OFF by
default in SQLite). `library_list` FolderFilter gained an `Ids` variant
for the descendant rollup.

**UX (hybrid, per the research):** the two halves that together solve
deep nesting —
- *Sidebar tree*: recursive render, chevron expand/collapse (persisted),
  guide-rail indentation (nested-`ul` border-left, not per-row padding,
  so depth stays cheap), color dots, drag-to-reparent (HTML5 DnD, custom
  mime so it doesn't collide with the Tauri clip-drag), resizable
  sidebar. Views rows share the chevron gutter so icons align.
- *Content drill-in*: breadcrumb path + subfolder cards above the grid +
  "show subfolder contents" rollup toggle. This is the escape hatch for
  arbitrary depth — you re-root instead of indenting forever.

**Multi-select:** Ctrl/Cmd-click toggles folders into a selection (plain
click still filters); a selection bar offers bulk delete with ONE
confirm (was: 50 folders = 50 popups).

Research refs that shaped the depth approach: UX Planet sidebar guide,
Hagan Rivers "Interaction Design for Trees", ishadeed treeview
indentation (rails + GitHub's `max()` indent). Eagle only does
indentation → runs off the right edge; we added the drill-in so depth
doesn't require horizontal runway. Notes in ROADMAP decision log.

Next: nothing outstanding on folders. Eagle integration is still the big
queued item.

---

## 2026-06-04 — 1.3.1 → 1.3.3: palette, list view, background mode, dialogs

Multi-session sweep. Everything below shipped + released.

**Command palette (1.3.x).** Ctrl+Space (`src/components/CommandPalette.tsx`).
Three tabs — Clips (backend search) / Projects / Tags — cycled with Tab.
Cross-route handoff via window CustomEvents: `mh:open-asset` (palette →
Library selects + scrolls to a clip, switching scope first if needed)
and `mh:apply-tag-filter` (palette → Library applies a single tag).
Click mapping: plain → play, Ctrl → reveal, Shift → show in library.

**Library list view (1.3.x).** Toggle in the chrome header; persisted to
`localStorage` (`mh.library.viewMode`). Reuses all card handlers
(selection / Ctrl / Shift-range / context menu / dbl-click open / drag
to folder + marquee). Columns are **ratio-based** (`mh.library.colRatios`,
fr units summing to a constant) so they always fit the container — the
date column can never be dragged offscreen. Hard pixel floors per column
via `minmax(MIN_PX, var(--fr))` so labels never truncate. Drag a divider
and neighbors cascade in BOTH directions once they collide. Sortable
headers (Title/Duration/Size/Added) share the same `sortMode` state as
the toolbar Sort popup. Double-click a divider resets all columns.
  - Gotcha that cost two rounds: `.lib-list-col` ships `overflow:hidden`
    for row-text ellipsis, which clipped the header resize handle. Fix:
    a 3-class selector (`.lib-list .lib-list-head .lib-list-col`) to win
    specificity and set `overflow:visible` on header cells only.

**Queue order.** Download queue renders newest-first
(`jobs.slice().reverse()` in the view only — the underlying array stays
append-only so the worker's job-id logic is untouched).

**Background mode (1.3.3).** `src-tauri/src/tray.rs`. Topbar eye button
(`app_enter_background`) hides the window into the system tray; the Rust
backend + the hidden-but-alive webview download queue keep running. Tray
icon built hidden at startup, toggled visible. Left-click / Show item
restores; Quit exits. `app_set_tray_tooltip` shows the live active count.
Deliberately NOT intercepting the X/minimize buttons — those keep normal
behavior (X quits, minimize → taskbar, alt-tab intact). The button is the
explicit opt-in, so no setting needed. Required `tray-icon` + `image-png`
features on the `tauri` crate.

**In-app dialogs (post-1.3.3).** `src/lib/dialog.ts` rewritten from the
native `@tauri-apps/plugin-dialog` (`ask`/`message`) to a tiny pub/sub
store + `src/components/DialogHost.tsx` modal mounted at app root. Same
async `confirmDialog`/`alertDialog` signatures, so ~30 call sites are
untouched. Motivation: the native dialogs play the OS system chime (the
user flagged it as physically grating) and look like generic Windows
boxes. Now styled to the palette's language, silent, Enter/Esc/backdrop
wired.

**Inspector polish.** Open/Reveal/Delete became icon-only square buttons
(`insp-action-btn`, 38px, tooltips) — added `Icon.play`; `Icon.folder` +
`Icon.trash` redrawn from Vault's Lucide paths (24×24, stroke 1.8) for
weight parity. Batch (multi-select) Delete brought to the same standard.
Source URL now opens in the default browser via `openExternalUrl`
(opener plugin's `openUrl` — WebView2 ignores `target="_blank"`); needed
`opener:allow-open-url` capability.

**RELEASE-PROCESS GOTCHA (important).** The updater endpoint is
`releases/latest/download/latest.json`. The signed `.sig` files are
generated by `npm run tauri build` (with `createUpdaterArtifacts: true`),
but **`latest.json` is NOT** — it has to be assembled by hand and
uploaded with the release. v1.3.2 and v1.3.3 initially shipped WITHOUT it
(I used `gh release create` and forgot the manifest), so "Check for app
updates" failed with *"Could not fetch a valid release JSON."* Fix: build
`latest.json` (`version`, `notes`, `pub_date`, `platforms.windows-x86_64.
{signature,url}` — signature = contents of the NSIS `.sig`, url points at
the `-setup.exe` with dots-for-spaces) and `gh release upload`. TODO:
fold this into a `scripts/release.*` so it's one command and can't be
forgotten again.

**Signing key.** Password is empty (per `history`/setup). Build with
`TAURI_SIGNING_PRIVATE_KEY=$HOME/.tauri/media-hub.key` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` exported, else the build hangs at
an interactive password prompt (cost us a stuck background build once).

**Next up:** nested folder structure (folders-in-folders) — needs a
`parent_id` on the folders table + recursive CRUD + a sidebar tree UI.
And an Eagle integration investigation (see ROADMAP).

---

## 2026-06-01 wrap — Pinterest support + extension overlay redesign + direct-download fallback

Long sprint, multiple wins:

1. **Auto-updater shipped end-to-end.** `v1.3.0` cut + tagged + GitHub
   release published with signed installer + `latest.json`. Settings
   → Diagnostics → Check for app updates now returns `Up to date
   (1.3.0)` on installed builds — proving the manifest + signature
   verification flow works. First time-cost: long. Per-release cost
   from now on: `npm run tauri build` + drag 5 files into a Release.
   Critical gotcha discovered: Tauri v2 requires
   `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` for
   `.sig` files to be emitted. The env var alone isn't enough.
   Build pre-1.3.x bundles WITHOUT signing if you forget this.

2. **Pinterest as a first-class source.**
   - Desktop: `lib/platforms.ts` registry shared by Download page and
     download orchestrator. `detectPlatform()` returns "pinterest"
     for `pinterest.com/pin/*` + `pin.it/*`. Latent bug fixed: every
     library row was being stamped `platform: "youtube"` regardless
     of source — TikTok/X clips were lying. Now correct.
   - URL guard: blob: URLs (Pinterest lightbox right-click trap)
     caught up-front with a useful message.
   - Library card badges + filter labels include Pinterest + TikTok.
   - Backend error mapper now branches "no formats found" by
     `[ExtractorName]` prefix so Pinterest errors stop quoting Chrome
     DPAPI bugs and YouTube watch-history checks.

3. **Browser extension: unified body-portal overlay.** Pinterest's
   player wrapper has `overflow: hidden` AND captures pointerdown
   on a sibling layer — the in-DOM button got both clipped and
   click-eaten. Solution: portal every site's overlay button to a
   single body-level `<div id="mh-overlay-portal-layer">` with
   `position: fixed` and track each video's bounding rect. Outside
   the platform's DOM tree → their overlays can't touch us.
     - New shared helper `content-portal.js` (loaded first per
       site). Site scripts collapsed to URL discovery + one
       `attachPortalButton` call.
     - Instagram support **restored** (was pulled in 1.2.14 for the
       same click-lock the portal now bypasses).
     - YouTube added as a safety-net: SPA `yt-navigate-finish`
       cleans + re-attaches per video swap.
     - Button redesign: tiny lime download arrow at rest, expands
       to "● Media Hub" pill on hover. Universal styling with
       every property locked `!important` so site CSS (Reddit's
       button reset was the worst offender) can't bully us.

4. **Direct-download fallback for raw media URLs.** When yt-dlp's
   generic extractor returns zero formats but the URL itself is a
   direct media file (CDN .mp4 etc.), Rust `media_direct_download`
   does an HTTP GET with platform-aware Referer headers
   (Pinterest CDN wants `pinterest.com/`, Twitter twimg wants
   `x.com/`, etc.) and streams to disk. Reuses the same
   `download:progress` event channel so the existing progress bar
   lights up unchanged. Wired into:
   - Download page (fallback button when meta.formats is empty +
     URL is .mp4/.mp3/.webm/...)
   - Queue worker (auto-routes direct media URLs through the same
     path, no UI affordance needed)

### Hand-off for tomorrow / next session (user's queue, in order)

1. **Wire the extension sniffer as fallback to the in-page button.**
   Today proved out: when yt-dlp's Pinterest extractor fails on a
   pin URL, the extension sniffer DID see the underlying CDN .mp4
   that the pin's video element loads. Path forward: when the
   in-page Pinterest button click would result in a yt-dlp "no
   formats" failure, fall through to "did the sniffer catch a
   media URL for this tab?" and hand THAT to the desktop app's
   new direct-download command. Feasibility check needed — the
   sniffer state is per-tab in the background service worker,
   needs to be queryable from the content script at click time.
   This is the missing piece that makes Pinterest support feel
   "just works".

2. **UI dead-affordance sweep (the cleanup pass).**
   - Top-right search bar — currently does nothing
   - Grid / List view toggle on Library — switch the renderer
     between current cards and a table view
   - Copy audit — there are several "TODO"-feeling labels and
     placeholder text strings to fix

3. **Browser extension polish.** Open-ended — quick UX/visual fixes
   the user has been collecting. Touch-ups on top of the new
   portal overlay.

4. **Video quality preference in Settings.** New idea this session:
   add a "preferred max quality" dropdown to Settings → Downloads
   (e.g. 1080p / 720p / source) that the **extension's quick-send
   button** uses as default so testers don't have to remember to
   pick a format every time. Doesn't override the Download page's
   per-clip picker — that stays explicit.

5. **Sniffer panel rework.** Bigger item carried over: filter
   empties, dedupe by stream root, preserve state on tab switch,
   replace the eye-preview with something actually useful.

### Notes for tomorrow's Pinterest sniffer-fallback work

- The sniffer lives in `extension/sniffer.js` (background service
  worker). Today's session didn't touch it, so its API surface
  is unchanged.
- The content-script `attachPortalButton` flow lives in
  `extension/content-portal.js` and currently sends a fixed URL
  to the background. Adding fallback = letting the background
  optionally pick "the sniffed URL for this tab" when the primary
  URL fails — this is a 2-message round-trip pattern, not a big
  refactor.
- The desktop `media_direct_download` command is in
  `src-tauri/src/direct.rs` and already does the right thing for
  raw CDN URLs from any source. So all the heavy lifting on the
  desktop side is done.

---

## 2026-05-30 wrap — session end + forward queue

Session shipped **two big things**:

1. **1.3.0 cut and tagged.** 6 months of in-tree work (1.1.x Eagle
   refactor, 1.2.0–1.2.1 audio, 1.2.2–1.2.15 browser-extension stack,
   1.2.16 yt-dlp engine updater, 1.3.0 Projects + Trash + delete UX)
   landed as a single honest catch-up commit + version bump. Tag
   `v1.3.0` points at `5a34485`. Last commit before this session was
   `4e27c35` (1.0.5), so six months of work was sitting on one hard
   drive — a real bus-factor risk now defused.

2. **App auto-updater scaffolded.** See dedicated section below for the
   full status + release recipe. tl;dr: backend + UI in, signing key
   generated, `tauri.conf.json` configured, release-process recipe
   documented. Three human-only steps still pending (key backup, push
   to GitHub, first signed release).

### Hand-off for tomorrow / next session (the human's queue)

User-listed at session end, in priority order:

1. **Finish the auto-updater human parts**
   - Back up `~/.tauri/media-hub.key` outside this machine
   - Push the repo to GitHub
   - Replace `GUILHERME_GH_USERNAME` placeholder in `tauri.conf.json`
   - Cut the first signed release (follow the recipe below)

2. **Pinterest in-page button + popup-tab detection.** Today's session
   diagnosed a `blob:` URL failure — yt-dlp can't fetch blobs (in-browser
   objects). The pin-page URL works fine via yt-dlp's Pinterest
   extractor; users just need a reliable way to hand the page URL to the
   app. Two-tier fix matching the existing Twitter/Reddit pattern:
     - Tier 1 (~15 min): when the active tab matches `pinterest.com/pin/*`,
       the extension popup's "Send to Hub" button uses
       `window.location.href` regardless of any video element's src.
     - Tier 2 (~30–45 min): full in-page hover button on Pinterest, same
       shape as Twitter/Reddit.

3. **Wire up the dead UI affordances.** Things that look interactive but
   do nothing:
     - Top-right global search bar (still decorative — would be the
       Ctrl-K palette parked at NOTES "command palette" entry)
     - Grid/List view toggle in the Library header — List is `disabled`
     - Random placeholder text and stale chips to audit and trim

4. **Extension touches and adjustments.** Catch-all polish pass on the
   browser extension. Specific items so far:
     - Sniffer panel rework — see dedicated section below.
     - General polish: popup spacing, status pill states, icon sizing.

5. **Sniffer panel rework** (high-value, user-surfaced today). The
   "Detected on this tab" list has two real problems:
     - **A lot of empty / useless candidates** clog the list. Need a
       filter that hides candidates with no real payload (size = 0,
       duration unknown, no extractor match). The current list shows 4
       HLS rows from `v1.pinimg.com` with the same hash prefix — those
       aren't 4 videos, they're 4 chunks/variants of the same stream.
       De-duplicate by stream root + extension before showing.
     - **The eye-preview workflow is broken**: clicking the eye opens a
       new tab, the user loses track of which row they wanted, and the
       sniffer state refreshes when they come back. Two fixes needed:
         a. Preserve sniffer state across tab switches (the in-memory
            per-tab list shouldn't reset on background → foreground).
            Likely a content-script lifecycle bug.
         b. Replace the bare eye with something where the user can
            confirm the candidate WITHOUT leaving the popup. Options:
            inline thumbnail (extract a frame via `video` element
            client-side), hover-preview tooltip, or a small embedded
            `<video>` snippet that plays inline.

   Owner's framing: "it's a good feature, but we need to make it better."
   Worth treating as a focused mini-milestone, not bolting fixes on.

### Other items still parked from prior sessions (still relevant)

- **App health checkup** (was the 0.9 plan, never run) — perf · leaks ·
  bug census · UX polish · a11y. Section below from 2026-05-21.
- **Runaway-size download guardrail** — abort + fail cleanly if `.part`
  exceeds ~1.5–2× the size estimate. Deferred when we shipped the
  yt-dlp updater; still a worthwhile safety net.
- **gallery-dl sidecar** for image hosts (layer-4 of coverage plan).
- **Eagle overhaul leftovers** — color labels, ratings, notes. Only if
  testers actually ask.

---

## 2026-05-30 (SCAFFOLDED, 1.3.0) — App auto-updater wired up

The yt-dlp engine has self-updated since 1.2.16. Now the **app itself**
can too, so testers don't need to walk through a manual reinstall per
patch. Backend + UI are in; the live endpoint URL is still a placeholder
waiting for the GitHub repo to exist.

### What's wired

- **Signing keypair** generated, stored at `~/.tauri/media-hub.key`
  (private) + `~/.tauri/media-hub.key.pub` (public). NEVER committed —
  `.gitignore` catches `*.key` / `*.key.pub` as a belt. Losing the
  private key means every existing install can never auto-update again
  (signature won't verify). BACK IT UP.
- **Public key** baked into `tauri.conf.json` -> `plugins.updater.pubkey`.
- **Plugin** `tauri-plugin-updater` + `@tauri-apps/plugin-updater`
  installed. Registered in lib.rs setup() right after deep-link.
- **Capability** `updater:default` added to capabilities/default.json.
- **Endpoint** (TODO — needs GitHub username):
  `https://github.com/GUILHERME_GH_USERNAME/media-hub/releases/latest/download/latest.json`
  Replace `GUILHERME_GH_USERNAME` once the repo lives on GitHub.
- **Backend commands** in `updater.rs` (alongside the yt-dlp engine
  updater for cohesion): `check_for_app_update` + `install_app_update`.
- **UI** — Settings -> Diagnostics now has a "Check for app updates"
  button parallel to the existing "Update engine now" one. Single button
  flow: click checks; if newer exists, second click is implicit and
  installs.
- **Install mode** on Windows: `passive` — progress dialog, no wizard.
  App relaunches automatically after install.

### Release process (do this every time you ship a version)

1. **Bump the four version markers** (tauri.conf.json, Cargo.toml,
   package.json, Shell.tsx brand-build) — same dance as today.
2. **Build with the signing key in env**:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\media-hub.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""    # empty unless you password-protected the key
   npx tauri build
   ```
   The build produces, alongside the NSIS + MSI installers, signed
   `.sig` files for each: `Media Hub_X.Y.Z_x64-setup.exe.sig`.
3. **Compose `latest.json`** at the repo root (or wherever — it's just
   text):
   ```json
   {
     "version": "X.Y.Z",
     "notes": "What changed in this release.",
     "pub_date": "2026-MM-DDTHH:MM:SSZ",
     "platforms": {
       "windows-x86_64": {
         "signature": "<paste the contents of the .sig file>",
         "url": "https://github.com/<owner>/media-hub/releases/download/vX.Y.Z/Media%20Hub_X.Y.Z_x64-setup.exe"
       }
     }
   }
   ```
4. **Create the GitHub Release** `vX.Y.Z` and attach:
   - The NSIS installer (`Media Hub_X.Y.Z_x64-setup.exe`)
   - The `latest.json`
   - (Optional) the MSI for manual installs
5. **Mark it the latest release.** The endpoint in tauri.conf.json uses
   `/releases/latest/download/latest.json` — only the release tagged
   "Latest" is reachable through that URL.
6. **Sanity-check** by running the previous version on a tester's
   machine: Settings -> Check for app updates -> the new version should
   download, verify, and install silently.

### Failure modes to remember

- **Endpoint placeholder still in tauri.conf.json** -> updater errors
  out with a DNS / not-found. First-time-only gotcha; fix the URL.
- **`latest.json` signature is the WRONG key** (different keypair
  generated by mistake) -> updater rejects, surfaces a signature error.
  Always sign with the key whose public counterpart is in the shipped
  binary.
- **Missing `pub_date`** on some plugin versions -> manifest is rejected.
  Always include it, ISO 8601 UTC.

---

## 2026-05-27 (BIG SESSION — Audio support + the whole browser-extension stack, 1.2.0 → 1.2.15)

Marathon day. Two big arcs: (A) audio downloads, (B) the browser
extension + everything it needed on the backend. Shipped to testers as
**1.2.15** (NSIS + MSI built, extension folder zipped).

### A. Audio support (1.2.0 → 1.2.1)

- New asset `kind` column (migration 008). `"video"` | `"audio"`,
  defaults to video so old rows back-fill. Indexed.
- `yt_download` learned `audio_format: Option<"mp3"|"m4a"|"flac">` →
  `-x --audio-format <f> --audio-quality 0`, skips merge.
- New `media_extract_waveform` Rust command — ffmpeg `showwavespic`
  renders a lime waveform PNG, wired through `library_set_thumbnail`
  exactly like the frame-thumbnail path.
- Download page: **Video | Audio tabs**. Audio mode = 3 format cards
  (MP3 320 / M4A AAC 256 / FLAC lossless). No bitrate picker —
  decided nobody downloads audio at LOW quality, so we pick sensible
  per-format defaults server-side. Transcode row hidden in audio mode.
- Library card + inspector get audio treatment (waveform bg, music-note
  glyph, "Format" stat instead of "Dimensions"). Kind filter in the
  FilterPopup. Queue worker also learned audio mode.
- **Double-click to open**: was using plugin-opener's `openPath`, which
  silently rejects paths outside the capability scope (`$HOME/**`).
  Replaced with our own `os_open_path` Rust command that shells out
  (`cmd /c start`) — works for any drive/path. See lesson below.

### B. Browser extension + bridge (1.2.2 → 1.2.15)

Roadmap we followed: localhost HTTP → deep-link → extension MVP →
sniffer. (gallery-dl / images parked.)

1. **Localhost HTTP bridge (1.2.2)** — `bridge.rs`, axum server bound
   `127.0.0.1:47821`. `GET /health` (no auth) + `POST /enqueue`
   (bearer-token). Emits `bridge:enqueue` Tauri event; a `BridgeListener`
   React component routes it through the existing `enqueueUrls`. Token
   auto-generated on first launch, stored in settings, shown in
   Settings → Browser bridge with copy/regenerate + curl examples.
   Spawn via `tauri::async_runtime::spawn` NOT `tokio::spawn` (no
   reactor in `setup()` — that panic was the first gotcha).
2. **Deep link (1.2.3)** — `mediahub://enqueue?url=...&token=...`.
   `tauri-plugin-deep-link` + `tauri-plugin-single-instance` (deep-link
   feature). Token required as query param (deep links can't carry
   headers). Dedupe window needed: single-instance forward AND
   on_open_url BOTH fire on Windows → was downloading twice.
3. **Extension MVP (1.2.3)** — plain ES-module MV3 (no build step).
   Popup (format picker + status pill), options (token pairing),
   context menu, hotkeys (`Ctrl+Shift+Y` video / `Ctrl+Shift+M` mp3),
   `mediahub://` cold-launch fallback. **`"type":"module"` in the
   background manifest entry is mandatory** when the SW uses `import`
   — without it the SW silently fails to register and context menus
   never appear.
4. **Stream sniffer (1.2.4 → 1.2.5)** — `webRequest` + `<all_urls>`,
   per-tab in-memory detected-streams list, toolbar badge. **Tanked
   YouTube playback** at first (every range-request hit our observer).
   Fixed with SKIP_HOSTS (googlevideo/youtube/vimeo/twitch/reddit-CDN),
   string-suffix fast-path before `new URL()`, debounced badge updates.
5. **In-page overlay buttons** — content scripts inject a hover-reveal
   "Media Hub" pill on each video. Twitter/X (1.2.6) + Reddit (1.2.12)
   work great; **Instagram pulled (1.2.15)** — their player click-locks
   pointer events and wins the capture-phase race no matter what
   (window-level guards, direct handler dispatch — all lost). IG still
   covered by popup + sniffer.

### The cookies non-bug (the dumb one)

Spent ~40 min convinced a `[PYI-...:ERROR] Failed to execute script
'__main__'` crash was AV interference / Tauri spawn weirdness / yt-dlp
version. PowerShell ran the EXACT same args fine. Turned out: the user
had left Settings → cookies on "File" mode with an **empty path**, so
we passed `--cookies ""` to yt-dlp, which crashes its PyInstaller
bootloader before Python can even print a traceback. The dev console
was literally logging `[cookies] passing to yt-dlp: ["--cookies", ""]`
the whole time. Guarded it: empty/missing cookies path now falls back
to no-cookies + logs a warning.

### Lessons logged

- **Check config + the dev console BEFORE blaming the spawn layer.**
  The `["--cookies", ""]` line was right there. A 30-min rabbit hole
  collapsed the second we read our own log. New rule: when a sidecar
  crashes, FIRST run the exact command in a real shell, SECOND read
  every line of our own stderr/stdout capture, THIRD suspect spawn env.
- **`[PYI-...:ERROR] Failed to execute script '__main__'` ≈ "yt-dlp got
  a bad CLI arg that broke pure-Python arg parsing before main()."**
  Almost never AV, almost never the binary. Look at the args.
- **Don't add process-spawn "stabilizer" env vars without re-testing
  every download path.** I added PYTHONIOENCODING + PYTHONDONTWRITEBYTECODE
  as a hail-mary and broke YouTube globally. Reverted. Spawn config is
  load-bearing; treat changes like surgery.
- **plugin-opener has a path SCOPE** (`$HOME/**` default). Files on
  other drives silently fail to open. Our own `os_open_path` Rust
  command (shell out) sidesteps it — same trust boundary as our other
  commands since the path comes from our own DB.
- **MV3 service worker + `import` needs `"type":"module"`.** Silent
  failure otherwise. Cost ~15 min wondering why context menus vanished.
- **Site player click-hijacking is real and sometimes unwinnable.**
  Twitter/Reddit: stopPropagation on the button is enough. Instagram:
  window-level capture-phase guard + direct handler dispatch STILL
  lost. Know when to cut a platform and rely on the popup/sniffer.
- **cargo clean fails with "Acesso negado" while the app is running.**
  Obvious in hindsight — the running binary locks the target. If a
  rebuild "doesn't take effect," the dev server is probably still up.

### Open follow-ups

- Auto-updater for the app itself — *scaffolded 2026-05-30* (see top of
  doc for status). The yt-dlp engine has self-updated since 1.2.16.
- Extension: store publishing (Chrome Web Store $5 + Firefox AMO) when
  ready for real reach. Sideload-only for now per owner's call.
- gallery-dl sidecar (image hosts: Twitter media, IG carousels, Pixiv)
  — parked layer-4 of the coverage plan.
- Multi-video tweet: yt-dlp downloads ALL videos in a tweet by default.
  Fine for now; could add `--playlist-items` selection later.
- Instagram in-page button: revisit only if their DOM/player changes.

---

## 2026-05-24 (BIG SESSION — Eagle-style library refactor, Phases 1-3)

A multi-hour build day that took the library from "modal drawer +
inline filter chips" to "always-on inspector + folders sidebar +
filter popup." Plus some battle scars: the YouTube TV-client DRM
incident, the Brave/YT false alarm, and the asset-protocol scope bug
that hid behind a migration regression.

### What landed

**Phase 1 — Multi-select + bulk delete (UNCOMMITTED, post-1.0.5)**
- Unified `selection: Set<string>` replaces the old
  `selectedId` + `multiSelected` split
- Click handler: plain click = single select, Ctrl/Cmd = toggle,
  Shift = range, double-click = open in default app
- Box-drag selection (marquee) on empty grid area
  with live hit-testing of card rects. Ctrl-drag = additive
- New Rust `library_delete_many` command — single sqlx tx +
  per-file OS-trash via the `trash` crate (already a dep). Returns
  `BulkDeleteResult { rows_deleted, files_removed, file_errors }`
- Dropped the modal AssetDrawer + the checkmark badges + the
  floating bulk-action bar. The always-on inspector subsumes all three.
- New `InspectorPanel` with 0/1/many states. Single shows asset
  details + actions; batch shows count + size + platform breakdown
  + items list + bulk actions
- Keyboard: Ctrl+A select all, Delete bulk delete (to Recycle Bin),
  Esc clears selection

**Phase 2 — Folders sidebar (Eagle-style)**
- Schema migration 007: `folders` table (id, name UNIQUE COLLATE
  NOCASE, created_at) + nullable `assets.folder_id` with FK ON
  DELETE SET NULL (deleting a folder falls assets back to
  Uncategorized, doesn't lose rows)
- CRUD: `folder_create/list/rename/delete` + `asset_set_folder` +
  `asset_set_folder_many` (batch from inspector)
- `LibraryFilters.folder: Option<FolderFilter>` with three-state
  enum (Any / Uncategorized / Id { id })
- Sidebar gets Folders section at top: "All clips" + "Uncategorized"
  + user folders, alphabetical, with counts. Active row gets lime
  fill. Click = filter; double-click = rename inline; right-click =
  proper `FolderContextMenu` with Rename / Delete folder (mirrors
  CardContextMenu visual style)
- `+` button in section header → creates "Untitled" (or "Untitled
  2"…) and drops straight into rename mode. Matches Eagle/Finder UX
- Inspector folder dropdown (single + batch). Batch shows
  "— mixed —" when selected assets have different folders
- Old Source / Tags / Added sidebar facets DROPPED to make room.
  State + count derivations kept (voided) for Phase 3 to reuse.
- Recycle Bin: dropped the "Forget vs Delete" split — single
  Delete action moves files via `trash::delete`, recoverable from
  OS until a future virtual trash bin lands

**Phase 3 — Filter popup**
- New `Filter` button in the library toolbar with active-count
  badge (lime, shows sum of tags + platforms + buckets)
- Anchored popup component renders three sections: Source / Tags /
  Added. Tag section has its own inline search. Each row is a
  toggle with count; popup stays open during multi-select
- Click-outside / Esc / scroll / resize → close (same pattern as
  CardContextMenu)
- Active filters STILL appear as removable chips in the toolbar
  (kept the existing `lib-active-filters` row so users see active
  state without opening the popup)

**Other fixes shipped today (between phases)**
- `library_repair_thumbnails` Rust command + auto-run on Library
  mount. Heals the thumbnail breakage from 1.0.5's migration
  command (which forgot to rewrite `thumbnail_path` rows) by
  nulling broken refs so the existing backfill regenerates them
- 1.0.5 migration command patched to also rewrite `thumbnail_path`
  alongside `file_path` (so the next person who migrates doesn't
  hit this)
- `tauri.conf.json` asset protocol scope expanded from
  `["$HOME/**"]` to `["$HOME/**", "**"]` — was blocking thumbnails
  from being served when library_root pointed outside HOME (e.g.
  `E:\Media Hub Library\`)
- TV-client default DROPPED entirely (was added 1.0.3, ordering-
  reverted 1.0.4, now removed). YouTube experiment makes the TV
  InnerTube client return "DRM protected" on every video; bit us
  for ~30 minutes of debugging today
- Selected-card outline switched from CSS `outline:` → pseudo-
  element with z-index. The CSS outline got clipped by the
  thumbnail's stacking context on multi-select; pseudo-element
  paints above EVERY descendant so it's bulletproof
- Browser focus-visible ring suppressed on `.lib-card` (kept a
  subtle dashed ring for keyboard-only when NOT selected)
- Folder count column right-aligned with the `+` button via
  width-matching (both 22px wide ending at the same X)
- Folder context menu rebuilt to mirror CardContextMenu visual
  style (`.ctx-item`, `.ctx-danger`, plus new `.ctx-label` for the
  non-interactive folder name header)

### Known regression (carried forward as 1.1 follow-up #1) — RESOLVED

The tag-editor was ported into InspectorSingle (and BatchTagEditor
for the multi-select case) shortly after this entry. Confirmed
present in `Library.tsx`. Kept this stub for archeology.

### Lessons logged

1. **Asset protocol scope is config-bound — extend at install time,
   not at use time.** We caught this only because the migration
   moved the user's library outside `$HOME`. If we ever support
   per-project external roots (parked NOTE) the same scope rule
   applies: the WebView refuses to serve from any directory not
   allowlisted at startup. Tauri 2 does have runtime scope APIs;
   worth investigating if we hit it again.

2. **Don't prepend new player_clients to yt-dlp defaults.** The TV
   client looked like free coverage for age-gate; turns out YT
   weaponizes specific clients via A/B tests. Defaults are tested
   and battle-hardened. Future client experiments should be
   opt-in via Settings, never default.

3. **Browser DevTools-style "outline" CSS gets clipped by stacking
   contexts.** Pseudo-elements with explicit z-index are the
   bulletproof pattern for "outline on top of everything inside
   this element."

4. **Eagle's flat-list-of-checkboxes popup is way better than
   sidebar facets.** Less vertical waste, doesn't compete with
   folders, easier to add new filter categories later, and the
   "search tags inline" experience feels natural inside a popup
   in a way it never did as a permanent sidebar row.

5. **The Brave-YT thing.** Spent 3+ hours treating a Brave ad-block
   filter issue as if it were our app + a yt-dlp rate limit. Got
   nerd-sniped by the symptom (Playback ID errors look exactly like
   throttling). Lesson: when "everything is broken" suddenly, check
   the browser console / a different browser / Twitter before
   running any deeper diagnosis. Costs ~30 seconds to falsify.

---

## 2026-05-23 afternoon (SHIPPED, 1.0.5) — library-root migration command

Defuses the silent-data-loss footgun documented at 2026-05-22 in
the parking lot ("Library-root change footgun, HIGH PRIORITY"):
previously, changing `library_root` in Settings only applied to
future downloads, and any user who cleaned up the "old" folder
wiped both their content AND library.db.

**What shipped:**
- New Rust command `library_migrate_root(new_root)` in library.rs
  with full validation (refuses self-moves, cycles, conflicting
  content at destination, in-flight downloads via JobRegistry
  check), filesystem moves with same-volume `fs::rename` + cross-
  volume copy+delete fallback, single-transaction DB rewrite of
  every `assets.file_path` that starts with the old root prefix
  (path-boundary safe — won't rewrite a different folder with the
  same prefix), settings update via a new `set_library_root`
  helper, and a structured `MigrateResult` return.
- New helper `crate::settings::set_library_root(app, state, new_root)`
  so library.rs can persist the change without duplicating the
  save+emit pattern.
- Frontend "Move existing library to…" button under the library
  root row in Settings → Library. Folder picker → confirmDialog
  with the warnings list → invoke with spinner state → alertDialog
  with the result (moved dirs, skipped dirs, rows updated, warnings).

**What stayed the same:**
- `library.db` still lives at `~/Media Hub/library.db`. Moving an
  open SQLite mid-session is fiddly and the user-visible win is
  small. Documented in the section hint copy.

**What's NOT in 1.0.5:**
- Filesystem rollback on partial failure. The DB transaction
  rolls back cleanly, but if you've moved 2 of 3 content dirs and
  the 3rd fails, the half-state is surfaced in the error message
  and the user has to inspect/finish manually. Robust rollback
  would need a per-file journal; out of scope for a 1.0.x patch.
- Progress events during the move itself. Big libraries on slow
  disks could take a minute; we just show "Moving…" spinner. If
  testers complain, easy to add via emit() inside copy_dir_recursive.

**Lesson logged:** path validation is the boring part. Spent a real
amount of cycles getting `path_is_inside` right (canonicalize both
sides when possible, fall back to lexical), the "conflicting
content at destination" check (empty subdir is fine, populated
subdir refuses), and the prefix-boundary check on file_path
rewrites (avoid rewriting `/foo/barbaz/...` when `/foo/bar` is the
old root). All three are the kind of bug that wouldn't show up in
casual testing but would corrupt real-user data once it shipped.

---

## 2026-05-23 noon (POSTMORTEM, 1.0.3 → 1.0.4) — TV-client default broke metadata fetch

After shipping 1.0.3 with `--extractor-args youtube:player_client=tv,web`
as default, the owner hit a new failure mode on the same EqVkMLZv2RU
age-restricted test video.

**What worked in 1.0.3:**
- ✅ Cookies validator caught the bad initial cookies file
  ("This cookies file is missing YouTube login" — exactly the case
  it was designed for)
- ✅ Owner re-exported cookies properly with the LOCALLY extension
  (this time targeting youtube.com tab directly)
- ✅ Validator turned green: "30 youtube.com cookies, auth token
  detected" — confirming the file is now genuinely good
- ✅ The age-gate error message translator's new wording landed
  correctly when the download was attempted

**What broke in 1.0.3:**
- The `Fetch` button (yt_fetch_metadata) returned "Requested format
  is not available" — the long-standing "yt-dlp got zero formats"
  translator hit
- Root cause: with `tv,web` ordering, the TV client was tried first.
  For this hard-age-gated video, TV returned no usable format
  manifests, and yt-dlp surfaced the error before merging in web
  client formats (or merge happened but produced empty set).
- This was a regression — the same video used to at least *fetch*
  metadata in 1.0.2 and below.

**Fix in 1.0.4 (commit pending):**
- Reverted ordering to `web,tv` — web client first (proven path,
  original behavior), TV as backup
- Rewrote the "zero formats" translator to acknowledge that GREEN
  validator + this error = hard-age-gated content YT refuses even
  to logged-in accounts. Don't blame the cookies when our own
  validator just said they're good.

**Lesson:** when adding extractor-args defaults, the safe default is
NEVER to put a new client first in the priority list. Always
append. The web client is yt-dlp's tested baseline; TV is good as
additive coverage but unreliable as primary.

**For the EqVkMLZv2RU video specifically:** even with the fix, this
particular video may simply not be downloadable through yt-dlp at
the moment. YouTube's hard-age-gate sometimes refuses formats even
to fully-verified logged-in accounts depending on region / account
age / watch history. Documented as a known unfixable upstream
edge case (yt-dlp issues #13445, #11296). Owner's escape hatch:
download in browser, drop file into Library folder.

---

## 2026-05-23 morning (RESEARCH, age-restricted YT) — cookies story diagnosed

Owner: "tried everything, downloading firefox, exporting the cookies on
the page, changing my account settings, nothing allows me to download
an age restricted video." Provided cookies.txt for inspection.

### Smoking gun: the cookies file has no YouTube auth

`grep .youtube.com cookies.txt` showed 8 entries, all anonymous:
`GPS`, `PREF`, `SOCS`, `VISITOR_INFO1_LIVE`, `VISITOR_PRIVACY_METADATA`,
`YSC`, `__Secure-ROLLOUT_TOKEN`, `__Secure-YNID`.

Missing (count = 0 on `.youtube.com`): `LOGIN_INFO`, `__Secure-1PSID`,
`__Secure-3PSID`, `HSID`, `SAPISID`, `SSID`, `SID`, `APISID`.

The owner DOES have full auth cookies on `.google.com` and
`.google.com.br` — but **YouTube specifically reads its session from
`.youtube.com`-scoped cookies, not Google-wide ones.** Being logged
into google.com is not the same as being logged into youtube.com from
yt-dlp's perspective.

### Why this happens

The file header says "generated by yt-dlp" — meaning it came from
`yt-dlp --cookies-from-browser firefox -o cookies.txt` (or equivalent
our app does). yt-dlp dumps everything Firefox has — but if the
Firefox profile in question has never been used to actually visit and
interact with youtube.com while logged in, Firefox doesn't have a
LOGIN_INFO cookie to dump.

Three plausible root causes for owner's case (one or more):
1. **Firefox profile is "fresh" for YouTube.** Owner installed
   Firefox recently for this purpose, signed into google.com, but
   never opened youtube.com in that Firefox window. → no LOGIN_INFO.
2. **YouTube rotated the cookies.** Issue #13863 confirms YT silently
   invalidates auth cookies; yt-dlp's own warning surfaces it as "The
   provided YouTube account cookies are no longer valid. They have
   likely been rotated in the browser as a security measure." Cookies
   that "worked yesterday" stop working after a few days.
3. **Firefox containers.** If the YouTube tab was opened in a
   Container (Multi-Account Containers extension), those cookies live
   in a separate jar that yt-dlp's bulk extract may miss.

### The current upstream story (researched 2026-05-23)

- **`--cookies-from-browser chrome` is dead** since Chrome 127 (mid
  2024) — DPAPI app-bound encryption. Known, documented in
  our Settings already.
- **`--cookies-from-browser firefox` works in principle** — Firefox
  stores cookies unencrypted in a SQLite db. Works IF the profile
  has a live YT session AND the cookies haven't rotated.
- **Manual `--cookies cookies.txt`** has the same limitation —
  whatever's in the file is what yt-dlp uses, and YT may have
  rotated it server-side already.
- **`--extractor-args "youtube:player_client=tv"`** is the current
  no-cookies workaround. The "tv" / "tv_simply" InnerTube clients
  enforce age-gate less strictly than the web client. Works for a
  significant subset of age-restricted videos without any login.
  Maintainer-blessed for soft-gated content; hard-gated (i.e.
  literally "adult" categorized) still requires real auth.

Sources researched:
- yt-dlp issue #13445 — closed as not planned (insufficient info)
- yt-dlp issue #13863 — confirms cookie rotation as YT's design
- yt-dlp issue #11296 — age-gated always-requires-signin canonical
- dev.to "6 ways to get YT cookies for yt-dlp in 2026, only 1 works" —
  Firefox is the surviving path; all 5 others (DPAPI, rookiepy, CDP,
  yt-dlp OAuth2, Google OAuth Bearer) are dead.

### What the owner can do RIGHT NOW (no app changes)

1. Open Firefox. Sign into youtube.com directly (not just google.com
   — actually click the avatar on youtube.com).
2. Play an age-restricted video in Firefox until the "Sign in to
   confirm" prompt appears, then click through it. This forces
   Firefox to write the `LOGIN_INFO` cookie.
3. Verify: in Firefox → Settings → Privacy → Manage Data → search
   "youtube.com" → there should be 15+ entries, not just 6-8.
4. Re-export with `Get cookies.txt LOCALLY` extension (NOT yt-dlp's
   own dump — the extension only dumps the currently open tab's
   site, which guarantees youtube.com cookies are included).
5. Or try the no-cookies path: yt-dlp manually with
   `--extractor-args "youtube:player_client=tv"` — works for many
   videos without any login at all.

### What we should add to Media Hub (sized + prioritized)

**1.0.3 candidates (cheap wins):**

a. **Default `--extractor-args "youtube:player_client=tv,web"`** to
   `yt_download` and `yt_fetch_metadata` args. The TV client tries
   first, falls back to web. This alone solves a chunk of the
   "cookies failed" cases without any user intervention. Risk:
   the TV client occasionally returns different formats than web —
   need to verify our format-picker still picks sensibly. ~30 min.

b. **Cookies validator** — in settings::cookies_args, when the
   user picks "from file," do a one-time scan of the file for
   `LOGIN_INFO` on `.youtube.com`. If absent, surface a warning
   chip in Settings → Sources with the "Re-export from a logged-in
   youtube.com tab" instruction. ~45 min.

c. **Improve error translator** for the specific case where
   age-gate hits despite cookies being supplied. Current translator
   handles the generic "Sign in to confirm" but doesn't differentiate
   "no cookies provided" vs "cookies provided but YT rejected them."
   The latter case should say "YouTube rotated your cookies — re-
   export from Firefox." ~20 min.

**1.x candidate (real fix):**

d. **"Test cookies" button** (was already 0.9 C.5 / 1.0 R.3) — runs
   `yt-dlp -j --simulate` against a known age-restricted reference
   URL. Reports the actual error. This is the diagnostic surface
   the owner needed today and would have saved this whole research
   pass. ~2 hr.

### Lesson for future cookies bugs

When a user says "cookies aren't working," the very first diagnostic
is "does the file contain LOGIN_INFO on .youtube.com." Everything
else flows from that. Three-line bash check:
`grep "\.youtube\.com" cookies.txt | grep -c LOGIN_INFO` — if 0, the
file is the problem, not yt-dlp.

---

## 2026-05-22 late (SHIPPED, 1.0.1 + 1.0.2) — cancel + the regression

**1.0.1 — cancel in-flight downloads.** Backed by a JobRegistry
holding CommandChild handles by job_id, plus a canceled-ids set so
the event loop can tell user-cancel apart from yt-dlp failure (both
exit non-zero). `yt_download_cancel(job_id)` looks up + kills.
Cancel button appears in queue rows during the `downloading` phase
and in the single-URL panel next to the progress bar.

Out of scope (deliberately): cancel during ffmpeg trim phase, cancel
during transcode, auto-cleanup of yt-dlp's leftover `.part` file.

**1.0.2 — fix the single-URL progress regression.** 1.0.1 started
tagging single-URL events with `jobId: "single-url"` so Cancel could
find them, but the single-URL progress listener had a long-standing
`if (e.payload.job_id) return;` filter (written to ignore queue
events). Listener filtered out its own events. Bar froze at "starting
download…" — exactly the failure mode from the *Windows progress
investigation* note further down this doc, but a totally different
root cause this time.

Fix: filter for "events that don't belong to this flow" instead of
"events that are tagged at all." Inline `1.0.1 regression note:` left
at the filter site to prevent future re-breaks.

**Lesson:** when adding any new tagged event source, audit every
listener's filter predicate. There's only one filter site for
progress today, but if a third flow ever joins, the predicate has to
become a positive allow-list (`jid === MY_FLOW_ID || !jid`) not a
negative reject-list.

---

## 2026-05-22 evening (TESTER FEEDBACK, MISSING FEATURE) — playlist downloading

**Tester ask:** support for YouTube playlist URLs. Right now if you
paste a playlist URL, yt-dlp will happily start downloading the
*entire* playlist as one giant job — single asset slot, no per-video
progress, no way to cherry-pick. That's worse than nothing.

**What we want:** paste playlist URL → fetch metadata for each
video → present as a multi-select list with thumbnails → user
checkboxes the ones they want → those flow into the queue as
individual jobs. Each job is a normal single-video download from
that point on (uses the per-video URL, not the playlist URL).

**Implementation sketch:**
- New Rust command `yt_fetch_playlist(url)` → runs
  `yt-dlp --flat-playlist -J <url>` (fast: doesn't pull formats,
  just enumerates). Returns Vec<PlaylistEntry { id, title,
  channel, duration_sec, thumbnail }>.
- Detect playlist URL in the single-URL field (`?list=` param,
  `/playlist?` path, or `&list=` after a watch URL). When detected,
  switch the panel from "single download" mode to "playlist
  selection" mode.
- New playlist-picker UI: thumbnail grid or list with checkboxes,
  Select all / Select none / Invert, optional "first N" quick-pick.
  Confirm button enqueues selected videos as individual queue jobs
  (each with its own real video URL).
- Fall-through: if yt-dlp can't enumerate (some channel-list edge
  cases), fall back to "treat as single URL" with a warning.

**Estimated effort:** 1-1.5 sessions. Backend ~45 min (single
command + serde struct), frontend ~1 hr (URL detect + picker UI +
queue-enqueue plumbing).

**Open questions to decide before building:**
- Should playlist enumeration also fetch full formats per video?
  (No — too slow. Enumerate flat, then each job fetches its own
  formats when it starts. Matches today's queue behavior.)
- What if the user pastes a playlist URL into the *queue* textarea
  (the one-URL-per-line batch input)? Auto-expand to individual
  jobs? Or treat as one job and let it fail loud? **Probably
  auto-expand** — feels less surprising. Confirm before building.
- Channel URLs (`/@channel/videos`) are basically infinite
  playlists. Cap at N (50? 100?) with "show more" or just disallow
  channel-wide bulk fetch entirely. **Lean disallow for 1.x** — the
  user's primary need is named playlists, not channel scraping.

**Target version:** 1.1 (the next *feature* milestone, after the
1.0.x patches settle).

---

## 2026-05-22 evening (TESTER FEEDBACK, v1.0.0) — three items from first tester pass

Owner relayed feedback from the first batch of testers on v1.0.0.
No crashes, no data-loss complaints. Three items worth tracking:

### 1. Missing: pause / stop in-flight downloads (feature gap, HIGH PRIO 1.0.x)

Today the queue has no cancel button. Once a download starts, the
user can only let it finish or kill the app. Real-world impact:
tester started a big download, realized it was the wrong URL, had
no recourse.

**Implementation sketch:**
- `yt_download` already spawns a `Child` via `tauri-plugin-shell`.
  Need to hold the `CommandChild` handle in a registry keyed by
  job ID so we can `.kill()` it on demand.
- New Rust command `yt_download_cancel(job_id)` → looks up the
  child, kills it, marks the queue row canceled, cleans up partial
  files.
- Queue card UI gets a Cancel button on in-flight rows (X icon,
  red on hover).
- Batch path same shape — need per-job cancel + maybe "cancel all".

**Estimated effort:** 1 session. Backend ~1.5 hr (child registry +
cancel cmd + partial cleanup), frontend ~30 min (button + event).

### 2. Missing: Eagle-style library settings (1.2 territory, but testers asking)

Tester comment hinted at wanting folders / color labels / better
filters in the library. This is already documented as **1.2 Eagle
overhaul** in ROADMAP — don't pull it forward yet. But it's the
first organic signal that the deferred milestone is actually
wanted, not just speculation.

**Lighter-weight stop-gap (consider for 1.0.x):**
- The "better library filters" item already in NOTES (sort by
  recent / name / size / duration) is the cheap subset of what
  Eagle gives you. Could ship that as 1.0.1 to take the edge off
  while the full overhaul waits.

**Decision pending:** ship filters-only as 1.0.1, or hold the line
and do the full 1.2 overhaul together? Ask owner.

### 3. UX surprise (possible bug?) — delete-project moves clips to library

**Tester report:** "downloaded something on a project, deleted the
project and went to library [and the clip was there]."

Reading the report literally: this is **documented behavior**.
`Projects.tsx` comment: "deleting a project sets its assets'
project_id to NULL, returning them to the Library — files on disk
stay put." The confirm dialog in `del()` does say "X clips will be
moved back to the Library. Files on disk are not deleted."

So the question is whether this was:
- **(a)** The tester didn't read the confirm and was surprised
  by the documented behavior. → UX polish, not bug.
- **(b)** The tester expected "Delete project" to also delete
  the clips (and was complaining about finding them in Library). →
  the **Finish** action with the trash-everything path was probably
  what they wanted; Delete's "salvage clips" intent isn't obvious.
- **(c)** Something actually broke and the clips ended up in the
  wrong place / state. → real bug, need repro.

**Next-session action:** ask owner to ask the tester to clarify
which of (a) / (b) / (c) it was. If (b), the fix is UX copy in the
Delete confirm dialog ("→ Will keep clips in Library. To trash
clips too, use Finish project instead.") plus maybe an extra
button on the dialog for "Delete and trash clips."

---

## 2026-05-22 PM (BUG, target next session) — Settings page layout glitch on jog-sensitivity click

**Owner repro (2026-05-22 PM):** "When i clicked to change jogger's
sensitivity, the whole page glitched and i had to reset the app, only
settings page was left on the sidebar and there was a weird black box
underneath the page, still happening."

**Screenshot evidence:** TopBar entirely missing. Nav reduced to just
the "System / Settings" item — Workspace section (Download / Library
/ Projects) gone. Settings content renders OK (Coarse · 0.5× is the
active selection, so the save worked).

**Reproducibility:** persistent ("still happening"). Owner restarted
the app and it returns.

**Hypotheses (untested):**
1. CSS / layout collapse triggered by the new settings-row I added.
   The row has label + radio-group + hint, similar to existing rows
   that work. **Lowest probability.**
2. Settings provider context broadcast triggering a Suspense
   re-mount of a lazy chunk (the App.tsx OnboardingGate is lazy,
   pages are lazy via App.tsx). If a chunk fails to load on the
   re-render, the Suspense fallback renders and could explain a
   "black box." Investigate.
3. The `settings:changed` event firing from save → triggering
   listener → triggering re-fetch → triggering re-render of every
   useSettings consumer → some component fails to re-render
   correctly with the new value. Untested.
4. The save itself produces a Settings value that breaks
   deserialization on round-trip (e.g. f32 sensitivity gets sent
   as integer 0 vs 0.5). Less likely — JSON should preserve.

**Next session actions:**
- Ask owner to re-share screenshot + DevTools Console output (any
  errors? React warnings?) when the glitch is active
- Inspect DOM at the glitch moment (right-click → Inspect)
- Check if reverting just the Scrubber jog Settings UI restores
  the layout (process of elimination)
- If a fix isn't fast: REVERT just the radio onChange handler to
  not call save directly, and re-think the Settings UI shape

**Priority:** HIGH — first thing next session.

---

## 2026-05-22 PM (UX, target 0.9.D) — Delete file confirmation feels weak

**Owner note:** "We need a confirmation popup when clicking delete
file ahahha"

**Current state:** `deleteFromDisk` on both the AssetDrawer and the
new context menu has TWO sequential `confirm()` calls:
  1. "Delete '<title>' from disk? This removes the file at..."
  2. "This cannot be undone from inside Media Hub. Proceed?"

**Two interpretations of the owner's note:**

**A. The confirms aren't firing.** Possible cause: the context menu's
`withClose()` wrapper closes the menu BEFORE the action runs. If
something about the unmount timing is suppressing the confirm
dialogs, the file would just get deleted with no prompt. Should
investigate — easy fix is to invert the order (run action first,
THEN close).

**B. The confirms are firing but feel weak.** Native browser
confirm() dialogs look generic and aren't very "scary." A custom
in-app modal with a clearer destructive treatment would feel more
deliberate. Eagle-like apps use a "type DELETE to confirm" pattern
for irreversible actions.

Next session: ask owner which interpretation matches their
experience. Most likely it's (A) — the menu closes too fast and the
confirm is skipped. Worth a quick fix either way.

---

## 2026-05-22 PM (FEATURE, target 1.x) — Audio-only download (MP3/M4A)

**Owner note:** "We need a audio only download, download only the
mp3 option and need to think how to show this on the library as
well."

**Mechanics:** yt-dlp already supports this via `-x` /
`--extract-audio` flag. Plus `--audio-format mp3` for MP3 specifically
(requires ffmpeg, which we ship). Common options: mp3, m4a, wav,
flac, opus.

**UI design needed:**
- Single-URL Download page: a "Type" toggle near the format picker:
  Video / Audio only. When Audio is selected:
    - Format list filters to audio-only rows
    - Transcode preset dropdown becomes "MP3 / M4A / FLAC / no
      conversion"
- Batch queue: same toggle at the queue level

**Library implications:**
- Asset cards for audio files need a different visual treatment —
  no thumbnail to extract from, no width/height to display
- Could show a waveform image (ffmpeg can generate static
  waveforms) for visual identity
- Card "duration" stays meaningful; resolution should hide
- Filter facet for "Audio only" / "Video only" in the sidebar
- Search results should mix both unless filtered

**Effort:** ~2 sessions for the feature + UI.

**Target:** 1.x (post-1.0). It's a real feature, not polish.
Architecturally clean — extends the existing format picker without
disrupting the video path. Worth a real session.

---

## 2026-05-22 (parked, target 0.9.D follow-up or 1.x) — Better library filters

**Owner note (2026-05-22 PM):** "We need better filters on library
later, order by most recent, name etc... but thats for later just
note it."

**Current state:**
- Sort: hardcoded `ORDER BY downloaded_at DESC` in library_list.
  No user control.
- Sidebar facets: Source / Tags / Added (now / today / week / month
  / older) / can filter but can't change sort.
- Search: title + channel LIKE only.

**What "better filters" probably wants:**
- **Sort dropdown** at the top of the library: "Newest first"
  (default), "Oldest first", "Title A→Z", "Title Z→A",
  "Largest first", "Channel A→Z", "Duration: longest first".
- **Composable filter chips** showing in the toolbar so the user
  can see what's active without scanning the sidebar.
- **"Save this filter" → smart folder** — Eagle-style. Pairs with
  the 1.2 Eagle overhaul.

**Implementation sketch:**
- Add `sort: SortField + direction` to LibraryFilters
- Backend builds the ORDER BY from the enum
- Frontend adds a dropdown next to the search box
- Persist last sort to settings.json (sticky like format)

**Effort:** ~1 hr for sort dropdown. Multi-column sort + smart
folders is bigger (1.2 territory).

**Target:** Pull into a 0.9.D follow-up if time allows, otherwise
1.1 alongside the URL-protocol handler and drag-to-NLE polish.

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

---

## 2026-05-24 (PM) — 1.1.1: Tags split + Sort + press-T picker + drag-to-folder

Continuation of the 1.1 Eagle pass. User came back next morning with four
items; all shipped same session.

### What landed

1. **Toolbar split.** `Filter` button now shows only Source + Added (Tags
   section removed from its popup). New `Tags` button beside it owns the
   tag filter in its own popup. New `Sort` button beside that.

2. **TagFilterPopup** — two-column Eagle-style chrome. Left rail with
   virtual sections `Selected (N)` / `All Tags (N)`; right pane has a
   search bar + checkbox-row list with counts. Anchored under the Tags
   button. We chose flat tags (no `tag_categories` schema) — leaves
   "Untagged" as a future filter dimension (needs backend query change).

3. **SortPopup** — 8 modes (Most recent / Oldest / Name A→Z / Z→A /
   Largest / Smallest / Longest / Shortest). Client-side `useMemo` on
   the filtered list. Default = Most recent = matches the backend's
   `downloaded_at DESC` so first paint already correct.

4. **Press-T tag picker (TagPickerPopup)** — distinct from the filter
   popup. Floats near cursor when T is pressed with selection ≥ 1.
   - Search field. Enter on a no-match query → `+ Create "xyz"` row →
     creates + applies the tag in one shot.
   - Sections: `Recently used` (last 8, persisted in `localStorage` via
     `bumpRecentTags`) + `Others`.
   - Tri-state per tag for batch selection: ✓ (all have it), – (some,
     partial), blank (none). Click toggles; partial resolves to add-to-all.
   - Mutates via N parallel `tag_set_for_asset` calls (no batch Rust cmd
     yet — fine for typical selection sizes; cheap follow-up).

5. **Drawer tag editor restored.** `<TagEditor>` back in `InspectorSingle`
   below Folder section. The legacy `_AssetDrawerLegacy` stays in the
   tree (voided) as a future port source for the project-mover bit.

6. **Batch tag editor** in `InspectorBatch`. Shows tags shared by ALL
   selected as removable chips + `+ tag to all`. For partial-state add /
   remove (some have / some don't), the inline hint nudges to press T.

7. **Hint bar** — added `t tag selected` between `esc clear` and `⏎ open`.

8. **Internal drag-to-folder.** HTML5 drag/drop. Cards are `draggable`
   with a custom `application/x-media-hub-asset-ids` MIME payload.
   Folder rows accept the drop and call `asset_set_folder_many`. Selection
   rule mirrors Finder: dragging a card already in the selection drags
   the whole selection; dragging a non-selected card swaps selection to
   just that card. Lime dashed `drop-hover` outline highlights the target.
   "All clips" is intentionally not a drop target (ambiguous).

### Bugs hit + fixed

- **Press-T popup reopening "by itself"** at the original cursor position
  after closing via outside-click + clicking any card. Couldn't reproduce
  remotely but defensive-fixed with three guards:
  - 300ms reopen-debounce after close (`tagPickerClosedAtRef`)
  - T while popup already open → no-op (was teleporting position)
  - Explicit `document.activeElement?.blur()` on close (clears stale focus)
  - LibCard `<button>` got `type="button"` (was defaulting to `submit`)

- **TS6133 unused `addSet`** in `applyTagDelta` — caught by tsc, killed.

### Tauri-plugin-drag research (the drag-out-to-NLE story)

User asked for drag-to-folder AND drag-to-editor (Premiere/Resolve/etc.)
in one gesture. Researched the plugin landscape:

- **Plugin**: `@crabnebula/tauri-plugin-drag` v2.1.0 (npm) + matching
  Rust crate `tauri-plugin-drag`. Tauri 2 compatible. Crab Nebula
  maintained (commercial Tauri team), not official-`tauri-apps`.
- **Cross-platform**: Windows + macOS + Linux (GTK).
- **API** (from the actual unpacked TS types):
  ```ts
  startDrag(options: { item: string[] | {data, types}, icon: string, mode?: "copy"|"move" },
            onEvent?: (p: { result: "Dropped"|"Cancelled", cursorPos: { x, y } }) => void)
  ```
- **Critical unlock**: `cursorPos` in the callback. Lets us hit-test the
  drop position against folder DOM rects on the JS side. That means a
  SINGLE drag gesture handles BOTH internal (folder drop) AND external
  (drop on Premiere/Resolve) — no Alt-modifier needed.
- **Custom payload door**: `item` accepts not just `string[]` of paths
  but also `{ data, types }` for MIME payloads — e.g. `com.apple.finalcutpro.xml`
  for FCPXML. Means a future feature can ship pre-cut timeline clips
  (using our existing in/out segment data) instead of plain files. Big
  future workflow win for NLE users; **not** shipped today.
- **Mode**: use `"copy"` so drops to NLE don't try to move the source
  file out of the library.

### Wired-up design (the "Option α" we picked)

- `onDragStart` on LibCard:
  - Build list of file paths from selection (or just this card)
  - Build preview icon path = first asset's `thumbnail_path`
  - Call `startDrag({ item: paths, icon, mode: "copy" }, onDropCallback)`
  - `ev.preventDefault()` the HTML5 drag (Tauri takes over)
- `onDropCallback`:
  - If `result === "Cancelled"` → no-op
  - Else use `document.elementFromPoint(cursorPos.x, cursorPos.y)` to
    walk up looking for `.lib-folder` (read `data-folder-id` attr)
  - If found → call `asset_set_folder` / `_many` with that folder id
  - If not found (dropped outside window or on empty grid) → OS already
    handled the OS-level drop (Premiere etc. received the files)
- Removed the prior HTML5 `onDrop` on folder rows (won't fire once Tauri
  startDrag is in effect). Kept `data-folder-id` attr for hit-testing.

### Lessons logged

- **`type="button"` on `<button>` is non-optional.** Defaulting to
  `submit` plus mysterious focus retention on Windows could be the
  perfect storm for "ghost reopens" of context popups. Belt-and-
  suspenders: always set it explicitly.

- **Don't trust the abstract API — unpack the tarball.** I almost
  shipped "single-gesture is too complex" advice based on README skims.
  The real `index.d.ts` showed `cursorPos` in the callback, which made
  the whole thing simple. Lesson: 5 minutes with `npm pack` + `tar tzf`
  beats 30 minutes of docs grep.

- **Custom MIME payloads in drag.** Tauri's drag plugin supports it.
  This is the door to FCPXML / Premiere / DaVinci timeline-aware drops
  in the future. Worth a roadmap entry.

- **Mode = "copy" for library-as-source apps.** Anything where the
  library file is canonical (and the editor is a downstream consumer)
  wants copy mode. Move mode would let the editor steal the file.

### Follow-up bugs caught after first test (same PM)

- **`tagPickerPos` "ghost reopen" bug — actually diagnosed by the user.**
  Render gate was `{tagPickerPos && selection.size > 0 && ...}`. When
  the user pressed Esc, the page-level Esc handler cleared selection,
  which made `selection.size > 0` flip false BEFORE the popup's own
  Esc handler (which calls onClose → clears tagPickerPos) ran. Result:
  popup unmounts without onClose, `tagPickerPos` stuck non-null. Next
  card-click → selection > 0 again → BOTH gates true → popup re-renders
  at the cached cursor position. Fixes:
  1. Render gate is now `{tagPickerPos && ...}` only (no selection check)
  2. Page-level Esc EARLY-RETURNS when `tagPickerPos` is non-null, so
     the popup handles Esc and the selection is preserved through close
  3. Popup self-closes via a `useEffect([selection.length])` if selection
     drops to 0 from another path (e.g. bulk delete), guaranteeing
     onClose runs and tagPickerPos is cleared
  Lesson: **never gate a popup's render on two independent states.**
  If you must, ensure the SAME action that flips one ALSO clears the
  other.

- **Internal drag-to-folder did nothing while external worked.**
  Root cause: `cursorPos` from `tauri-plugin-drag`'s callback is the
  OS screen position (logical pixels), but `document.elementFromPoint`
  wants VIEWPORT (client) coords. They differ by the window's frame +
  title bar offset. External drops worked because we skipped hit-test
  in that branch. Fix: convert at drop time —
  ```ts
  const innerPos = await getCurrentWindow().innerPosition(); // physical px
  const dpr = window.devicePixelRatio || 1;
  const viewportX = cursorPos.x - innerPos.x / dpr;
  const viewportY = cursorPos.y - innerPos.y / dpr;
  ```
  Lesson: any time a Tauri plugin returns "position" without saying
  WHICH coordinate space, assume OS-screen and convert before passing
  to DOM APIs. Single sentence in docs.rs would've saved a round trip.

- **Drag fix v3 — Windows OLE doesn't surface live enter/over events
  for self-initiated drags.** Switched the primary signal to Tauri's
  own `webview.onDragDropEvent` (gives window-relative physical
  pixels, handles the own-window-drop-reports-as-Cancelled case
  naturally), with the plugin's `cursorPos` as a multi-coord fallback.
  But on Windows, only the `drop` event fires reliably for self-drags
  — enter/over don't. Two consequences:
  1. **Can't show live folder-hover highlight during drag on Windows.**
     Tried it; no events fire to drive the state. Replaced with a
     static `lib-drag-hint` in the sidebar ("Drop on a folder to move
     N clips") that shows while drag is active. More honest UX than
     a flickering or absent outline.
  2. **`drop` event arrives AFTER the plugin callback in race-y
     fashion.** Setting `folderDropHover` on `drop` left the dashed
     outline STUCK because the callback's prior cleanup already ran.
     Fix: on `drop`, ONLY record position for hit-test; explicitly
     clear hover. Highlight is now exclusively driven by enter/over
     (which only fire on non-Windows / on external drags coming in).
  Lesson: **never let a delayed event set "active" state.** Delayed
  events should only clear state or perform terminal actions — never
  reinitialize a UI mode the user is no longer in.

---

## 2026-05-24 (PM) — preview/playback + FCPXML research

User asked: is FCPXML worth shipping? Only if we have an *in-app
preview good enough to trim against*. Below is the menu of preview
approaches researched, ranked by effort.

### The four-tier menu

**Tier 0 — HTML5 `<video>` (free, ship today).**
- WebView2 ships a hardware-accelerated H.264/AAC decoder. So does
  WebKit (macOS) and WebKitGTK.
- For every clip whose container is mp4/m4v with h264+aac: just
  `<video src={convertFileSrc(file_path)} controls />` works out of the
  box. Frame-accurate seek, paint quality on par with the source.
- Codec landmine: HEVC (h265), AV1, VP9 (without IVF/WebM container),
  ProRes, DNxHR — none are decoded by WebView2 reliably. Tauri uses
  the system's WebView, so support varies by Windows version + codec
  pack install state.
- For 80%+ of YouTube downloads, this is fine — yt-dlp's default
  format selection prefers h264 wherever it can. The other 20%
  (HDR, HEVC, AV1 modern formats) will show "format not supported"
  in the player.
- **Effort: 1 hour. Reward: probably 80% of users get great preview.**

**Tier 1 — Sprite-sheet hover scrub (cheap, ffmpeg-only, the Eagle move).**
- Pre-generate a horizontal strip of N thumbnails per clip via ffmpeg:
  ```
  ffmpeg -i input.mp4 -vf "fps=1/<duration/40>,scale=240:-1,tile=40x1" sprite.jpg
  ```
  → one 40-tile sprite, ~80 KB per clip.
- On hover over a card, map cursor X across the card → which tile to
  show via CSS `background-position-x`. Pure CSS, no JS animation.
- Eagle, Bridge, Premiere's media bin, Resolve's media pool — all
  use this exact trick.
- I-frame-anchored (`-skip_frame nokey`) sampling makes it fast even
  on long clips. ~1–3 sec per clip to generate; runnable in the same
  background pass as the thumbnail backfill we already have.
- **Effort: 4–6 hours (ffmpeg cmd + storage + card hover + CSS).**
- **Reward: feels magical. Already trusted by every pro DAM tool.**
- **Doesn't enable trimming yet** — no in-point/out-point UI here,
  just scrub-to-preview. But it's the GATEWAY UX for "yes, I can
  trust this enough to cut blind."

**Tier 2 — H.264 proxy files (medium, ffmpeg-only).**
- For every clip, generate a low-bitrate H.264/AAC mp4 sidecar:
  ```
  ffmpeg -i input.mov -c:v libx264 -crf 28 -preset fast -vf scale=640:-2 \
         -c:a aac -b:a 96k -movflags +faststart proxy.mp4
  ```
- ~30 MB per minute of source. ~10–60s to encode per clip (one CPU
  core; can parallel with our concurrency limit).
- Plays in `<video>` for ALL clips regardless of source codec — fixes
  the Tier 0 codec landmine.
- Trim UI then becomes free (we already built the scrubber for
  download-time segment selection — same component, reused).
- **Storage cost:** noticeable. 1000 clips × 60 sec avg × 30 MB =
  ~30 GB. Make it opt-in via Settings ("Generate proxies for editor
  preview"), with a setting for proxy resolution (480p/720p) +
  proxy CRF.
- **Effort: ~1 day** (background job system, settings UI, retry on
  failure, GC when source goes missing).
- **Reward: full in-app editing feasible. FCPXML is now justified.**

**Tier 3 — embedded libmpv (heavy, decode anything).**
- Plugins exist: [tauri-plugin-mpv](https://github.com/nini22P/tauri-plugin-mpv),
  [tauri-plugin-libmpv](https://github.com/nini22P/tauri-plugin-libmpv),
  [tauri-plugin-videoplayer](https://github.com/yeonv/tauri-plugin-videoplayer).
- libmpv ≈ 70 MB DLL on Windows. Major installer size hit.
- Plays everything: HEVC, ProRes, DNxHR, AV1, VP9 — full ffmpeg
  decoder set.
- Renders to a NATIVE window layer (not WebView), so it floats above
  / below our React UI rather than being embedded inline. Doable
  with frame-position tracking but fiddly.
- **Effort: 2–3 days, plus ongoing maintenance burden.**
- **Reward: zero-codec-friction preview. Pro NLE-level fidelity.**
- **Recommendation: defer until a user can articulate "I keep
  downloading HEVC and can't preview it."** Not today.

### FCPXML feasibility, viewed from the preview question

FCPXML payload (via `tauri-plugin-drag`'s `item: { data, types }`):
- DaVinci Resolve: accepts FCPXML v1.10 (full clip + timeline + marker
  support).
- Final Cut Pro: native, of course.
- Premiere: does NOT accept FCPXML directly. Would need PPRO XML
  generation OR convert via DaVinci → XML round trip. Skip Premiere
  for v1.
- After Effects: doesn't ingest XML at all.

Generating FCPXML for our model:
- We already have everything: file_path, in/out segments (sibling
  asset rows from multi-segment downloads), title, duration, FPS,
  resolution. The XML is ~30 lines per clip, templatable.
- The hard part isn't the XML — it's getting the user to TRUST the
  in-app trim. That's the preview question.

### Recommendation (decision delivered to user)

**Skip FCPXML for now. Ship Tier 1 (sprite-sheet hover scrub) next
month as a low-risk crowd-pleaser.**

Reasons:
- Tier 1 already solves 90% of the "which clip is this?" problem
  users actually hit. Hovering a 40-thumbnail strip is faster than
  any video preview anyway.
- It builds confidence in the library as a *visual* index. That's
  the prerequisite for asking users to cut inside.
- The path forward is now: **Tier 1 → Tier 2 (proxies) → FCPXML drag**.
  Each step is independently valuable; if we stop at Tier 1, users
  still got a big upgrade.
- Tier 0 is so cheap (HTML5 `<video>` in the inspector) we can ship
  it alongside Tier 1 with no extra cost. Compatible clips get
  full playback; incompatible ones still get the sprite scrub.

### Storage budget reality check

A 1000-clip library:
- Tier 0: zero added storage
- Tier 1: 1000 × 80 KB = ~80 MB sprites. Negligible.
- Tier 2: 1000 × 30 MB proxies = ~30 GB. Real cost — opt-in setting.
- Tier 3: + libmpv DLL ~70 MB per installer; no per-clip cost.

### Lessons logged

- **Don't build the trim UI without preview confidence.** FCPXML is
  the *output format*; preview is the *trust input*. Order matters.
  We'd have spent a week on FCPXML for users who can't tell which
  clip they're looking at without opening it in their editor first.

- **Sprite sheets > video for hover-scrub UX.** Industry has converged
  here for a reason — load-once, no decode, no buffer, no ffmpeg-on-
  demand. The "preview that feels instant" is always a precomputed
  image, never a real-time decode.

- **WebView2 codec support is a moving target.** It improves with
  every Windows Edge update but is never the full ffmpeg set. Plan
  for "most clips work, some don't" — never assume H.265/AV1 will
  decode in production.

Sources:
- [Sprite-sheet generation with ffmpeg](https://steelcm.com/blog/generating-video-sprites-using-ffmpeg/)
- [Mux: extract thumbnails with ffmpeg](https://www.mux.com/articles/extract-thumbnails-from-a-video-with-ffmpeg)
- [tauri-plugin-mpv (nini22P)](https://github.com/nini22P/tauri-plugin-mpv)
- [tauri-plugin-libmpv (nini22P)](https://github.com/nini22P/tauri-plugin-libmpv)
- [tauri-plugin-videoplayer (YeonV)](https://github.com/yeonv/tauri-plugin-videoplayer)


### Cut (decided no)

- Dark mode toggle — we're dark, OS-inherit, no work needed

---

## 2026-05-25 — 1.1.3 → 1.1.6: state-survives-nav + the CloseGuard saga

Big morning. Tester report: "downloads disappear when I switch pages,
then ffmpeg eats CPU after closing." Two structural fixes + one
upstream Tauri bug that ate four version bumps.

### What landed (the structural wins)

**`src/lib/downloads.tsx` — DownloadsProvider** (mounted at App.tsx
level, above the Router). Owns:
  - `queueJobs[]` (was QueueCard local)
  - `singleDownload` (was MetadataCard local)
  - The download:progress + transcode:progress event listeners
    (attached ONCE at mount, survive every route nav)
  - The workerLoop + concurrency semaphores
  - The single-URL download/transcode/library-record pipeline
  - `activeCount`, `enqueueUrls`, `startSingleDownload`,
    `cancelQueueJob`, `cancelSingleDownload`, etc.
QueueCard + MetadataCard became thin presenters. Unmount no longer
loses anything.

**Keep-alive page Shell.** Switched from React Router's mount-on-match
to a "render all visited pages, hide non-active via `hidden` attr"
pattern. Pages mount on first visit, stay mounted forever. Form state,
scrubber video, library scroll + filters all persist across nav.
RAM cost: ~50 MB worst case (Library grid + Download scrubber); free
on any desktop. App.tsx routes only `/` → HomeRedirect; everything
else goes to Shell which owns visibility via useLocation.

**Topbar `ActivityBadge`.** Shows a pulsing lime chip with
"N downloading" whenever `activeCount > 0`. Always visible, always
truthful. Click → jumps to /download.

**`OrphanScanner`** + Rust `library_scan_orphans` /
`library_clean_orphans`. On boot (3s after mount), scan
`Library/raw` + `Projects/*/raw` for `.part`, `.ytdl`, `.tmp`, and
yt-dlp `.f<id>.<ext>` intermediates older than 5 min. If found, show
a confirm: "Found N partials (X MB). Move to Recycle Bin?" Uses the
`trash` crate — recoverable.

**Drag-feedback session gate (1.1.3 retry).** Added
`dragSessionActiveRef`. Open on drag start, close in the plugin
callback (synchronously, before any setState). The
`onDragDropEvent` handler bails on any event arriving when the
session is dead — defends against Windows OLE firing a late `over`
after `drop` that was re-setting `folderDropHover` and leaving the
dashed outline stuck. **Not user-verified yet — testers were busy
with the close bug.**

### The CloseGuard saga (1.1.3 → 1.1.6, four installer bumps)

Designed: intercept window close, kill child processes cleanly so
no orphan ffmpeg eats CPU. Symptom across all four versions:
**clicking X did nothing.** Bounced through:

- **1.1.3:** confirm dialog before quit. User missed it (focus stolen
  / behind window). Plus listener re-bound on every progress tick
  from deps array, accumulating stale closures.
- **1.1.4:** dropped dialog, used `stateRef` for fresh state,
  subscribed once. Still broken. Theory: `async` handler returns a
  Promise that Tauri holds pending.
- **1.1.5:** switched to sync handler with fire-and-forget cleanup.
  Still broken. Clean release build, no HMR ghosts. Out of theories.
- **1.1.6:** searched upstream → found [Tauri bug #7119](https://github.com/tauri-apps/tauri/issues/7119) —
  **calling `unlisten()` on an `onCloseRequested` handler permanently
  breaks window closing.** React.StrictMode double-invokes effects
  in dev (cleanup → re-register); my `if (cancelled) fn()` race
  branch could fire even in prod. **Either path triggers the
  upstream bug.** Fix: don't register the listener at all. CloseGuard
  fully removed. OrphanScanner-on-boot is the safety net for partial
  files; child processes self-terminate within minutes when their
  stdout pipes break. User-verified: close works.

### Lessons logged

- **`unlisten()` on `onCloseRequested` is a Tauri 2 trap.** Even one
  unlisten call (cleanup, race branch, anything) permanently breaks
  window close. Workaround: don't register the listener. If you
  MUST register, never unsubscribe — even on unmount.

- **Search upstream issues BEFORE iterating on handler shape.** I
  spent 3 version bumps + 3 build cycles trying different ways to
  shape the handler (dialog/no-dialog, async/sync, refs/no-refs).
  All wrong. 5 minutes of `WebSearch "tauri v2 onCloseRequested
  handler does nothing"` would have surfaced bug #7119 immediately.
  New rule: **before fix attempt #2, grep the upstream tracker.**

- **React.StrictMode + native event listeners = trap.** StrictMode
  intentionally double-invokes useEffect in dev to catch leaks. For
  pure React state that's fine; for native listeners registered
  through async-await with a cleanup that calls unlisten, the
  cleanup-then-re-register cycle can trip platform-specific bugs.
  Either suppress StrictMode for affected effects, or use
  register-once-never-cleanup patterns.

- **Keep-alive Pages is a huge UX win + small RAM cost.** Should
  have done this from day one. Form state preservation is something
  users only notice when it BREAKS (which our tester did, brutally).

- **State-in-context vs state-in-component is a structural decision,
  not a refactor.** Single-URL download had been local-state since
  0.2. Moving it to context took ~3 hours. Worth every minute.
  Rule: **if it survives navigation in the user's mental model, it
  must live above the router.**

### Open follow-ups

- Drag-feedback session-gate fix is in code but user hasn't verified
  (the close bug ate their entire test window). Re-test next session.
- Auto-updater (tauri-plugin-updater) is a natural follow-up now
  that we're cutting installer-per-fix. ~half day to wire.
- JDownloader-as-secondary-source via MyJDownloader API (~1 day)
  was discussed but not committed — user wants to "sit on it." Pin
  for later.
