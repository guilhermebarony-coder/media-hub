# Media Hub — Improvement Audit (perf · bloat · editor workflow)

Status: audit, written 2026-06-13 (post-1.9.0). A scan of the codebase
plus references from current asset-manager / NLE / downloader tools, for:
(1) things we can do faster, (2) bloat to trim, (3) editor-workflow
features that would actually save time. Prioritized at the end.

First, credit where due — a few things are already done *well* and should
NOT be "fixed":
- `library_list` is **two queries total regardless of asset count**
  (`load_tags_for` batches tags by id list — library.rs:436) — no N+1.
- Library refresh is **event-driven** (`library:changed`), not polling.
- The per-site cookie + Deno JS-runtime + consent stack (1.7–1.9) is
  solid and current with yt-dlp 2025.11+ reality.
- WAL + busy_timeout on SQLite; downloads survive route nav.

---

## 1. Performance

### 1.1 Downloads are deliberately throttled to ONE fragment ⚠️ (biggest perf win) — ✅ DONE v1.10.0
**Shipped 2026-06-13.** Bumped to `--concurrent-fragments 4` + parse
yt-dlp's `--newline --progress-template` for speed/ETA. Kept the
filesystem poll as the (cumulative, monotonic) byte/percent source +
fallback — see NOTES.md v1.10.0 for the hybrid-emitter rationale.

`yt_download` passes **`--concurrent-fragments 1`** (lib.rs:941) on
purpose — so the filesystem `.part`-polling progress (every 500ms) has
discrete checkpoints. The cost: **multi-fragment / HLS / DASH downloads
run far slower than they could** (yt-dlp defaults aside, 4–8 concurrent
fragments is typically 2–5× faster on segmented sources, which is most
of YouTube/Twitter now).

**Fix:** stop polling the filesystem; parse yt-dlp's own progress via
`--progress-template "...%(progress._percent_str)s..."` + `--newline`,
then bump `--concurrent-fragments` to 4–8. Net: faster downloads *and*
more accurate progress (bytes from yt-dlp, not file stats). Removes the
fragile "Python block-buffering" workaround the current code fights.

**De-risked 2026-06-13 (CLI smoke test, no app code touched).** The old
code comment blames PyInstaller stdout block-buffering for going to
filesystem polling — but that does NOT reproduce with the current frozen
binary once `--newline` is added. Ran the bundled `yt-dlp.exe` with
`--newline --progress-template` and timestamped every output line:
- Format 18 (single file): progress streamed live across the full 17s
  download (0%→8.5%→44%→81%→100%), not bunched at the end.
- Format 136 + `--concurrent-fragments 4`: also live AND monotonic
  (0%→19%→39%→76%→100% with real byte counts).
So the rewrite is safe; `--newline` is the key ingredient the earlier
attempt likely lacked. Keep filesystem polling as a fallback path.

### 1.2 No external downloader (aria2c) — ✅ DONE v1.10.0
**Shipped 2026-06-13.** Added the `use_aria2c` opt-in toggle (Settings →
Downloads → "Fast downloads"). NOT bundled as a sidecar (no static mac
arm64 build → would break `externalBin` mac CI; also avoids ~3 MB on
every bundle/update) — lazy-downloaded to `<app_data>/bin` on first
enable instead (Windows only for now; mac degrades gracefully). See
aria2.rs + NOTES.md v1.10.0.

For HLS/DASH and big files, `--downloader aria2c -N 16` is the single
biggest real-world speedup yt-dlp offers (parallel connections). We
already bundle binaries; an optional aria2c sidecar (~5 MB) with a
Settings toggle would dramatically speed large B-roll pulls. Pairs with
1.1.

