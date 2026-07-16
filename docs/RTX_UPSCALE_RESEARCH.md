# RTX Video upscale — research & POC plan (POC PASSED ✅, not yet scheduled)

Status: **POC passed 2026-07-05 — quality + speed validated.** Not yet on the
roadmap (still a weeks-long native effort), but the go/no-go question is
answered: **GO on quality.** This doc captures the assessment + POC result.

## POC RESULT (2026-07-05) — PASSED
Ran the community CLI **RTXVideoProcessor** with the official RTX Video SDK
`nvngx_vsr.dll` (quality 4 = Ultra) on real clips, on the author's own RTX GPU.
- **Quality:** "almost 100% better, pretty similar to DaVinci's." Cleans a good
  amount of compression **without wrecking the image** (no plastic/over-smoothed
  look). Verified on compression-heavy live-action AND several anime clips
  (edges, gradients/sky banding, flat areas all improved).
- **Speed:** ~**44 fps** processing → faster than real-time. Kills the "too slow"
  worry that sinks Topaz/Real-ESRGAN-class tools.
- **Correctness:** exact 2× upscale confirmed via ffprobe (1080p→2160p,
  480p→960p). Output files clean (the green box the author saw was the NVIDIA
  App "Alt+Z" overlay, NOT baked into the file).
- **Verdict:** the "fixes it without ruining it" result the author wanted is
  reproducible outside Resolve. → Quality no longer the blocker; remaining cost
  is purely the native C++/CUDA integration effort (see architecture below).
- Test kit lives at `E:\TESTE RTX VIDEO` (drop-and-click ENHANCE + COMPARE bats)
  — scratch, deletable, outside the repo.

Next decision (not started): schedule the native worker integration vs. keep it
parked behind other roadmap items. Quality risk is retired; only effort remains.

---

Original assessment (pre-POC) below.

Status: **brainstorm / not on the roadmap.** No production code. This doc
captures the assessment so we can pick it up if/when a proof-of-concept
proves the visual result is worth the (significant) engineering.

Goal: an **optional** "Create enhanced version" derivative that runs NVIDIA
**RTX Video Super Resolution** on a library clip — reproducing the result the
author likes in DaVinci Resolve ("Super Scale → 4× NVIDIA RTX Video → Ultra"),
which cleans up compression + upscales *without* the plasticky over-restoration
of more aggressive AI upscalers.

> **Confirmed vs assumed:** lines marked ✅ are from official NVIDIA docs
> (sources at the bottom, checked 2026-07). Lines marked ❓ are assumptions or
> things the public docs don't state — these are exactly what the POC must
> resolve.

---

## Candidate SDKs (revised priority)

### 1. NVIDIA **RTX Video SDK** — test FIRST
- ✅ Exposes **Super Resolution**, **Artifact Reduction**, and **SDR→HDR
  tonemapping** as a developer SDK (was previously a driver-only feature).
- ✅ Graphics APIs: **DX11, DX12, Vulkan, CUDA**.
- ✅ **10-bit** super-resolution added in v1.1; RTX 50-series (Blackwell) support
  added in v1.1.
- ✅ **Windows 10+ 64-bit**; GPU floor **RTX 20-series (Turing) or newer**.
- ✅ Distributed as a downloadable package (`RTX Video SDK v1.1.0.zip`).
- **Why first:** Resolve's option is literally labelled *"NVIDIA RTX Video"*, so
  this SDK is the most likely to **match the look we're chasing**. It's also the
  only path that does **10-bit**.
- ❓ Licensing / redistribution terms, offline-batch guidance, and exact
  quality-level knobs are **not stated on the getting-started page** — must read
  the EULA + headers.

### 2. NVIDIA **Maxine Video Effects (VFX) SDK** — VSR filter — test SECOND
- ✅ Its **Video Super Resolution (VSR)** filter now exposes discrete modes:
  **`VSR_Low` (1), `VSR_Medium` (2), `VSR_High` (3), `VSR_Ultra` (4)** — plus
  Denoise (8–11), Deblur (12–15), HighBitrate (16–19) each in Low/Med/High/Ultra.
- ✅ **I/O is 8-bit BGRA/RGBA GPU buffers only** → **no 10-bit** (real limitation
  vs the RTX Video SDK).
- ✅ Suggested **min input 360p**. Windows driver R595+ (TCC); Linux driver
  floors listed.
