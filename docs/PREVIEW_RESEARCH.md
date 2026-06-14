# Preview / Scrubbing Research — "butter-smooth cutting" (the what-if)

Status: research, 2026-06-14. A deep "what if" on making the fetch-time
preview scrub like an NLE timeline, so cutting in/out points feels
instant. Requested explicitly as a blue-sky exploration — not a
committed task. Findings are ranked by bang-for-buck at the end.

---

## 0. Why the current preview feels laggy

Today (`yt_resolve_stream_url` + `Scrubber.tsx`):
- yt-dlp `-g` resolves a **remote** ≤720p MP4 URL on YouTube's CDN.
- An HTML5 `<video>` plays that remote URL. Every seek = an HTTP **range
  request** to the CDN, and the browser can only land on **keyframes**
  (every 2–10 s for H.264/VP9/AV1), then decode forward.
- Net: each scrub re-buffers over the network and snaps to keyframes →
  the "rubber-band, wait, jump" feel. This is inherent to seeking a
  remote long-GOP stream; no amount of UI polish fixes the source.

The fix space splits into two problems that are usually solved
separately in real editors:
1. **Coarse scrub** (drag across the whole clip to find roughly where) —
   wants instant thumbnails, accuracy doesn't matter.
2. **Fine trim** (nudge the exact in/out frame) — wants frame accuracy,
   only over a small window.

---

## 1. ⭐ YouTube storyboards — instant coarse scrub, ~zero cost

**The standout finding.** YouTube already generates the exact thing we
want: a grid of scrub thumbnails (what you see hovering its seek bar).
yt-dlp exposes them as formats (confirmed on a real video):

```
sb0  mhtml  320x180   storyboard
sb1  mhtml  160x90    storyboard
sb2  mhtml  80x45     storyboard
sb3  mhtml  48x27     storyboard
```

- `sb0` (320×180) is plenty for a scrub strip. The whole set for a video
  is a handful of JPEG sheets (a few hundred KB total), fetched in ~1 s —
  **no video download at all**.
- yt-dlp downloads them as `.mhtml` (sheets + a manifest of tile
  coordinates + timestamps). We'd parse the sheet into tiles and map
  playhead-time → tile (same model as the sprite-sheet approach below).
