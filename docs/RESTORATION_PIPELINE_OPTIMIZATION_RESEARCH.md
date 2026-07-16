# Restoration pipeline optimization research

Date: 2026-07-07  
Scope: masked NLMeans + luma DoG + RTX VSR + libplacebo/NVENC

## Executive conclusion

A 50% reduction in the **prefilter** is realistic. A 50% reduction in the **whole render** is unlikely through FFmpeg option tuning alone; it requires collapsing the separate prefilter, RTX and postfilter renders into one asynchronous GPU pipeline.

The best engineering target is:

```text
NVDEC
  -> CUDA mask (quarter resolution)
  -> mask-aware NLMeans + luma DoG (source resolution)
  -> RTX VSR
  -> post deband/dither
  -> NVENC
```

That means one decode, one encode, no intermediate H.264 files, no Vulkan/CUDA round trips, and no work on pixels that the mask will discard.

## Measured baseline

Current quality recipe:

- conservative low-resolution edge mask;
- reflected 24 px padding;
- `nlmeans_vulkan s=10:p=7:r=15`;
- luma-only DoG, sigma 0.6/1.2, strength 1.5;
- RTX VSR Q4, 2x;
- libplacebo deband/dither and NVENC.

| Clip | Prefilter | RTX | Post + encode/audio | Total |
|---|---:|---:|---:|---:|
| Video 2, 4:17 | 207.36 s | 67.77 s | 68.85 s | 343.98 s |
| Video 3, 1:11 | 70.63 s | 24.16 s | 22.06 s | 116.85 s |

The prefilter is the largest stage, but not because NLMeans alone is necessarily slow.

## What the profiling revealed

### NLMeans itself is much faster than the full prefilter

On the same 8-second / 192-frame Video 2 sample, with reflected padding and `t=128`:

| NLM radius | Isolated NLM throughput |
|---:|---:|
| 5 | 109.9 fps |
| 7 | 106.9 fps |
| 9 | 101.6 fps |
| 11 | 92.9 fps |
| 13 | 83.7 fps |
| 15 | 66.7 fps |

The complete mask + NLM + DoG graph only reached about 27 fps. Therefore the CPU/full-frame mask construction, Gaussian operations, blends, format transitions and synchronization are consuming more time than expected.

### Vulkan NLMeans thread-count tuning is a small win

`nlmeans_vulkan`'s `t` sweep peaked around 96–128 threads. `t=128` was only about 6–7% faster than the current default 36. Useful, but nowhere near the target.

Patch size `p=5` versus `p=7` had virtually no speed effect in this implementation. Reducing search radius is meaningful, but the complete graph only improved around 10–16% between `r=15` and `r=7`.

### The mask covers very little of the frame

Measured on Video 3:

- mean mask coverage: **10.04%**;
- median: **9.06%**;
- maximum frame: **30.58%**.

The current FFmpeg graph still runs NLMeans across 100% of every frame and only then uses the mask to keep roughly 10% of the result. This is the largest avoidable computation.

## Optimization paths, ranked

### 1. Fuse mask, NLM and DoG into the CUDA RTX worker

This has the highest expected return and the cleanest final architecture.

Implement a CUDA preprocessing module operating directly on the decoded NV12 surface before its existing NV12-to-BGRA conversion. It should:

1. Generate the mask at 1/2 or 1/4 linear resolution.
2. Mark occupied 16x16 or 32x32 tiles.
3. Build a compact list of active tiles.
4. Run NLM only for active tiles, with reflected sampling at image boundaries.
5. Run both DoG Gaussian radii while data is tiled/shared where practical.
6. Blend denoised luma + DoG into the source in one final kernel; preserve chroma according to the selected recipe.

Do not merely add `if (mask == 0) return` inside the expensive NLM kernel and still dispatch every pixel/search offset. That saves arithmetic but retains considerable dispatch and memory overhead. Compacted active-tile dispatch or indirect dispatch is the stronger design.

With ~10% average coverage, the NLM component has a theoretical large reduction. Real speedup will be lower because mask generation, integral data, boundary dilation and memory traffic remain full-frame. A conservative engineering target is **2–4x for the selective prefilter**, not 10x.

### 2. Remove per-frame global synchronization in the RTX worker

Local source audit found:

- repeated `cudaStreamSynchronize(m_stream)` at the end of processing paths;
- an extra synchronization between P010-to-NV12 and the next operation, although work in the same CUDA stream is already ordered;
- synchronous `cuMemcpy2D()` for pitched-device ↔ CUDA-array transfers.

Recommended design:

- replace eligible `cuMemcpy2D` calls with `cuMemcpy2DAsync(..., m_stream)`;
- remove intra-stream synchronization where ordering alone is sufficient;
- use CUDA events for ownership transfer to NVENC/FFmpeg instead of blocking the CPU every frame;
- allocate a ring of 3–4 frame workspaces instead of reusing a single staging surface;
- pipeline frame N decode, frame N-1 preprocess/RTX, and frame N-2 encode where hardware resources permit;
- benchmark CUDA Graph capture for the repeatable custom-kernel/copy section. RTX SDK evaluation may need to remain outside the captured graph if its API is not capture-safe.

CUDA streams preserve operation order. NVIDIA explicitly documents that NVDEC and NVENC are independent engines and can operate in parallel with CUDA preprocessing. The current frame-level barriers prevent much of this overlap.

### 3. Eliminate the separate post pass

The present post stage costs 22 seconds on the 71-second Video 3 clip, including another decode and encode. Reimplementing the narrow chosen libplacebo recipe inside the worker is more valuable than micro-optimizing its standalone FFmpeg command.

Options, from simplest to most complex:

- custom CUDA deband + dither kernel after RTX, before BGRA-to-NV12/P010;
- libplacebo C API embedded into the worker using CUDA/Vulkan external-memory and semaphore interoperability;
- keep libplacebo external, but stream raw GPU-compatible surfaces through an interop mechanism rather than compressed intermediate files.

For this fixed recipe, a purpose-built CUDA kernel is probably the lowest-risk option. Preserve the current blue-noise result first; test ordered dithering only as a faster optional mode.

### 4. Test RTX Artifact Reduction as the cleanup engine

RTX Video SDK 1.1 exposes Artifact Reduction as well as Super Resolution through CUDA/Vulkan/DX APIs. This is especially interesting because it could combine cleanup and SR within the same SDK/context, avoiding a separate NLM implementation.

It is not automatically a replacement: earlier AR tests showed luminance shifts, fine-detail/rain loss and artifacts. The worthwhile experiment is weak AR with correct non-zero strength, compared specifically against masked NLM10 on mosquito noise, rain, grain and line stability. If acceptable, this is potentially the fastest operational path.

### 5. Evaluate a masked bilateral substitute

FFmpeg ships `bilateral_cuda`, and NVIDIA NPP provides GPU bilateral filtering. A bilateral filter is cheaper than NLM and fits the actual problem—mosquito noise near structural anime lines—better than generic whole-frame denoising in some scenes.

Run it only in the same conservative mask and compare against NLM10. This is an algorithm change, not a transparent optimization, so visual equivalence is mandatory. OpenCV's CUDA `fastNlMeansDenoisingColored` is another candidate, but conversion and result differences may erase its advantage; OpenCV also explicitly distinguishes its slow pure NLM implementation from the fast approximation.

## Credible speed models

These are projections, not measured results.

Using Video 3's 116.85 s baseline:

| Design | Modeled total | Reduction |
|---|---:|---:|
| FFmpeg tuning only (`t`, possibly smaller `r`) | ~103–109 s | ~7–12% |
| GPU-native mask/DoG, existing three passes | ~76–88 s | ~25–35% |
| Fused worker, one decode/encode, async ring, selective NLM | ~45–60 s | ~49–61% |

The last range is the only credible route to the requested 50% whole-pipeline reduction without lowering quality. It must be validated with GPU traces; RTX and NLM both use compute resources, so their kernels may serialize even when submitted asynchronously.

## Recommended implementation order

### Phase A — measurement and low-risk changes

1. Add CUDA-event timing around decode availability, mask, NLM, DoG, copies, RTX evaluate, conversion and encoder submission.
2. Capture an Nsight Systems trace; establish whether GPU compute or CPU submission/synchronization is limiting.
3. Test `t=128` in the current Vulkan path.
4. Visually test `r=11` and `r=9`; do not change `p` for speed.
5. Test weak RTX AR and masked `bilateral_cuda` against NLM10 on the known hard scenes.

### Phase B — worker scheduling prototype

1. Convert the two RTX array copies to asynchronous copies on `m_stream`.
2. Remove the redundant same-stream P010 conversion barrier.
3. Add a 3-frame surface ring and CUDA events.
4. Verify frame ordering, color, hashes for unchanged paths and encoder lifetime.

This phase is useful even before custom NLM and may expose a free speedup in RTX-only/SR combinations.

### Phase C — fused selective cleanup

1. Port the current mask into CUDA and prove pixel-level equivalence.
2. Implement reflected-border masked NLM with active-tile compaction.
3. Fuse luma DoG and masked merge.
4. Feed the result directly to RTX without encoding.
5. Add the post kernel before the worker's one NVENC output.

## Quality and correctness gates

Every optimization must preserve:

- exact input/output frame rate and timestamps;
- frame count and audio duration;
- Rec.709 matrix/range behavior;
- reflected-border behavior with no blurred edge strip;
- no mask flicker across adjacent frames;
- rain, grain and fine-line survival;
- no new DoG halos;
- stable RTX reconstruction after cleanup.

Use the same hard frames from Videos 2 and 3, plus full-motion wipes in DaVinci. Metrics are useful for detecting accidental changes, but final acceptance remains visual because the target is natural restoration rather than pixel identity.

## Primary sources

- [NVIDIA RTX Video SDK — CUDA/Vulkan APIs, Artifact Reduction and Super Resolution](https://developer.nvidia.com/rtx-video-sdk/getting-started)
- [NVIDIA NVDEC programming guide — decoded frames remain in GPU memory and NVDEC is independent of compute](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvdec-video-decoder-api-prog-guide/index.html)
- [NVIDIA NVENC application note — NVENC/NVDEC can overlap CUDA processing](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-application-note/index.html)
- [CUDA asynchronous execution, streams and events](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html)
- [CUDA Graphs](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html)
- [CUDA Driver API memory copies and `cuMemcpy2DAsync`](https://docs.nvidia.com/cuda/cuda-driver-api/group__CUDA__MEM.html)
- [FFmpeg `nlmeans_vulkan` current source](https://www.ffmpeg.org/doxygen/trunk/vf__nlmeans__vulkan_8c_source.html)
- [FFmpeg filter documentation](https://www.ffmpeg.org/ffmpeg-filters.html)
- [OpenCV CUDA photo denoising APIs](https://docs.opencv.org/master/d1/d79/group__photo__denoise.html)
- [NVIDIA NPP bilateral filtering](https://docs.nvidia.com/cuda/archive/11.1.0/npp/group__image__filter__bilateral__gauss__border.html)

## Bottom line for Claude/Codex

Do not spend the next optimization cycle only tuning FFmpeg flags. The measured mask covers about 10% of the image, yet NLM processes 100%, and the worker serializes/copies every frame despite already owning a full GPU pipeline. The high-value prototype is a mask-aware CUDA prefilter inside the RTX worker, followed by asynchronous frame-ring scheduling and one final NVENC encode.
