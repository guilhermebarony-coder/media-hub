# RTX Video upscale — build plan (scoped 2026-07-05)

Companion to `RTX_UPSCALE_RESEARCH.md` (POC PASSED). This is the **how we build
it** doc. Not started — this is the design + phased task list.

Feature: an optional per-clip **"Create enhanced version → NVIDIA RTX Video"**
that runs RTX Video Super Resolution (VSR, quality "Ultra") on a library clip.
Original untouched; enhanced saved as a **sibling derivative** (the library
already tracks siblings — `sibling_count` infra exists).

---

## Scope additions (author direction, 2026-07-05)

**A. Build it as a REUSABLE, side-scoped component — not baked into Media Hub.**
The RTX enhancer should be a **self-contained unit** that Media Hub *calls*, so
the exact same unit can drop into **Chiral Network** (or any future app) with
little/no change. Concretely:
- The unit = `{ worker binary + nvngx_vsr.dll + a documented CLI/IPC contract }`.
- Media Hub's Rust side only knows the contract (spawn args + stdout events), not
  RTX internals. Chiral would reuse the identical unit + contract.
- Define a **stable contract early** (input path, output path, quality, hdr,
  target size, progress as JSON lines on stdout, exit codes). That contract is
  the reusable boundary. Phase 1 wraps RTXVideoProcessor behind it; Phase 4
  swaps in our own worker behind the *same* contract — callers don't change.
- Keep it in its own folder/repo (e.g. `mh-rtx-enhance/`) so it's portable.

**B. UX: two possible entry points — recommend starting with ONE.**
- **(Recommended first) Library → right-click → "Upscale this clip" → opens a
  window** with source info + settings + Enhance button. Deliberate, per-clip,
  non-destructive (saves a sibling). Matches the "I see a rough clip, fix THIS
  one" mental model. Enhancing is heavy (even at ~44fps a 5-min clip ≈ 3–4 min
  of GPU work), so it should be an explicit action, not automatic.
- **(Later, secondary) A download-time toggle like transcode** ("Enhance after
  download"), OFF by default, single-URL only. Convenience entry point that
  funnels into the *same* backend. Adding it later is cheap once the core exists.
- Both routes call one backend (`rtx_enhance`). Start with right-click; add the
  toggle in Phase 2/3.

**B2. Window evolves into a preview-first hub (author direction 2026-07-05).**
The before/after window should also work *before* upscaling and *outside* the
library:
- **Drop a video into the window** (incl. files not in the library) → preview
  what RTX would do (via the ~1s-snippet live preview) before committing a full
  render.
- **Openable from a fixed spot** (e.g. a top-bar entry), not only from the dock.
- **Settings there PERSIST** — HDR (and future quality/scale) set in the window
  become the default for the next right-click → upscale. (Store `defaultHdr`
  already exists; persist it to settings + honor it in enqueue — done partially.)
- Net: two paths share one settings source — fast "2 clicks → upscaled" AND
  "preview, tweak, then render." Keep both.

**C. VSR options — from the official Programming Guide v1.1 (read 2026-07-05).**
- **Quality ladder:** `0 Bicubic` (non-AI fallback), `1 Low`, `2 Medium`,
  `3 High`, `4 Ultra`. **Ultra (4) = best quality, longest runtime. Nothing is
  higher than Ultra.** RTXVideoProcessor already defaults to 4, and you got
  ~44fps at Ultra → **just always use Ultra**; the slider is optional (only worth
  exposing Low/High for weak GPUs). This answers "is Ultra the best": yes.
- **VSR inherently does upscale + sharpen + DEBLOCK (artifact reduction) in one
  pass** — the compression cleanup is built in, not a separate toggle. Exactly
  the "fixes it without ruining it" behavior.
- **Output size is ARBITRARY in the SDK** (via output rect / `OutputSubrectSize`)
  — NOT locked to 2×. The fixed-2× limit is *RTXVideoProcessor's* choice, not the
  SDK's. → Our own worker (Phase 4) can do **true 4× (e.g. 480p→1080p, 1080p→4K)
  to match Resolve exactly**, and offer target-resolution presets. Phase 1 (CLI)
  stays 2× only.
- **Real progress + cancel exist in the SDK** (`PFN_NVSDK_NGX_ProgressCallback`,
  0.0–1.0, `OutShouldCancel`). The CLI just doesn't expose them → another reason
  Phase 4 (own worker) is the long-term win: real % bar + clean cancel.
- **Input is SDR RGB only.** HDR is the *separate* TrueHDR feature (SDR→HDR),
  off by default.
- **Requirements:** RTX GPU (Turing/RTX 20-series+), NVIDIA driver **r550.58+**
  (CUDA path needs r570+), Windows 10 20H1+.

> Net on options: for v1 there's really **one knob that matters (Ultra, always
> on)** plus an optional HDR toggle (off). Target-resolution presets (true 4×)
> are the marquee Phase-4 upgrade once we have our own worker.