- **Why second:** `VSR_Ultra` is the obvious analogue to Resolve's "Ultra", and
  the SDK has clean, well-documented samples. But ❓ it's **not public** whether
  this model == the RTX Video SDK model == Resolve's "Ultra". Could look
  different.

### 3. DaVinci Resolve "4× NVIDIA RTX Video — Ultra" — **visual reference only**
- The ground truth we're comparing against. ❓ Resolve may wrap the SDK with its
  own color/pre/post processing, so an external build may look *close but not
  identical*. Not a shippable integration path (needs Resolve Studio; Super
  Scale method/quality likely not cleanly exposed in the scripting API).

---

## The one POC question

> **On the same input frames, which SDK — RTX Video SDK SR vs. Maxine
> `VSR_Ultra` — produces the result closest to Resolve's "4× NVIDIA RTX
> Video — Ultra"?**

Everything else (integration effort, packaging) is only worth spending if the
answer is "close enough to love." Decide with your own eyes on a split-screen.

---

## POC plan (do this before ANY integration)

1. **Prior art:** study the community CLI **`RTXVideoProcessor`** (GitHub) — it
   already applies RTX VSR + TrueHDR to files, so it proves offline file
   processing works and shows a working decode→VSR→encode loop to learn from.
2. **RTX Video SDK path:** grab `RTX Video SDK v1.1.0`, build the official
   sample, process 5–6 representative B-roll clips (480p & 720p, compression-
   heavy; include one 10-bit) → 1080p and 4K.
3. **Maxine VFX path:** build the VFX-SDK VSR sample, run the same clips with
   `VSR_Ultra` (8-bit only).
4. **Resolve reference:** render the same clips with 4× NVIDIA RTX Video / Ultra.
5. **Compare:** side-by-side stills + motion. Rank closeness to Resolve. Record
   **speed (fps), VRAM, output size**.
6. **Decide:** if a path matches Resolve and runs at a tolerable speed → promote
   to a real feature. If not → fall back to a cross-vendor option (Real-CUGAN /
   Real-ESRGAN ncnn-vulkan) or the ffmpeg cleanup we already prototyped.

Read the **EULA** during step 2 — redistribution rights are the go/no-go for
shipping it at all.

### Can we rely on the driver already having the DLL? — NO (checked 2026-07-05)
Searched a live RTX machine (System32, DriverStore/FileRepository, NVIDIA App,
ProgramData). **`nvngx_vsr.dll` is NOT present by that name anywhere the driver
installs.** The driver ships its own internal VSR as **`nvsvsr.dll` +
`nvvitvsr.dll`** (used by the NVIDIA App's browser-video enhancement) — same
tech family, but **different filenames and a different interface**; the SDK's
NGX loader specifically requests `nvngx_vsr.dll` and won't load those. So we
**cannot** assume the runtime is already on a user's machine — it only comes
from the RTX Video SDK. → Shipping still requires either (1) NVIDIA's OK to
bundle `nvngx_vsr.dll` (~19 MB) or (2) the user-fetches-DLL fallback below.

### The runtime DLL / licensing — READ THE EULA (done 2026-07-05)
Read the full `NVIDIA_RTX_Video_SDK_License.pdf` (v. Feb 23 2024 + supplement).
**Revises the earlier "can't redistribute" assumption — bundling IS permitted
under conditions.** (Not legal advice; plain reading of the terms.)

- **Redistribution allowed.** §1(c) grants the right to *"distribute any software
  and materials within the SDK ... incorporated in object code format into a
  software application."* → **We can bundle `nvngx_vsr.dll` inside Media Hub**;
  users do NOT have to fetch it. (The community CLI just *chose* not to bundle.)
- **Conditions to satisfy before public/commercial release:**
  - §2(a) app has material functionality beyond the SDK → ✅ Media Hub does.
  - §4(b) can't ship the DLL as a stand-alone product → ✅ it's bundled.
  - §2(c) distribute under terms "at least as protective" of NVIDIA's IP → **add
    an app EULA/NOTICE** (no reverse-engineer, NVIDIA retains ownership, etc.).
  - §4(a) keep NVIDIA copyright notices intact → ship the DLL untouched.
  - §4(e) don't place the SDK under a copyleft/OSS license requiring source
    disclosure or free redistribution → **MIT is fine (permissive), but the DLL
    must be clearly scoped OUT of our MIT** — a `THIRD-PARTY-NOTICES` entry:
    "nvngx_vsr.dll © NVIDIA, used under the RTX SDK License."
  - Supplement §4 **notify NVIDIA before release** (NGX-based) via
    developer.nvidia.com/sw-notification (company, app, ship date, link).
  - Supplement §5 codec (H.264/H.265) patent licensing is our responsibility —
    already true because of ffmpeg/NVENC, nothing new.
  - Supplement §7 trademark rules if we say "NVIDIA RTX" — attribute correctly.
- **None of this blocks TESTING.** POC runs on our own SDK download → go freely.
  The conditions only attach when we ship it bundled.
- **Fallback still available** if we ever want to avoid bundling: on first enable,
  open NVIDIA's SDK page + have the user drop the DLL in, and Media Hub locates
  it. Now optional (a UX choice), not a legal necessity.
- Size reality: worker ≈ tens of MB, DLL ≈ 19 MB. Weight was never the blocker.

---

## If it graduates: architecture

Fits Media Hub's existing **lazy-downloaded sidecar** pattern (like yt-dlp /
ffmpeg / deno):

