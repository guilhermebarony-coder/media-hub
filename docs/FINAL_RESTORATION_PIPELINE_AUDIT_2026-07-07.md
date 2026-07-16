# Final restoration pipeline audit — 2026-07-07

## Verdict

The visual recipe remains valid:

```text
conservative edge mask
  -> reflected-border nlmeans_vulkan s=10:p=7:r=15
  -> masked luma DoG sigma 0.6/1.2 strength 1.5
  -> RTX VSR Q4 2x
  -> optional libplacebo deband/dither
```

It generalizes well to Videos 4 and 5. It visibly cleans compressed line art and preserves clean regions without obvious global waxiness or strong halos in the sampled scenes.

It is **not production-correct yet** because the RTX worker shifts content by one frame when VSR is active and fails to drain two decoded frames at EOF.

## 1. Temporal audit — confirmed defects

All tested streams report the correct rational frame rate:

```text
30000/1001 = 29.97002997...
```

The perceived timing problem is not a wrong nominal FPS.

### Exact frame counts

| Stage | Video 4 | Video 5 |
|---|---:|---:|
| Source | 977 | 7793 |
| Prefilter | 977 | 7793 |
| RTX worker | 975 | 7791 |
| Final post | 975 | 7791 |

The worker consistently loses two tail frames. The final libplacebo pass preserves the worker's already-short count.

### One-frame VSR content delay

On a moving five-second region:

- source/pre frame N vs RTX frame N: luma PSNR about **18.05 dB**;
- source/pre frame N vs RTX frame N+1: luma PSNR about **42.41 dB**.

Therefore RTX output frame N+1 corresponds to input frame N.

Control test with both VSR and THDR disabled:

- bypass frame N vs input frame N: about **45.13 dB**;
- bypass frame N+1 vs input frame N: about **18.10 dB**.

The +1 delay is specifically associated with VSR evaluation, not NVDEC/NVENC or the muxer.

Audit image:

![Initial frame audit](assets/video4-initial-frame-audit.png)

### Root cause of the two missing tail frames

The worker packet loop calls `avcodec_send_packet()` and drains available frames after each packet, but on demux EOF it goes directly to **encoder** flushing. It never sends a null packet to the **decoder** and drains delayed decoder frames.

Relevant source:

```text
F:\CLAUDE\rtx-worker-fork\src\main.cpp
packet/decode loop around lines 710–920
encoder-only flush around lines 1086–1088
```

FFmpeg explicitly requires codecs with delay to receive a null packet at EOF, followed by `avcodec_receive_frame()` until `AVERROR_EOF`.

### Required temporal fix

Implement one shared `process_decoded_frame()` path, used by both the normal packet loop and decoder drain:

1. At demux EOF call `avcodec_send_packet(in.vdec, nullptr)`.
2. Receive and process all delayed frames until `AVERROR_EOF`.
3. Treat VSR as a one-frame-latency processor:
   - queue input PTS/duration/metadata;
   - do not assign current input PTS blindly to current VSR output;
   - discard the warm-up output if it is not valid for input frame zero;
   - associate each valid VSR output with the oldest queued input frame;
   - feed/flush the final input as required by the SDK behavior and verify the last frame visually.
4. Only after decoder and VSR drain, flush NVENC.
5. Acceptance test: input count = output count, frame zero aligned, last frame preserved, audio end within one audio packet.

Do not “fix” this by merely changing container FPS or stretching timestamps. The defect is frame association and draining.

## 2. Performance profile

### Full Video 5 timing

| Stage | Time | Share |
|---|---:|---:|
| Prefilter | 205.89 s | 57.4% |
| RTX | 76.69 s | 21.4% |
| libplacebo + final NVENC | 76.39 s | 21.3% |
| Total | 358.96 s | 100% |

### Ten-second prefilter decomposition

| Graph | Throughput |
|---|---:|
| Mask only | 244.9 fps |
| Reflected-border NLM only | 78.0 fps |
| NLM + mask + merge | 61.7 fps |
| Full NLM + mask + exact DoG | 35.0 fps |