---

## The big architecture decision: WRAP, don't (yet) BUILD

The POC used the community CLI **RTXVideoProcessor** (MIT). That changes
everything vs. the original "weeks of native C++/CUDA" estimate:

| Path | Effort | When |
|---|---|---|
| **Phase 1 — wrap the MIT CLI as a sidecar** | days | now |
| Phase 4 — our own SDK-based native worker | weeks (C++/CUDA) | only if we outgrow the CLI |

**Why wrapping works:**
- ✅ RTXVideoProcessor is **MIT** → we can redistribute the `.exe`.
- ✅ It already does the whole pipeline: NVDEC decode → RTX VSR → NVENC encode,
  and **copies audio/subtitle/metadata streams verbatim** (the boring part).
- ✅ We can bundle `nvngx_vsr.dll` legally under the RTX SDK EULA (§2 conditions
  — see RESEARCH doc). The CLI author declined only because *they* never signed
  the EULA; we have and can comply.
- ✅ Fits Media Hub's existing **lazy-downloaded sidecar** pattern exactly
  (yt-dlp / ffmpeg / aria2c / deno).

**Known rough edges of the CLI (accept for v1, fix later):**
- Fixed **2× only**, VSR auto-skips ≥1440p, HDR (TrueHDR) on by default → we
  drive it with explicit flags (`--no-thdr` unless user opts in).
- Third-party binary = a maintenance/supply dependency → pin a version, vendor a
  known-good build, checksum it. Phase 4 removes the dependency entirely.
- **Drops the LAST frame** (measured 2026-07-05: 2855→2854 frames; enhanced ends
  ~1 frame / 0.04s earlier, same start=0). Pipeline-flush artifact. Harmless:
  head-aligned, not a leading shift or growing drift — only the final 1/30s is
  missing. Not worth a re-encode to pad. Phase-4 own worker gets exact frame
  parity (process + flush every frame).

**Phase 0 verification (done 2026-07-05, all POSITIVE):**
- ✅ **Audio/subs survive** — enhanced output carries the original audio stream
  verbatim (verified `aac stereo` present on both a user run and a controlled
  run). README claim holds.
- ✅ **RTX detection = `nvidia-smi`** — `nvidia-smi --query-gpu=name,driver_version
  --format=csv,noheader` returns e.g. `NVIDIA GeForce RTX 5080, 610.47`. Gate =
  name contains "RTX" AND driver ≥ r550.58. (nvidia-smi ships with the driver;
  its absence ⇒ no NVIDIA GPU.)
- ✅ **Progress IS parseable** (my README-based worry was WRONG). The CLI prints a
  live progress bar to **stderr**, carriage-return updated per frame:
  `  75.3% [55/73] 31.9 fps ETA: 00:00`. Regex-parseable: percent, current/total
  frames, fps, ETA. → **Phase 1 gets a REAL % progress bar**, not a spinner.
- Verbose log also confirms: GPU/CUDA path, fixed 2× scale, NVENC (tune hq,
  preset p7, constqp qp21, gop 3s, bframes 2), target bitrate ≈ 3× input,
  faststart (moov moved to front). Good defaults; nothing to override for v1.

---

## Components