- **This alone would make coarse scrubbing feel instant** for any
  YouTube source, day one, with tiny effort. It's literally how
  YouTube's own hover-preview works
  ([yt-dlp#1553](https://github.com/yt-dlp/yt-dlp/issues/1553),
  [9to5google](https://9to5google.com/2022/06/29/youtube-precise-video-scrubbing/)).
- Caveat: storyboard granularity is coarse (one frame every few seconds)
  and YouTube-only. Great for "find the moment," not for frame-exact
  trims — pair with §3 or §4 for that.

## 2. Local proxy-first scrub — the editor's actual trick

This is what Premiere/Resolve do: **don't scrub the master, scrub a
lightweight proxy.**
- On fetch, kick off a background download of a tiny **144p/240p**
  variant (yt-dlp format `394`/`395` AV1 or `160`/`133` H.264 are
  ~5–20 MB even for long videos), or transcode a proxy with ffmpeg.
- Point the `<video>` at the **local** proxy file (via Tauri's asset
  protocol, already enabled). Local-file seeks are near-instant — no
  network round-trip — and the browser decodes from the nearest local
  keyframe in milliseconds.
- For *frame*-accuracy, transcode the proxy to an **all-intra / short-GOP**
  codec (e.g. `ffmpeg -g 1` H.264, or ProRes Proxy / DNxHR LB — we
  already ship those presets). Every frame becomes a keyframe → every
  seek is exact and instant. This is the single biggest "feels like an
  NLE" lever.
- Cost: a short wait for the proxy to land (mitigated: start playing the
  remote stream immediately, swap to the local proxy when ready). Disk:
  trivially small, and cacheable (§5).

## 3. ffmpeg sprite/filmstrip — universal coarse scrub

For non-YouTube sources (no storyboards), generate our own:
- `ffmpeg -vf "fps=1/2,scale=240:-1,tile=10x10" sprite.jpg` → one sheet,
  one frame every 2 s, mapped to playhead via CSS `background-position`
  ([Mux](https://www.mux.com/articles/extract-thumbnails-from-a-video-with-ffmpeg),
  [sprite gist](https://gist.github.com/IAmStoxe/9a5a16c282a9039f21da20eeace4cfa6)).
- Needs the bytes first, so it pairs naturally with the proxy (§2):
  build the sprite from the proxy as it downloads. One HTTP/disk read
  covers the whole strip (cheap, cache-friendly).

## 4. ⭐⭐ WebCodecs — true frame-by-frame, NLE-grade (the "closest" answer)

The real "video-editor preview" answer. The WebCodecs `VideoDecoder` API
lets us decode **arbitrary frames on demand** without the browser's
keyframe-seek dance — feed encoded chunks, get `VideoFrame`s back, draw
to a `<canvas>`. Frames decode on the **hardware decoder**, so a playhead
drag can render the exact frame under the cursor in ~16 ms
([DMC writeup](https://www.dmcinfo.com/blog/23297/frame-accurate-video-scrubbing-in-the-client/),
[jordi cenzano demo](https://jordicenzano.github.io/frame-accurate-scrubbing/),
[WebCodecs tutorial](https://lionkeng.medium.com/a-tutorial-webcodecs-video-scroll-synchronization-8b251e1a1708)).
This is how browser editors (VidStudio, Rendley) get smooth timelines
([WebCodecs vs ffmpeg.wasm](https://vidstudio.app/blog/webcodecs-vs-ffmpeg-wasm)).

**Why this is unusually viable for *us* specifically:** Tauri on Windows
renders in **WebView2 = Chromium**, where WebCodecs is fully supported.
Our primary platform gets the good path for free. (macOS WKWebView/Safari
support is partial — fall back to §2/§1 there.)

- Approach: keep a decode window around the playhead (decode the GOP
  containing the target frame, cache N frames each side). Demux with a
  tiny MP4 box parser (mp4box.js) or via WebCodecs + a container
  demuxer; feed chunks to `VideoDecoder`; render `VideoFrame` to canvas.
- Best run against the **local proxy** (§2) so chunks come from disk, not
  the CDN. Proxy + WebCodecs together = frame-exact, instant, offline.
- Cost: real engineering (demux, decode-window management, frame cache,
  canvas render loop, codec/browser fallbacks). This is the big build.

## 5. Caching — make the second visit free

- **Storyboard/sprite cache**: keyed by video id, stored in app-data;
  re-fetch only on miss. Storyboards are tiny → cache aggressively.
- **Proxy cache**: keep proxies in a capped LRU dir (e.g. last ~2 GB).
  Re-opening a clip you previewed before = instant, no re-download. If
  the user then downloads the full clip, the proxy can be discarded or
  kept as the editing proxy (ties into the IMPROVEMENTS.md "proxy
  generation" feature — same artifact serves both preview and editing).
- **Decoded-frame cache** (WebCodecs): small ring buffer of recent
  `VideoFrame`s around the playhead so back-and-forth nudging is free.
- **Metadata cache**: we already re-resolve stream URLs per open; cache
  the `-g`/format probe per id for a few minutes so re-opening is instant.

---

## 6. Recommended phasing (effort vs. payoff)

| Step | What | Effort | Payoff |
|------|------|--------|--------|
| 1 | **YouTube storyboards** for hover/coarse scrub (§1) | Low | Huge for "find the moment", instant, YT-only |
| 2 | **Proxy-first local playback** (§2), reuse transcode engine | Med | Instant seeks; offline; feeds editing-proxy feature |
| 3 | **All-intra proxy** (`-g 1`) for frame-exact trim window | Low (on top of 2) | NLE-grade exactness on the cheap |
| 4 | **ffmpeg sprite** for non-YT sources (§3) | Low–Med | Coarse scrub everywhere |
| 5 | **WebCodecs** frame decode on the proxy (§4) | High | True editor-grade timeline (Windows/Chromium) |
| 6 | **Caches** (§5) throughout | Low each | Second visit is free |

**The 80/20:** storyboards (1) + a small all-intra proxy (2+3) gets ~90%
of the "butter smooth" feel for a fraction of the WebCodecs effort, and
both reuse plumbing we already have (yt-dlp formats, the transcode
presets, the asset protocol, the sibling/proxy concept). WebCodecs is the
moonshot that gets the last 10% to literal-NLE territory, and it's
realistic on Windows because WebView2 is Chromium.

## 7. Sources
- yt-dlp storyboards: https://github.com/yt-dlp/yt-dlp/issues/1553
- YouTube precise scrubbing: https://9to5google.com/2022/06/29/youtube-precise-video-scrubbing/
- Frame-accurate scrubbing (WebCodecs), DMC: https://www.dmcinfo.com/blog/23297/frame-accurate-video-scrubbing-in-the-client/
- WebCodecs frame-accurate demo: https://jordicenzano.github.io/frame-accurate-scrubbing/
- WebCodecs tutorial: https://lionkeng.medium.com/a-tutorial-webcodecs-video-scroll-synchronization-8b251e1a1708
- WebCodecs vs ffmpeg.wasm (browser editors): https://vidstudio.app/blog/webcodecs-vs-ffmpeg-wasm
- ffmpeg thumbnails/sprites (Mux): https://www.mux.com/articles/extract-thumbnails-from-a-video-with-ffmpeg
- ffmpeg sprite sheet gist: https://gist.github.com/IAmStoxe/9a5a16c282a9039f21da20eeace4cfa6