The exact DoG/merge chain approximately halves prefilter throughput. In this FFmpeg build it is as important a performance target as NLM.

### nlmeans_vulkan parallelism

The current bundled filter defaults to `t=8`, range 1–64. Full-graph sweep:

| `t` | fps |
|---:|---:|
| 8 | **37.0** |
| 16 | 35.2 |
| 24 | 35.0 |
| 32 | 34.3 |
| 48 | 33.8 |
| 64 | 33.2 |

Keep `t=8`. The old recommendation of 96–128 applied to a different FFmpeg implementation/build and must not be reused here.

## 3. libplacebo post-pass value

RTX raw versus RTX + libplacebo:

| Clip | PSNR between the two versions |
|---|---:|
| Video 4 | 52.18 dB |
| Video 5 | 51.71 dB |

Sampled stills show nearly invisible differences, even with 12x luma-difference maps:

- [30 s comparison](assets/final-pipeline-audit/post-value-t30.png)
- [120 s comparison](assets/final-pipeline-audit/post-value-t120.png)
- [220 s comparison](assets/final-pipeline-audit/post-value-t220.png)

This does not prove that libplacebo is useless: its benefit is most likely temporal gradient stability and dark banding, which stills under-represent. But after NLM+DoG it should no longer be assumed mandatory.

### Recommended product modes

- **Fast/default candidate:** NLM + DoG -> RTX, use worker output directly.
- **Gradient/quality mode:** NLM + DoG -> RTX -> libplacebo.
- Enable the post pass automatically only after a reliable banding/gradient confidence signal exists.

Removing the post pass saves **21.3%** on Video 5 and removes one lossy decode/encode generation.

Gui should perform a direct DaVinci temporal A/B between each `rtx2x_raw1440.mp4` and its `FINAL.mp4`, especially in dark gradients, before changing the default.

## 4. Intermediate encoding quality

Current pipeline performs three lossy encodes:

1. prefilter -> H.264 NVENC QP18;
2. RTX worker -> HEVC NVENC QP21;
3. libplacebo -> HEVC NVENC QP18.

A ten-second high-quality arm used lossless H.264 prefilter and worker QP0. It differed measurably from the normal intermediates (~39.22 dB), but the visual delta was tiny and concentrated around contours.

![QP comparison](assets/final-pipeline-audit/intermediate-q21-vs-qp0.png)

Cost: the QP0 RTX output was **264 MB for ten seconds**. This is not a reasonable default.

Recommendation:

- keep QP18/QP21 for research previews;
- avoid the intermediate encodes entirely in the fused worker;
- if a temporary “master quality” mode is needed before fusion, test QP12–15 rather than QP0.

## 5. Fast DoG approximation test

Tested a one-Gaussian approximation:

```text
clean + 0.5 * (clean - gblur(sigma=1.0))
```

Results:

- exact full graph: 35.0 fps;
- approximation: 41.6 fps;
- only about 16% prefilter improvement;
- stronger/high-frequency edge response after RTX, closer to conventional sharpening.

![Exact vs fast DoG](assets/final-pipeline-audit/exact-dog-vs-fastdog.png)

Reject as the default. The gain is too small for the change in visual character. Preserve exact DoG and port/fuse it on GPU instead.

## 6. Main10 final-output test

The libplacebo branch successfully encoded:

```text
HEVC Main 10
yuv420p10le
limited range
BT.709 matrix / transfer / primaries
30000/1001 fps
```

Ten-second time was 3.96 s, essentially not a new bottleneck. Main10 cannot restore source precision, but it can preserve the higher-precision gradient produced internally by libplacebo and reduce re-quantization risk.

Recommendation:

- offer Main10 as a quality/archive output when libplacebo is enabled;
- keep 8-bit as the compatibility default;
- compare in a true 10-bit playback path before claiming a visible improvement.

Test artifact:

```text
E:\TESTE CLAUDE CODEX\Test video 4 and 5\_analysis\restored\codex\final_audit_main10\video5_t120_libplacebo_main10.mp4
```

## 7. Visual generalization on Videos 4 and 5

Six source-versus-restored samples were generated under:

```text
F:\CLAUDE\media-hub\docs\assets\final-pipeline-audit\
```

Findings:

- clean flat line art remains stable;
- text and graphic edges gain definition without obvious halos;
- compressed hair/face line art improves;
- heavily textured/petal scenes become smoother, so temporal review is still needed to distinguish unwanted grain removal from desired compression cleanup;
- no obvious global color/range shift appeared in sampled frames;
- the reflected-border fix remains effective.

## 8. Updated optimization strategy

### Immediate correctness — P0

1. Drain NVDEC/FFmpeg decoder at EOF.
2. Add explicit one-frame VSR latency handling and VSR tail flush.
3. Preserve exact input frame count and PTS association.
4. Add automated regression tests for 23.976, 25, 29.97, 30, 50 and 59.94 fps, with B-frames and without.

### Low-risk performance — P1

1. Make libplacebo optional and perform Gui's temporal A/B.
2. Keep `nlmeans_vulkan t=8` on this build.
3. Do not use QP0 intermediates by default.
4. Add per-stage CUDA-event/CPU timings to every render manifest.

### Engineering performance — P2

1. Move mask and exact DoG into CUDA inside the RTX worker.
2. Fuse DoG generation and masked merge in one output kernel.
3. Implement active-tile masked NLM; mean mask coverage previously measured at ~10%.
4. Use reflected sampling in the kernel and remove pad/fill/crop passes.
5. Replace synchronous `cuMemcpy2D()` with eligible `cuMemcpy2DAsync(..., stream)` calls.
6. Replace per-frame `cudaStreamSynchronize()` barriers with events and a 3–4-frame surface ring.
7. Feed prefiltered GPU surfaces directly into RTX and final surfaces directly into NVENC.

### Modeled combined result

For Video 5:

- baseline: 359 s;
- remove optional post: ~283 s (measured components, 21% reduction);
- GPU mask/DoG with current NLM: modeled ~200–220 s total without post;
- selective NLM + one decode/encode + async worker: credible path below 180 s, crossing the requested ~50% reduction.

These last numbers are projections until an Nsight trace and prototype exist.

## 9. Adaptive/scene-aware path

Scene-aware processing remains worthwhile, but FFmpeg `blockdetect` returned `nan` on some of these anime clips and should not be trusted as the sole gate.

A better confidence score inside the custom worker should combine:

- conservative mask coverage;
- local variance around structural edges;
- ringing/mosquito energy outside the core edge;
- flat-gradient banding confidence;
- temporal stability over neighboring frames.

Then choose per scene:

- clean: RTX only;
- edge mosquito/compression: masked NLM + DoG -> RTX;
- gradient/banding: RTX + libplacebo/Main10;
- mixed damage: full chain.

Use hysteresis and minimum scene duration so settings do not flicker frame to frame.

## 10. Primary sources

- [FFmpeg decoder API — null packet signals drain/EOF](https://www.ffmpeg.org/doxygen/trunk/group__lavc__decoding.html)
- [FFmpeg decode example — delayed frames must be flushed](https://www.ffmpeg.org/doxygen/6.1/decode_video_8c-example.html)
- [FFmpeg blockdetect implementation](https://ffmpeg.org/doxygen/trunk/vf__blockdetect_8c_source.html)
- [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [NVIDIA RTX Video SDK](https://developer.nvidia.com/rtx-video-sdk/getting-started)
- [NVIDIA NVDEC guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvdec-video-decoder-api-prog-guide/index.html)
- [NVIDIA NVENC application note](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-application-note/index.html)
- [CUDA asynchronous execution](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html)
- [CUDA Graphs](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html)

## Final recommendation

Freeze visual tuning for now. The recipe is good enough that further filter tweaking has lower value than fixing temporal correctness and architecture.

The next implementation sequence should be:

```text
decoder drain + VSR latency fix
  -> temporal A/B to decide optional libplacebo
  -> CUDA exact DoG/mask
  -> active-tile NLM
  -> one-pass asynchronous worker
```

Do not ship or benchmark final quality until the frame association bug is fixed; misaligned comparisons can reverse conclusions and will be visible in DaVinci overlays.