### 1. Sidecar bundle (lazy-downloaded on first enable)
- `RTXVideoProcessor.exe` (~22 MB, MIT)
- `nvngx_vsr.dll` (~19 MB, NVIDIA — bundled under EULA compliance)
- `nvngx_truehdr.dll` (~4 MB, optional — only if we expose SDR→HDR)
- Hosted on our release assets; downloaded only when the user first turns on RTX
  upscale (keeps the base installer small). Checksum-verified.

### 2. RTX capability gate (Rust: `rtx_capability()`)
Returns `{ supported: bool, gpu_name: String, reason: Option<String> }`.
- Detect NVIDIA GPU + **RTX 20-series (Turing) or newer** + Windows x64.
- Detection options (pick simplest reliable): query `nvidia-smi --query-gpu=name`
  if present, or DXGI adapter enumeration, or WMI `Win32_VideoController`.
- If unsupported → the enhance action is hidden or shown disabled with a plain
  reason ("Needs an NVIDIA RTX GPU").

### 3. Enhance command (Rust: `rtx_enhance(asset_id, opts)`)
- `opts`: `{ hdr: bool = false, quality: u8 = 4 }` (Ultra). Keep minimal for v1.
- Steps: resolve source path → ensure sidecar present (lazy download) → warn if
  source ≥1440p → spawn worker with flags → stream stdout, emit progress events
  (indeterminate + any parseable signal) → on success register output as a
  **sibling asset** in the library DB, extract a thumbnail (reuse existing
  `media_extract_thumbnail`) → emit done event.
- Output naming/path follows the existing derivative/sibling convention.
- Cancel support: kill the child process (reuse the download-cancel pattern).

### 4. UX (frontend)
- Per-item action in the Library card/context menu + inspector:
  **"Create enhanced version → NVIDIA RTX Video"**.
- Small dialog: shows `1080p → 2160p (2×)`, HDR toggle (off default), Enhance btn.
- Warn states: source ≥1440p (VSR will skip — offer to proceed as re-encode or
  cancel), no RTX GPU (disabled), already-enhanced sibling exists.
- Progress surfaced like a download job. Enhanced clip appears as a sibling with
  an "RTX" badge (reuse sibling chip UI).

### 5. Distribution / legal (before public enable)
- App **EULA / THIRD-PARTY-NOTICES**: `nvngx_vsr.dll © NVIDIA, RTX SDK License`;
  MIT scoped to our code only; RTXVideoProcessor MIT attribution.
- NVIDIA **pre-release notification** form (NGX-based) before shipping.
- H.264/H.265 (NVENC) patent licensing note — pre-existing via ffmpeg, restate.
- Ship the RTX feature **behind an experimental flag** until the above is done.

---

## Phased task list

**Phase 0 — de-risk (DONE 2026-07-05)**
- [x] Audio/subs/metadata passthrough — ✅ confirmed (audio stream carried).
- [x] Progress signal — ✅ parseable % + frames + fps + ETA on stderr (per-frame,
      `\r`-updated). v1 gets a real progress bar.
- [x] RTX detection method — ✅ `nvidia-smi` name+driver query.
- [ ] Decide sidecar hosting + version pin + checksum (remaining; a release-eng
      decision, not blocking Phase 1 dev — can host on our GitHub release assets).

**Phase 1 — MVP (wrap, experimental flag)**
- [x] `rtx_capability()` Rust command (nvidia-smi gate) — `src-tauri/src/rtx.rs`,
      registered in lib.rs. Detects RTX + driver ≥ r550.58. (7 unit tests pass.)
- [x] Progress parser — `rtx::parse_progress` parses the worker's stderr bar
      (percent/frame/total/fps/eta), ANSI-tolerant. (Unit-tested.)
- [x] `rtx_enhance()` Rust command — spawns worker via `app.shell().command()`,
      streams stderr → `rtx:progress` events, registers output as a sibling
      (same source_url, dims ×2, `transcoded_to="rtx-vsr"` marker), `rtx:done`.
      Guards: capability, worker present, source exists, refuses ≥1440p.
      `rtx_worker_status` command too. Compiles clean (cargo check + 7 tests).
- [x] Dev worker staged into `<app_data>/bin` (repo stays binary-free).
- [x] Frontend store `lib/rtxEnhance.tsx` — provider (mirrors downloads.tsx):
      capability/worker probe, `rtx:progress` listener, sequential GPU worker,
      `enqueue`/`removeJob`/`clearFinished`. Mounted in App.tsx.
