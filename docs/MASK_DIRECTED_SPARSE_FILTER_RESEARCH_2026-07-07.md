# Mask-directed sparse NLM and DoG research — 2026-07-07

## Short answer

Yes, the mask can reduce computation substantially, but not with the current FFmpeg graph.

Today the graph does this:

```text
process full frame with NLM / DoG
  -> use mask only during final merge
```

The desired architecture is:

```text
build mask
  -> classify active tiles
  -> process only active tile cores
  -> read a correctly sized halo around each core
  -> blend with the original using the existing soft mask
```

A single rectangular crop is the wrong abstraction for this footage because structural edges are scattered across the image.

## Empirical mask geometry

Measured on 520 samples from Video 5, using the exact conservative mask at 640x360. Tile sizes below are expressed at the 1280x720 source resolution.

### Low threshold — preserve the full feather (`mask > 1`)

| Representation | Mean coverage | Median | P95 |
|---|---:|---:|---:|
| Active pixels | 22.81% | 18.04% | 63.67% |
| One bounding rectangle | 75.80% | 92.11% | 100.00% |
| 8x8 source tiles | 26.55% | 21.95% | 70.62% |
| 16x16 source tiles | 30.79% | 26.62% | 78.14% |
| 32x32 source tiles | 37.43% | 33.53% | 87.29% |
| 64x64 source tiles | 46.66% | 45.42% | 94.17% |

### Stronger threshold (`mask > 32`)

| Representation | Mean coverage | Median | P95 |
|---|---:|---:|---:|
| Active pixels | 14.42% | 10.22% | 43.34% |
| One bounding rectangle | 75.26% | 91.33% | 100.00% |
| 8x8 source tiles | 19.40% | 14.59% | 55.86% |
| 16x16 source tiles | 24.97% | 20.12% | 67.46% |
| 32x32 source tiles | 33.09% | 29.08% | 81.53% |

Conclusion:

- whole-frame processing wastes most work;
- one ROI bounding box saves almost nothing on typical frames;
- sparse 8–16 px tiles are geometrically effective;
- using a strong mask threshold solely for speed risks changing the feathered result;
- the safe first implementation should activate a tile at a very low threshold, then preserve the original soft alpha per pixel.

Measurement script:

```text
F:\CLAUDE\media-hub\scripts\research\measure_mask_tile_occupancy.py
```

## Why a halo is mandatory

Filters do not calculate each output pixel from that pixel alone. A tile must read neighboring source pixels outside its output core.

### Exact NLM dependency

Current parameters:

```text
research size r=15 -> research radius 7
patch size p=7     -> patch radius 3
```

FFmpeg's current source explicitly converts these odd sizes to half radii (`r/2`, `p/2`). The safe NLM input halo is therefore:

```text
research radius + patch radius = 7 + 3 = 10 source pixels
```

Each active output tile reads at least ten pixels beyond every side. Global image boundaries retain reflected sampling.

### DoG dependency

The larger Gaussian is sigma 1.2. A practical Gaussian support of three sigma is approximately four pixels. Use a 4–5 px source halo and verify pixel equivalence against the existing FFmpeg result.

### Seam rule

Tiles may overlap while reading, but write only their non-overlapping core. If every tile reads the same original/clean neighborhood and uses the same boundary rule, tile boundaries do not need feathering and should be mathematically seam-free.

## Why simply patching `maskedmerge` cannot help

`maskedmerge` is downstream. By the time it sees the mask, both full-frame branches have already been calculated.

Likewise, adding `if (mask == 0) return` only to FFmpeg's final NLM denoise shader is insufficient. FFmpeg's Vulkan NLM performs full-frame integral/weight preparation for all research offsets before the final output shader. Most cost has already happened.

Real NLM savings require changing the weight/patch computation itself or implementing a new sparse algorithm.

## Recommended CUDA architecture

CUDA is preferable to a new Vulkan island because the RTX worker already owns CUDA NVDEC surfaces, custom CUDA conversion kernels, RTX evaluation and NVENC output.

### Stage 1 — mask and tile flags

1. Generate the conservative mask at half resolution.
2. Preserve the 8-bit soft mask for the final blend.
3. Max-pool mask values into source-space tiles.
4. Mark a tile active if any mask value is above a very low threshold.
5. Keep temporal hysteresis only for scheduling, never for the actual blend alpha.

Suggested first tile size: 16x16 source pixels. Also benchmark 8x8 and 32x32.

### Stage 2 — simplest dispatch prototype

Do not begin with a complex compaction system.

Launch one CUDA block for every image tile. The first warp checks its tile flag:

```text
inactive -> immediate block return
active   -> load halo and process
```

At 720p with 16x16 tiles there are only 80x45 = 3600 blocks. Scheduling a few thousand blocks that immediately return is cheap relative to NLM. This prototype proves sparse arithmetic with minimal control-flow engineering.

### Stage 3 — compacted work list

If profiler data shows meaningful inactive-block overhead:

- compact active tile indices with an atomic append, prefix scan, or `cub::DeviceSelect`;
- launch a fixed maximum grid and let block N read active tile index N;
- blocks where N exceeds the device-side active count immediately return.

This avoids a device-to-host active-count synchronization. Because tile order is irrelevant, a simple atomic append may outperform a full scan at only 3600 candidates.

Vulkan has `vkCmdDispatchIndirect`, but CUDA avoids Vulkan/CUDA interoperability and is a better fit for this worker. Vulkan indirect dispatch remains viable only if modifying FFmpeg's Vulkan filter directly.

## Sparse DoG design

DoG is the easier and lower-risk first target.

For every active tile:

1. Load luma plus 4–5 px halo into shared memory.
2. Compute the sigma 0.6 and sigma 1.2 Gaussian responses.
3. Calculate `1.5 * (G0.6 - G1.2)`.
4. Add to clean luma.
5. Blend with clean luma using the original soft mask.
6. Copy chroma unchanged.

Fuse DoG and masked merge into the same output kernel. Avoid writing two full intermediate blurred frames.

Expected benefit: the current full prefilter falls from 61.7 fps after NLM+mask to 35 fps after exact DoG. A sparse fused GPU DoG should recover much of that lost throughput without changing the filter's visual character.

## Sparse NLM design options

### Option A — custom tile kernel, recommended prototype

Each active block computes NLM only for its output core and loads the required ten-pixel halo.

Advantages:

- direct mask-aware work elimination;
- reflected boundaries can be built into sampling;
- no full-frame padded copy;
- fuses naturally with DoG and merge.

Risk:

- a naive patch comparison is extremely expensive: 225 research positions x 49 patch samples per output pixel;
- the implementation must reuse work within the tile, use shared memory and/or local integral/box-sum techniques.

### Option B — active-tile local integral images

For each research offset, calculate squared differences only over active tile cores plus patch halo, then perform a local box sum.

This more closely matches FFmpeg's current algorithm while avoiding full-frame work. Neighboring tiles may redundantly calculate overlapping halos, but this is acceptable if active coverage is low.

### Option C — tile atlas

Pack active tiles and their halos into a dense atlas and run a batched NLM kernel.

This improves memory regularity but halo overhead is significant:

- 16x16 core with 10 px halo becomes 36x36 storage, ~5.1x core area;
- 32x32 core becomes 52x52, ~2.6x;
- 64x64 core becomes 84x84, ~1.7x.

An atlas is therefore more attractive at 32–64 px tiles, while occupancy measurements favor smaller tiles. Benchmarking is required.

### Option D — connected rectangular ROIs

NPP supports rectangular ROI filtering and source-pointer offsets. This is useful for a few large contiguous regions, but the measured single bounding box covers 75–92% of the image. Connected-component labeling and many NPP calls add complexity and launch overhead.

Use this only as a hybrid for large components; do not make it the primary design.

## Hybrid strategy

Sparse processing is not always faster. P95 tile coverage reaches 78% for 16x16 tiles at the low threshold.

Choose per frame/scene:

```text
active tiles < ~50–60% -> sparse kernel
active tiles >= threshold -> dense/full-frame kernel
```

The crossover must be measured with CUDA events. Hysteresis prevents toggling modes on adjacent frames.

For very clean scenes, a third path can bypass NLM/DoG entirely and run RTX only.

## Estimated speed ceiling

With 16x16 tiles and the full feather, average occupancy was ~31%, suggesting a geometric upper bound of roughly 3.2x on work that scales perfectly with active output area.

Real gains will be smaller because of:

- mask generation;
- tile checks/compaction;
- halo reads and redundant overlap;
- NLM offset setup and memory traffic;
- high-coverage frames;
- RTX and encoding stages unaffected by sparse filtering.

Practical targets:

- sparse fused DoG: 2–4x DoG stage speed;
- sparse NLM: 1.8–3x NLM stage speed after optimization;
- combined prefilter: approximately 2x is plausible;
- combined with optional post removal and one-pass worker: total pipeline reduction beyond 50% remains credible.

These are engineering targets, not measured results.

## Prototype order

1. Implement CUDA mask generation and confirm pixel-equivalent mask output.
2. Implement sparse exact DoG on 16x16 tiles; compare against FFmpeg exact DoG with amplified difference maps.
3. Test 8/16/32 tile sizes and sparse/dense crossover.
4. Implement a simple sparse NLM kernel with full-grid early return.
5. Profile arithmetic, memory, occupancy and halo redundancy with Nsight Compute.
6. Add tile-list compaction only if inactive block launch overhead matters.
7. Fuse NLM output, DoG and soft masked merge.
8. Integrate directly before RTX in the worker.

## Correctness tests

- pixel difference against the existing full-frame filter;
- no tile seams at 8x amplified residual;
- reflected global image borders;
- identical soft-mask transition;
- rain, grain and fine hair retention;
- deterministic output across tile sizes;
- no frame-to-frame scheduling flicker;
- exact frame count/PTS after the separate worker temporal fix.

## Primary sources

- [FFmpeg Vulkan NLM source — research/patch radii and full-frame pipelines](https://www.ffmpeg.org/doxygen/trunk/vf__nlmeans__vulkan_8c_source.html)
- [CUDA programming guide](https://docs.nvidia.com/cuda/cuda-programming-guide/index.html)
- [CUDA tile/SIMT kernel model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)
- [CUDA kernel blocks, shared memory and atomics](https://docs.nvidia.com/cuda/archive/13.1.0/cuda-programming-guide/02-basics/writing-cuda-kernels.html)
- [NVIDIA CUB device/block primitives](https://nvidia.github.io/cccl/unstable/cub/index.html)
- [NPP ROI conventions](https://docs.nvidia.com/cuda/archive/12.0.0/npp/nppi_conventions_lb.html)
- [NPP image filtering APIs](https://docs.nvidia.com/cuda/archive/13.0.1/npp/image_filtering_functions.html)
- [Vulkan indirect compute dispatch](https://registry.khronos.org/VulkanSC/specs/1.0-extensions/man/html/vkCmdDispatchIndirect.html)

## Final recommendation

Build a custom CUDA sparse-tile prefilter inside the RTX worker. Start with DoG because it is easy to make exact and currently consumes about half of prefilter throughput. Then replace the full-frame Vulkan NLM with a tile-local implementation.

Do not spend time on a single bounding crop, and do not expect downstream masking to save compute. The measured mask geometry proves that scattered tile processing is the correct abstraction.
