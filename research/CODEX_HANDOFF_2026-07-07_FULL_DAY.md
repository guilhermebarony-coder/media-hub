# Codex full-day handoff — restoration research — 2026-07-07

## Read this first

Gui's current visual winner remains:

```text
conservative edge/compression mask
-> reflected-border nlmeans_vulkan s=10:p=7:r=15:t=8
-> masked luma DoG sigma 0.6/1.2 strength 1.5
-> RTX VSR quality 4, scale 2
-> libplacebo deband iterations 3, threshold 6, radius 24, grain 6, blue dither
```

Do **not** replace DoG 1.5 with the new bilateral/guided experiments yet. Gui inspected all variants in DaVinci and selected the existing recipe as the best quality/viability tradeoff.

## Gui's visual decisions today

### Detail-operator sweep

- Current exact DoG 1.5 remains the winner.
- Stronger/new DoG presentations produced a pale/whitish edge shoulder: visible halo around contours.
- Bilateral detail was second best and looked rounder, but RTX reconstructed less. Its speed advantage did not compensate for the perceived quality loss.
- Guided detail was not competitive; stronger settings also exposed bright edge shoulders.
- The RTX reconstruction benefit is more valuable than the modest prefilter speed reduction from changing operators.

Gui's concise verdict: keep what we have.

### libplacebo threshold sweep

Important correction: the champion manifests for Videos 3/4 use **threshold 6**, not 12.

Tested thresholds 6, 16 and 20 while holding constant:

```text
iterations=3
radius=24
grain=6
dithering=blue
```

Gui's verdict:

- 16/20 consumed grain/texture aggressively;
- they did not remove the large dark compression structures nearly as much as expected;
- therefore threshold should remain 6 for now;
- increasing deband is the wrong tool for the remaining artifact.

The `grain=6` control is already libplacebo regrain. No duplicate regrain stage should be added blindly.

### Remaining visual defect

Large, low-frequency block structures remain visible in dark/flat gradients. This is not ordinary narrow banding. Likely contributors:

- residual H.264 macroblock/quantizer structure;
- coarse dark 8-bit gradients;
- spatially irregular source noise that outlines compression cells;
- possible re-quantization from 8-bit intermediates/final H.264.

Example:

![Dark compression example](assets/2026-07-07-codex-handoff/dark-compression-example.png)

The higher libplacebo threshold removes texture before it removes this structure.

## New test artifacts

### DoG / bilateral / guided sweep

Root:

```text
E:\TESTE CLAUDE CODEX\Test video 4 and 5\_analysis\restored\codex\SHARPEN_FAMILY_SWEEP_2026-07-07\
```

Twelve RTX 1440p clips, Video 4 00:10–00:16:

- DoG strengths 0.75 / 1.50 / 2.25 / 3.00;
- bilateral detail strengths 0.50 / 1.00 / 1.75 / 2.75;
- guided detail strengths 0.50 / 1.00 / 1.75 / 2.75.

All share the same conservative mask, NLM10, reflected border and RTX Q4 2x. No libplacebo post-pass, so the operator is isolated.

Measured means for six seconds, startup included:

| Family | Prefilter | RTX | Total | Prefilter delta |
|---|---:|---:|---:|---:|
| exact DoG | 5.345 s | 2.622 s | 7.966 s | baseline |
| bilateral detail | 4.512 s | 2.601 s | 7.113 s | 15.6% faster |
| fast guided detail | 5.016 s | 2.630 s | 7.646 s | 6.2% faster |

The bilateral CPU implementation was faster in this graph, and this FFmpeg build also exposes `bilateral_cuda`. Nevertheless, Gui rejected it as the default because of reduced reconstruction.

Review grids:

![DoG strength grid](assets/2026-07-07-codex-handoff/dog_strength_grid.png)

![Bilateral strength grid](assets/2026-07-07-codex-handoff/bilateral_strength_grid.png)

![Guided strength grid](assets/2026-07-07-codex-handoff/guided_strength_grid.png)

Observed halo example:

![Edge halo example](assets/2026-07-07-codex-handoff/edge-halo-example.png)

Full operator report:

```text
reports/SHARPEN_FAMILY_SWEEP_2026-07-07.md
```

### Video 3 libplacebo threshold sweep

Segment 00:06–00:22:

```text
E:\TESTE CLAUDE CODEX\Test Video 3\_analysis\restored\codex\PLACEBO_THRESHOLD_SWEEP_t06-t22\
```

Measured post-pass times for sixteen seconds:

| Threshold | Time |
|---:|---:|
| 6 | 5.378 s |
| 16 | 5.440 s |
| 20 | 5.416 s |

Threshold strength has no meaningful runtime effect.

Left to right: threshold 6 / 16 / 20.

![Video 3 threshold sweep](assets/2026-07-07-codex-handoff/video3_placebo_threshold_6-16-20.png)

### Video 4 libplacebo threshold sweep

Segment 00:10–00:16, the region used for the operator samples:

```text
E:\TESTE CLAUDE CODEX\Test video 4 and 5\_analysis\restored\codex\PLACEBO_THRESHOLD_SWEEP_VIDEO4_t10-t16\
```

Measured post-pass times for six seconds:

| Threshold | Time |
|---:|---:|
| 6 | 2.783 s |
| 16 | 2.755 s |
| 20 | 2.709 s |

Left to right: threshold 6 / 16 / 20.

![Video 4 threshold sweep](assets/2026-07-07-codex-handoff/video4_placebo_threshold_6-16-20.png)

## Recommended next visual experiment

Do not increase libplacebo threshold again. Test a **dark/flat masked deblock before placebo**, preserving the current placebo6/grain6.

Minimum useful short sweep:

1. current champion control: placebo6/grain6;
2. masked dark/flat deblock light -> placebo6/grain6;
3. masked dark/flat deblock strong -> placebo6/grain6;
4. masked dark/flat deblock light -> placebo6/grain8.

Purpose of each stage:

- deblock attacks the spatial block-grid structure;
- placebo6 treats gradients/banding without over-cleaning;
- libplacebo grain restores visual cohesion after cleanup.

Protect linework and textured regions. This deblock experiment is **not yet run** and must be treated as a hypothesis.

Also test a P010/Main10 output path. Main10 cannot recover missing source precision, but it may prevent the final post-pass from reintroducing coarse dark quantization. Ensure the graph does not download to `yuv420p` before Main10 encode, or the benefit is lost.

## Planned production architecture

### Functional layout

```text
GPU decode
  -> shared analysis/mask generation
      -> edge/compression mask
      -> dark/flat/block-confidence mask
  -> sparse pre-RTX tile pass
      -> reflected-border NLM only on selected tiles
      -> exact DoG only on selected tiles
      -> feathered composition
  -> RTX VSR
  -> fused post-RTX pass
      -> dark/flat deblock only where selected
      -> libplacebo-like deband threshold 6
      -> grain 6, optionally adaptive
      -> dither / Main10 conversion
  -> NVENC once
```

### Mask responsibilities

Do not force one scalar mask to represent every defect.

1. **Edge/compression mask**
   - selects mosquito/compression cleanup near contours;
   - drives NLM and DoG;
   - current conservative mask remains the baseline.

2. **Dark/flat/block mask**
   - selects large dark compression structures and fragile gradients;
   - drives deblock/deband strength;
   - protects intentional lines and texture.

Both masks can be generated at half or quarter resolution and converted to tile occupancy/confidence metadata.

### Sparse-tile execution

Current measured Video 5 conservative-mask coverage:

- pixel coverage above zero: 22.81%;
- source 8x8 active-tile coverage: 26.55%;
- source 16x16 active-tile coverage: 30.79%;
- source 32x32 active-tile coverage: 37.43%.

Exact report:

```text
reports/MASK_DIRECTED_SPARSE_FILTER_RESEARCH_2026-07-07.md
```

Recommended tile design:

- compact active tile list on GPU;
- NLM halo about 10 source pixels for p7/r15;
- DoG halo about 4–5 source pixels;
- deblock halo aligned to 8x8/16x16 boundaries and substantially smaller;
- process an expanded ROI, then write only the tile interior;
- feather at mask boundaries, not tile boundaries;
- keep all intermediate surfaces resident on GPU.

### Fusion boundaries

Preferred end state:

1. one CUDA/Vulkan preprocessor for mask + sparse NLM + exact DoG;
2. RTX VSR worker processing with correct temporal drain/PTS association;
3. one GPU postprocessor for masked deblock + deband + grain + dither/Main10;
4. one final NVENC encode.

Avoid the current repeated GPU download/upload and three lossy encoding generations.

### Performance expectations

Measured current Video 5 shares:

| Stage | Share |
|---|---:|
| NLM/DoG prefilter | 57.4% |
| RTX | 21.4% |
| libplacebo/final encode | 21.3% |

Sparse NLM/DoG is the largest opportunity. A 35–60% reduction in that stage is plausible but **not yet demonstrated**. Combined with eliminating intermediate encodes/transfers, a total 25–40% pipeline reduction is an engineering target, not a promise.

Masked deblock should be cheap in a fused design because it is local and uses a small halo. Grain is already inside libplacebo and should remain part of the same post-pass. Adding these inside the existing post stage is estimated at roughly 1–3% of total ETA; making them a separate full-frame encode pass would cost around another 20% and should be avoided.

## Temporal correctness still blocks production

The RTX worker currently:

- loses two tail frames because the decoder is not drained at EOF;
- produces a one-frame VSR content delay;
- must not be “fixed” by changing FPS or stretching timestamps.

Required worker work:

- send null packet to decoder at EOF and drain all delayed frames;
- centralize decoded-frame processing;
- queue and associate PTS/duration/metadata with VSR's actual one-frame latency;
- handle VSR warm-up/final flush;
- flush NVENC only after decoder and VSR drain;
- verify input count equals output count and audio end remains aligned.

Full evidence and source locations:

```text
reports/FINAL_RESTORATION_PIPELINE_AUDIT_2026-07-07.md
```

## What Claude should inspect tomorrow

Suggested order:

1. This handoff.
2. `reports/FINAL_RESTORATION_PIPELINE_AUDIT_2026-07-07.md`.
3. `reports/MASK_DIRECTED_SPARSE_FILTER_RESEARCH_2026-07-07.md`.
4. `reports/SHARPEN_FAMILY_SWEEP_2026-07-07.md`.
5. DaVinci A/B of the twelve operator clips, primarily to confirm Gui's rejection and inspect temporal halo/shimmer.
6. DaVinci A/B of Video 3 and Video 4 threshold 6/16/20 clips, confirming grain loss and limited block removal.
7. Design/run the short masked dark/flat deblock sweep without changing the champion pre-RTX recipe.
8. Audit whether a genuine P010/Main10 path survives all the way from libplacebo output to NVENC.
9. Coordinate the RTX decoder/VSR drain fix before any deliverable/full-series workflow.

## Relevant scripts and reproducibility

New sweep script in Media Hub workspace:

```text
F:\CLAUDE\media-hub\scripts\research_sharpen_family_sweep.ps1
```

It generates the twelve operator samples and `timings.csv`. The threshold sweeps also contain their own `timings.csv` files beside the clips.

No production Media Hub code was changed today. Only research scripts, reports and test artifacts were created.