- [x] Right-click Library action "Upscale (NVIDIA RTX Video)" — gated on
      capability + video + <1440p. i18n key added (en + pt).
- [x] Progress UI — `components/RtxQueueDock.tsx` bottom-left dock: live %/fps/ETA
      bar, collapse, remove queued/finished. Styled in App.css. (tsc clean.)
- [x] Sibling "RTX" badge on the enhanced card + friendly "Enhanced: NVIDIA RTX
      Video (2×)" drawer label (marker `transcoded_to=rtx-vsr`).
- [x] Before/after window (`components/RtxEnhanceWindow.tsx`) — draggable A/B
      video slider (loads original + enhanced off disk via convertFileSrc),
      queue sidebar to switch results, HDR default toggle + quality note. Opens
      from the dock (eye button or row click). (tsc clean.)
- [x] **Window openable any time from a top-bar button** (gated on capability)
      + **HDR default persists** (localStorage `mh.rtx.hdr`) → the toggle in the
      window becomes the default for the next right-click → upscale. First
      pieces of the "preview hub" vision (B2). (tsc clean.)
- [ ] Sidecar lazy-download — needs hosting decision; dev uses staged worker.
- [ ] Manual smoke on 2–3 clips (needs running the app).

**Phase 2 — polish**
- [x] **Quality selector** (Ultra/High/Medium/Low → `--vsr-quality 1–4`) in the
      window, persisted (`mh.rtx.quality`), honored on right-click → upscale.
      Backend `rtx_enhance(quality)`. (cargo + tsc clean.)
- [x] **Decompress-only (1× scale)** — "no upscale, just clean compression".
      Scale selector now offers **2× upscale** and **Decompress only (1×)**,
      persisted (`mh.rtx.scale`). Since the community CLI is locked to 2×, the
      1× path runs the worker at 2× then downscales back with ffmpeg
      (`scale=iw/2:ih/2:flags=lanczos`, x264 CRF 18, audio copy) — supersampled
      artifact cleanup at native resolution *today*, no fork needed. Native 1×
      arrives free with the Phase 4 fork. Output naming `_rtx-clean.mp4` vs
      `_rtx-vsr.mp4` so both variants can coexist. Backend `rtx_enhance(scale)`
      + shared `run_worker` helper. (cargo + tsc + 9 rtx tests clean.)
- [x] **Drop-in enhance** — the review window accepts dropped videos: external
      files (OS drag → Tauri `onDragDropEvent`) AND clips dragged out of the
      library (in-app HTML5 `application/x-mh-file` MIME, sidestepping the
      Windows OLE self-drag quirk). New backend `rtx_enhance_path(path, …)`
      probes dims via ffmpeg, enhances, and registers a fresh Library asset.
      Provider gains `enqueuePaths` + a `source: "asset" | "path"` job kind.
      (cargo + tsc clean.)
- [x] **Settings → RTX Video section** — quality / scale / HDR defaults (same
      context-backed values as the window, so they stay in lockstep), an "Open
      enhance window" button, and GPU/driver/enhancer readout. Auto-hides on
      non-RTX machines.
- [ ] Options dialog niceties (≥1440p inline warning), "remove RTX components".
- [x] **Cancel a running job** — reuses the existing `JobRegistry` (child +
      canceled sets). `rtx_enhance` registers/deregisters its worker child;
      `rtx_enhance_cancel(job_id)` kills it + flags canceled; the enhance returns
      `__rtx_canceled__` (distinct from failure) and deletes the partial output.
      Frontend: `canceled` status + `cancelJob`; Stop buttons in dock + window.
      (cargo + tsc clean.)
- [ ] Error surfaces, batch enhance (multi-select).
- [x] **Settings entry** — defaults (quality/scale/HDR) + GPU readout + open
      window (see the RTX Video section above). Still open: sidecar location,
      "remove RTX components".
- [x] **In-app before/after A/B** — a *video* slider in the enhance window
      (real motion, both files loaded off disk).
