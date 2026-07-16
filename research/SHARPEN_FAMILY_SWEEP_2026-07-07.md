# Pre-RTX detail-operator sweep — 2026-07-07

## Purpose

Find a replacement or companion for the current masked luma DoG that:

- restores line contrast after masked NLM without a cheap sharpen look;
- remains compatible with conservative masking and future sparse-tile execution;
- is faster, or at least provides a materially different visual tradeoff.

## Controlled test

Source: Video 4, 00:10–00:16, 1280x720 at 30000/1001.

Common graph:

```text
conservative half-resolution edge mask
-> reflected-border nlmeans_vulkan s=10:p=7:r=15:t=8
-> masked luma detail operator
-> RTX VSR quality 4, scale 2
```

No libplacebo post-pass was used, so the clips isolate the pre-RTX operator. Every family has four deliberately family-relative strengths: weak, ideal, strong, and blown.

## Families

### Exact DoG control

Gaussian sigma 0.6 minus Gaussian sigma 1.2, added back to luma only inside the mask.

Strengths: 0.75 / 1.50 / 2.25 / 3.00.

This is the current champion's character: a bounded spatial band rather than generic high-frequency sharpening.

### Bilateral detail

The detail layer is `input - bilateral(input)`, added back to luma only inside the mask. Parameters: sigmaS 2.0, sigmaR 0.12.

Strengths: 0.50 / 1.00 / 1.75 / 2.75.

This is the strongest candidate for a rounder contour treatment. Range weighting makes the base edge-aware, so it is less eager than a Gaussian to smear across a strong line before detail reconstruction. It also maps naturally to a masked/tiled kernel, with a finite spatial halo.

### Fast guided detail

The detail layer is `input - guided(input)`, added back to luma only inside the mask. Parameters: radius 4, eps 0.01, fast mode, subsampling 2.

Strengths: 0.50 / 1.00 / 1.75 / 2.75.

This is the more experimental structural option. Guided filtering is edge-aware and has an efficient box-statistics formulation, which makes it attractive for a custom fused implementation. The strongest settings can produce pale edge shoulders in this footage, so it is not automatically safer than DoG.

## Measured wall time for each six-second clip

| Family | Prefilter mean | RTX mean | Total mean | Prefilter vs DoG |
|---|---:|---:|---:|---:|
| DoG | 5.345 s | 2.622 s | 7.966 s | baseline |
| Bilateral detail | 4.512 s | 2.601 s | 7.113 s | 15.6% faster |
| Guided detail | 5.016 s | 2.630 s | 7.646 s | 6.2% faster |

These are short-run wall-clock measurements, not production benchmarks. Startup cost is included. The strength itself has essentially no timing cost inside a family.

## Preliminary visual audit

- DoG remains the most predictable. The differences scale progressively and stay local to the selected band.
- Bilateral detail is subtler at equivalent labels and looks rounder. It is the best candidate to inspect in motion, especially strong/blown versus DoG ideal/strong.
- Guided detail creates the largest visual separation at high strength. In the sampled contour frame, blown begins showing a brighter shoulder beside dark lines; inspect it as an intentional stress test, not a recommended preset.
- None should be promoted from a still alone. Temporal shimmer, mosquito re-amplification, and mask-boundary breathing must be judged in DaVinci.

## Sparse-mask engineering fit

- DoG: separable Gaussian pair; finite halo roughly 4–5 source pixels for current sigmas; excellent tile candidate.
- Bilateral: finite window and straightforward ROI, but cost per selected pixel is higher and divergence/data-dependent weights complicate a custom GPU kernel. The bundled FFmpeg build also exposes `bilateral_cuda` for a future all-CUDA path.
- Guided: box statistics can be implemented in linear time with separable sliding sums/integral images. ROI processing is possible but needs careful halo/statistics handling around tile boundaries. It is likely the best algorithmic candidate if structural quality wins the eye test.

## Sources

- FFmpeg filter documentation (bilateral, bilateral_cuda, guided, convolution): https://ffmpeg.org/ffmpeg-filters.html
- Kaiming He, Jian Sun, Xiaoou Tang, “Guided Image Filtering,” ECCV 2010: https://mmlab.ie.cuhk.edu.hk/2010/eccv10_Guided.pdf
- Kaiming He and Jian Sun, “Fast Guided Filter,” 2015: https://arxiv.org/abs/1505.00996

## Artifacts

```text
E:\TESTE CLAUDE CODEX\Test video 4 and 5\_analysis\restored\codex\SHARPEN_FAMILY_SWEEP_2026-07-07\
```

- Twelve RTX 1440p clips are in the root.
- `timings.csv` contains per-clip wall times.
- `_pre720` contains the worker inputs.
- `_review` contains four-strength still grids for each family.