### 1.3 yt-dlp cold-start per fetch
Every metadata fetch / download spawns the frozen PyInstaller yt-dlp
fresh (~0.5–2s unpack tax, worse on macOS — see the tester report).
Hard to fully fix (yt-dlp isn't a daemon), but mitigations:
- **Reuse one metadata call** where we currently make two (e.g. fetch +
  later resolve). 
- For batch/queue, we already spawn per item — consider a **single
  `yt-dlp -J` for a batch of URLs** instead of N processes.
- Cache `-j` metadata briefly (per URL, 5 min) so re-fetching the same
  link (paste → preview → tweak format) doesn't re-spawn.

### 1.4 Thumbnail/waveform = one ffmpeg spawn each, on the main flow
Fine at one-per-asset, but for a **bulk import** (watch folder, see 3.2)
that's N sequential ffmpeg spawns. Batch them with a small worker pool
(respect `download_concurrency`).

---

## 2. Bloat

### 2.1 ~322 MB of bundled sidecars — shipped in EVERY auto-update ⚠️ (biggest weight win) — ✅ DONE v1.12.0
- `ffmpeg` **202 MB**, `deno` **101 MB**, `yt-dlp` 18 MB.
- They're bundled into the installer **and** the updater artifact, so
  **every 1.x→1.y auto-update re-downloads ~322 MB.** That's the single
  worst weight problem and it grows with each release.

**DONE (v1.12.0): lazy-download on first run.** ffmpeg + deno now download
to `<app_data>/bin` on first launch via `tools.rs` + a `ToolsGate` setup
screen (verified 2026-07-04). Only yt-dlp stays bundled. Installer ~140 MB
→ ~40 MB; auto-updates no longer re-ship the engines. See NOTES 2026-07-03.

### 2.2 ffmpeg is the full BtbN GPL static build (202 MB) — ✅ mostly moot after 2.1
ffmpeg is no longer in the installer at all (2.1). If we ever want the
first-run *download* smaller too, a custom-stripped ffmpeg (~30–60 MB vs
the full n7.1 GPL build) is the lever — lower priority now that it's not
shipped in every update.

### 2.3 deno 101 MB just to solve JS challenges — ✅ moot after 2.1 (still an option to shrink first-run)
deno is lazy-downloaded now (2.1), so it's off the installer. A future
spike could swap it for **QuickJS** (~1 MB, yt-dlp supports it) to shrink
the first-run download further, but no longer urgent.

### 2.4 `Library.tsx` is 5,004 lines; `library.rs` 2,978; `lib.rs` 2,497 — 🟡 PARTIAL (Rust banked v1.12.x)
**Rust side substantially done (2026-07-04).** `lib.rs` 3325 → 1966 (−41%)
across 5 behavior-neutral, test-verified modules: `transcode.rs`,
`media_extract.rs`, `preview.rs`, `metadata.rs`, `playlist.rs`. See NOTES
2026-07-04. **Banked here on purpose** — the only big Rust piece left is
`yt_download` (~810 lines), the coupled core; *relocating* it wouldn't
decouple it, and it's the exact path every download hits, so it's high-risk
/ low-reward as a cold move. Real work there is *decomposition* (progress /
segments / finalize), deferred to when the download path is actively reworked.

**Still open (tracked, deferred):** `Library.tsx` (5004 lines) — the biggest
*actual* pain; do it when working in that file, two-phase (`library/shared.ts`
then component clusters). `library.rs` (2978) split by schema/queries/tags.

Not a *runtime* cost, but a real maintainability tax (and big React files
hurt HMR + re-render reasoning). `Library.tsx` especially is doing grid +
inspector + folders + context menus + drag + toasts in one file — split
into `library/` submodules (FolderTree, Inspector, Grid, CardContextMenu).

---

## 3. Missing editor-workflow features (ranked by time saved)

References agree the gap between "downloaded clips" and "on the timeline"
is where editors lose the most time. In priority order:

### 3.1 Proxy generation ⭐ (top editor ask)
Auto-create a lightweight editing proxy (e.g. 1080p H.264 / ProRes
Proxy) alongside the source on download, or on demand. We already have
the transcode engine — this is a **preset + a "generate proxy" toggle +
a sibling-file link** (we already track siblings!). Editors cut on the
proxy, relink to source on export. Massive for 4K B-roll.

### 3.2 Watch folder ⭐
Auto-import anything dropped into a folder (drag from a browser's
downloads, Slack, AirDrop) → library, with auto-thumbnail + auto-tag.
The single most-cited "I want this" in MAM tools. We have the library +
move plumbing; this is an fs-watcher + the existing insert path.

### 3.3 Drag-to-timeline / NLE handoff ⭐
We already bundle `tauri-plugin-drag` and have drag in the library.
Extend it to **drag a clip straight onto a Premiere/Resolve timeline**
(OS-level file drag with the proxy when present). Bigger version: export
a **bin** — generate an `.fcpxml` / `.edl` / Resolve `.drp`-friendly
folder, or a "Send selection to Premiere/Resolve" that drops files into
a watched NLE import folder.

### 3.4 Auto-tagging / scene + content search
- **Transcript search** (Whisper on the audio) → search clips by spoken
  words. Huge for interview/podcast B-roll.
- **Scene/shot detection** → auto sub-clips + thumbnails per scene.
- **Auto-tags** from yt-dlp metadata (channel, categories, keywords) we
  already fetch but don't fully mine.

### 3.5 Batch download from a list
Paste/import a list (or CSV) of URLs → queue all. We have the queue;
this is a textarea + split. Tiny effort, real time-saver for sourcing.

### 3.6 Smaller wins
- **Saved searches / smart collections** (e.g. "untagged", "added this
  week", "no proxy yet").
- **Ratings / color labels / favorites** (we have folder colors; extend
  to assets) for fast culling.
- **Markers / in-out sub-clips** persisted per asset (the scrubber
  already does in/out — persist them as named sub-clips).
- **Copy-as**: copy file path / copy frame / copy as proxy path — quick
  clipboard handoffs to an NLE.
- **Bulk re-encode / "conform all to ProRes"** for a project.

---

## 4. Recommended order

**Quick, high-leverage (days):**
1. Faster downloads — native progress parse + concurrent fragments (1.1).
2. Batch URL paste → queue (3.5).
3. Stripped ffmpeg build (2.2) — halve the bundle with one script change.

**High-value, medium effort:**
4. Lazy-download sidecars to appdata (2.1) — kills update bloat.
5. Proxy generation (3.1) — top editor feature, engine already exists.
6. Watch folder (3.2).

**Bigger bets / later:**
7. aria2c external downloader (1.2).
8. Drag-to-timeline / NLE bin export (3.3).
9. Transcript/scene search (3.4).
10. Split `Library.tsx` + `lib.rs` (2.4) — pay down before the above pile
    more onto them.

---

## 5. Sources
- Video asset management features (proxy gen, watch folders, NLE import): https://www.anchorpoint.app/blog/video-asset-management-software
- MAM in DaVinci/Premiere/FCP (drag proxy to timeline, conform): https://massive.io/how-to/media-asset-management-in-nles/
- Proxy workflow (DaVinci Resolve): https://elements.tv/blog/everything-you-need-to-know-about-the-proxy-workflow-in-davinci-resolve/
- Proxy workflows for NLEs: https://jonnyelwyn.co.uk/film-and-video-editing/proxy-workflows-for-your-nle/
- yt-dlp GUI feature patterns (presets, global args): https://sourceforge.net/projects/yt-dlp-gui.mirror/
- yt-dlp usage / flags reference: https://videoconverter.wondershare.com/more-tips/yt-dlp-guide.html