- [x] **A/B viewer v2 (2026-07-05)** — the still slider was useless with the
      video moving + the two halves drifting. Rebuilt with a real transport
      (play/pause, scrub, **frame-step** ◀▮▶), a **shared clock** (seeking drives
      both halves — kills the old 100ms-poll drift), a **frame-offset nudge** to
      cancel the enhancer's 1-frame drop, and **wheel-zoom + drag-pan** so you
      can inspect a paused frame. Opens paused. (tsc clean.)
- [x] **Two-stage queue (2026-07-05)** — window drops no longer auto-run. New
      `staged` status: dropped/`stageAsset` clips land in **"Setting up"** where
      each has its own quality/scale/HDR (or **Apply defaults** to all), then
      **Start** (one or **Start all**) commits them to the **"Rendering"** queue
      the GPU pumps. Right-click → *Upscale* stays instant (fast path); new
      right-click → *Set up in RTX window…* stages instead. Provider gains
      `stageAsset` / `enqueuePaths`(→staged) / `setJobOptions` / `applyToStaged`
      / `startJob` / `startAllStaged`. (tsc clean.)
- [x] **Pre-enhance preview (2026-07-05)** — for a staged clip, scrub the SOURCE
      to a frame and hit **Preview frame** → backend `rtx_preview` extracts a
      ~1.5s slice (ffmpeg) and runs it through the REAL worker, returning
      before/after temp clips (asset scope is `**`, so temp files load). The
      viewer swaps to that A/B so you judge the actual result before committing
      the whole clip. "Pick another frame" returns to the source. Editing a
      staged clip's settings invalidates its preview.