```
Media Hub (Tauri/Rust)
  → optional standalone RTX worker (native C++/CUDA, Windows-only)
     → NVDEC decode → RTX VSR (SR + artifact reduction) → NVENC encode
  → ffmpeg remux: original audio, subs, chapters, rotation, color metadata
```

- **Native C++/CUDA worker is mandatory** — no pure-ffmpeg path to the neural
  model. The worker stays isolated from the main app (separate exe, IPC +
  progress over stdout), gated behind **RTX-hardware detection**, and
  **downloaded only when the user first enables** RTX upscale (keeps the base
  installer small).
- ❓ Keeping frames **fully GPU-resident** (NVDEC→VSR→NVENC, no CPU roundtrip) is
  possible but non-trivial CUDA interop — treat as an optimization, not v1.
- **ffmpeg still does the boring-but-important parts:** container demux/remux,
  audio/subs/chapters/rotation passthrough (`-map … -c copy`), color flags
  (Rec.709, full/limited range), VFR/PTS handling. HDR only if the SR model is
  HDR-aware (RTX Video SDK's 10-bit + SDR→HDR suggests maybe — verify).

## UX (author's idea, endorsed)
Optional per-item action → **"Create enhanced version → NVIDIA RTX Video →
Target 1080p / 4K + Quality"**. Original untouched; enhanced saved as a
**sibling derivative** (library already tracks siblings). Warn when: source ≥
target res, already 4K, no RTX GPU present, or expected benefit is minimal.

## Honest verdict
Technically **possible and now well-supported** (dedicated RTX Video SDK with
CUDA + 10-bit). But it's a **weeks-long native C++/CUDA effort in a skillset
this codebase otherwise doesn't have**, for a feature that helps a *minority* of
clips. → **Experimental, opt-in, later.** Gate the whole thing behind the POC:
build the samples, compare to Resolve, and only commit engineering if the RTX
Video SDK genuinely reproduces the "fixes it without ruining it" look.

---

## Sources (checked 2026-07)
- [RTX Video SDK — NVIDIA Developer](https://developer.nvidia.com/rtx-video-sdk)
- [RTX Video SDK — Getting Started](https://developer.nvidia.com/rtx-video-sdk/getting-started)
- [Enhancing Low-Resolution SDR Video with the NVIDIA RTX Video SDK (NVIDIA blog)](https://developer.nvidia.com/blog/enhancing-low-resolution-sdr-video-with-the-nvidia-rtx-video-sdk/)
- [New AI SDKs for Blackwell RTX 50 Series (NVIDIA blog)](https://developer.nvidia.com/blog/new-ai-sdks-and-tools-released-for-nvidia-blackwell-geforce-rtx-50-series-gpus/)
- [Maxine VFX SDK — Video Super Resolution filter (modes VSR_Low..VSR_Ultra, 8-bit)](https://docs.nvidia.com/maxine/vfx/latest/Filters/VideoSuperResolution.html)
- [Maxine VFX SDK — User Guide](https://docs.nvidia.com/maxine/vfx/latest/index.html)
- [VFX-SDK-Samples (GitHub)](https://github.com/NVIDIA-Maxine/VFX-SDK-Samples)
- [RTXVideoProcessor — community CLI (offline RTX VSR on files)](https://github.com/DrC0ns0le/RTXVideoProcessor)