- [x] **Window redesign (2026-07-05)** — the rail was cramming 4 jobs at once.
      Rebuilt: a **unified Viewer** (source-scrub ⇄ preview ⇄ done A/B, one
      transport), and a rail with a clean clip list (grouped Setting up /
      Rendering) + **ONE context-aware settings card** (the selected staged
      clip's settings, or the defaults) instead of per-row control clutter.
      Rail widened to 320px with real spacing.
- [x] **Viewer polish (2026-07-05)** — divider decoupled from zoom (screen-space
      overlay: handle stays constant size + grabbable at any zoom; videos zoom
      underneath). Frame-step arrows → `‹ ›`. Remove-✕ enlarged (was mistaken
      for a dot).
- [ ] Stretch: true real-time preview (live VSR pipeline — Phase 4 territory).

**Future — settings expansion (noted 2026-07-05, Topaz Video AI as loose ref)**
The single settings card is deliberately minimal today. When Phase 4's forked
worker exposes more knobs (output-resolution presets, model choice, per-slider
fix-compression / improve-detail / sharpen / reduce-noise / dehalo / anti-alias,
frame-interpolation, codec settings), DON'T pile them into one flat column —
that's the clutter the user flagged. Use a **tabbed / collapsible** layout
(e.g. Adjustments vs Codec, collapsible "Enhancement" / "Frame interpolation"
sections) so the card scales without becoming a wall. Reference only — not a
design to copy.

**Phase 3 — legal + release** *(deferred — swapped AFTER Phase 4 on 2026-07-05:
finish the feature, incl. the native worker, before packaging it to ship)*
- [ ] EULA / THIRD-PARTY-NOTICES; MIT scoping; attributions.
- [ ] NVIDIA pre-release notification form.
- [ ] Docs (MANUAL + Help entries + README blurb). Flip off the experimental flag.

**Phase 4 — ✅ DONE (2026-07-05): forked worker built + deployed, native 4× wired**

Native 4× works end-to-end: forked `RTXVideoProcessor` with `--vsr-scale` built
clean (854×480 → 3416×1920 verified), deployed to `%APPDATA%\…\bin\`. Media Hub
side wired: `run_worker` passes `--vsr-scale {1|2|4}` (1 = native decompress, no
more ffmpeg downscale hack), `≥1440` guard relaxed to `≥2160` (4K), sibling dims
× scale, HEVC codec, 4× enabled in the window + Settings selectors, dock label
scale-aware. cargo + tsc clean.

**THE build combo (hard-won — full saga in `rtx-worker-fork/MEDIAHUB_FORK_NOTES.md`):**
CUDA **12.8** (NOT 13 — 13's cudart stack-overruns NVIDIA's `NVSDK_NGX_CUDA_Init`
via the unversioned `cudaGetDeviceProperties`; proven with a 10-line repro) + VS
2022 **MSVC v143 (14.44)** as nvcc host (VS 2026's 19.51 crashes 12.8's cudafe++)
+ Video Codec SDK 12.2 + RTX Video SDK 1.1.0 + vcpkg static FFmpeg. Rebuild via
`rtx-worker-fork/buildfinal.bat` (`vcvars -vcvars_ver=14.44`).

**Historical plan (kept for reference):**

Confirmed from the SDK Programming Guide that native single-pass 4× / 1080p→4K
is fully supported by the SDK — the 2×-only + ≥1440p-skip are RTXVideoProcessor's
own choices, NOT NVIDIA limits:
- Sample line 298: `VSRDemo.exe -i NV12_640_480…yuv -size 1920 1080` → 480p→1080p
  in ONE call with an arbitrary `-size w h`.
- VSR eval takes an **`OutputSubrectSize` / output rect** = "set an output rect to
  define a destination size" → any target dimensions, single pass.
- **No `1440` appears anywhere in the doc.** No SDK resolution cap.

→ **Path = fork `RTXVideoProcessor` (MIT), don't rewrite from scratch.** Cloned +
patched at `F:\CLAUDE\rtx-worker-fork` (outside the repo — proprietary DLLs).
CODE DONE, blocked only on the build environment:
- [x] **`--vsr-scale N` flag added (2026-07-05).** Turned out there's NO structural
      2× hardcode — every dim derives from one `int scaleFactor` (`main.cpp:412`,
      `rtx_processor.cpp:50/589`). Patch = one help line + one parse branch
      (clamp 1..4, env `RTX_VSR_SCALE`) in `config_parser.cpp`. `--vsr-quality 1–4`
      + real per-frame progress already existed.
- [x] **Guard finding:** upstream only disables VSR at **≥4K input**
      (`input_config.cpp:88`), NOT 1440p. So `1080p→4K` (2×) works with the worker
      as-is; our Rust `≥1440` refusal is stricter than the worker. Relax it to
      `<4K` when we swap the forked exe in.
- [x] `CMAKE_CUDA_ARCHITECTURES` → `75 86 89 120` (Turing→Blackwell; 5080 = sm_120).
- [ ] **BUILD (blocked on env below)** → then drop the forked exe into
      `%APPDATA%\com.guilherme.mediahub\bin\`.
- [ ] Media Hub wiring: `rtx.rs` pass `--vsr-scale 4`; thread `scale=4` through
      `rtx_enhance`/`rtx_enhance_path`; relax the `≥1440` guard; enable the "4×"
      option in the Scale dropdowns (gate so `input*4 ≲ 4K`).
- [ ] Optional single-pass sharpen (CAS-in-CUDA / NPP) before NVENC — off by
      default; only feasible inside the worker.

**Build prerequisites (checked 2026-07-05; see `rtx-worker-fork/MEDIAHUB_FORK_NOTES.md`):**
- ✅ VS Build Tools (MSVC), ✅ git, ✅ RTX Video SDK (`E:\TESTE RTX VIDEO\sdk` →
  env `NV_RTX_VIDEO_SDK`), ✅ source cloned + patched.
- ❌ **CUDA Toolkit ≥ 12.8** (`nvcc` missing) — 12.8 adds Blackwell sm_120.
- ❌ **CMake not on PATH** (install standalone or add VS's).
- ❌ **NVIDIA Video Codec SDK** (separate dev-login download → env
  `NV_VIDEO_CODEC_SDK`; provides `nvcuvid`/`nvencodeapi`).
- ⬜ FFmpeg dev libs — vcpkg static (~30 min first build) or prebuilt `-DFFMPEG_ROOT`.

**Interim (stock wrapped CLI):** `--vsr-quality` (Ultra/High/Med/Low) works NOW
without the fork; **scale stays 2× until the fork lands**. So the Quality selector
can ship immediately; the 2×/4× selector activates once the forked worker is in.

---

## Open questions to resolve as we go
- ~~Progress fidelity for v1~~ → RESOLVED: real % + frames + fps + ETA parsed
  from the CLI's stderr progress bar.
- ~~Sharpen add-on?~~ → RESOLVED: NOT in v1 (would force a 2nd encode via the
  CLI). Revisit as an optional, off-by-default control inside the Phase-4 worker
  fork (single-pass GPU sharpen). VSR already sharpens, so low priority.
- ~~In-app before/after?~~ → RESOLVED: in scope, Phase 2 (frame A/B slider).
- ~~Do we expose HDR (TrueHDR) at all?~~ → RESOLVED 2026-08-20: **no**. The
  switch is removed, `--no-thdr` is forced, and `nvngx_truehdr.dll` is not
  shipped or extracted anywhere. It cost a second proprietary DLL for a feature
  nobody was using.
- ~~Sidecar size budget + hosting~~ → RESOLVED 2026-08-20: **split install**.
  The public GitHub asset carries MIT files only (worker + CodecClean weights);
  `nvngx_vsr.dll` ships inside the Media Hub installer and is copied beside the
  worker at install time. Rationale, the measurements behind it, and what is
  still owed: `docs/SHIPPING_LEGAL.md`.
- ~~Non-RTX NVIDIA and AMD/Intel users: hide entirely, or offer a fallback?~~
  → RESOLVED: hide entirely. No teasing, no disabled controls.

---

## Phase 5 — the enhancer is an install, not a feature (1.15.0)

Nothing RTX is in the installer (`tauri.conf.json` has no `resources`, and
`externalBin` is yt-dlp only). The sidecar arrives only when the user asks for
it, from one of exactly two places.

**One rule, derived once** in `rtxEnhance.tsx` so no caller can invent its own:

```
rtxAvailable   = capability.supported && workerReady   // show every RTX control
rtxInstallable = capability.supported && !workerReady  // show the offer, nothing else
```

- `rtxAvailable` gates the library right-click items and the top-bar button.
  Previously they were gated on `capability.supported` alone — a capable GPU
  with no sidecar lit up a menu whose only outcome was an error a minute later.
- `rtxInstallable` renders `<RtxInstallCard />`, the same component in both
  entry points so the wording, the progress and the failure cannot drift:
  - **first-run wizard**, appended to the last step. Deliberately NOT its own
    step: it is optional and 29 MB, and "Finish" stays one click away.
  - **Settings → RTX Video**, where the section *becomes* the card. The
    quality / scale / filter / output rows are hidden until the worker exists,
    because they were settings that could not take effect.
- Install progress rides the existing `tools:progress` event, filtered on
  `tool === "rtx-worker"`. `ensureWorker` never rejects; the failure is state,
  so both cards render it identically.
- `RtxWorkerStatus` carries `download_bytes` from the spec, so the prompt quotes
  the real size instead of a React string nobody updates when the bundle is recut.
- `tools::tests::the_rtx_bundle_can_actually_install_itself` pins the spec:
  https url, version, 64-char sha256, non-zero size, `out_name` actually
  produced by a member, the MIT files present — and, since 1.15.0, that no
  NVIDIA DLL is listed as a member at all. Re-adding one to "fix" an install
  fails the test and points at SHIPPING_LEGAL.md.

### The install is two halves now

`rtx_worker_ensure` = `ensure()` (download the MIT archive) + `place_rtx_runtime()`
(copy `nvngx_vsr.dll` out of our own installer, delete anything in
`RTX_OBSOLETE`). Both `rtx_worker_freshness` and `RtxWorkerStatus.installed`
require **both** halves, because a worker without the runtime beside it starts
and then dies at RTX init — the worst of the three states to report as
"installed".

Build-time cost, measured 2026-08-20 (not estimated): the NSIS installer goes
from **23.8 MB → 36.4 MB**, +12.6 MB, for a 19.1 MB DLL after LZMA. The 29 MB
worker executable — the bigger half — still downloads on demand, so a user who
never touches RTX never fetches it. Verified inside the built installer:
`resources/nvngx_vsr.dll`, 19,140,144 bytes.
