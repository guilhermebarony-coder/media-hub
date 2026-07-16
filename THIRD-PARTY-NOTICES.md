# Third-Party Notices

Media Hub bundles or downloads the following third-party components, each spawned
as a separate process (not statically linked). Their licenses are reproduced here
or in the `licenses/` folder of the installed application. Full GPL license texts
and corresponding-source pointers are included with the distributed build.

---

## FFmpeg — GPLv3

FFmpeg (build configured with `--enable-gpl --enable-version3`, including
libx264/libx265/libxvid) is licensed under the **GNU General Public License,
version 3**. Full text: `licenses/GPLv3.txt`.

**Corresponding source:** the exact source and build configuration for the FFmpeg
binary distributed with Media Hub are available at <TODO: our mirror URL>. Written
offer: for three (3) years from receiving this software, you may obtain the
corresponding source by contacting <TODO: contact email>.

© the FFmpeg developers. <https://ffmpeg.org>

## aria2 — GPLv2+

aria2 is licensed under the **GNU General Public License, version 2 or later**.
Full text: `licenses/GPLv2.txt`. Corresponding source and written offer as above.

© the aria2 contributors. <https://aria2.github.io>

## yt-dlp — The Unlicense (public domain)

yt-dlp is released into the public domain under The Unlicense.

© the yt-dlp contributors. <https://github.com/yt-dlp/yt-dlp>

## Deno — MIT License

```
MIT License
Copyright 2018-present the Deno authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

<https://github.com/denoland/deno>

## RTXVideoProcessor (Media Hub fork) — MIT License

Media Hub uses a fork of RTXVideoProcessor by DrC0ns0le, licensed under MIT.
Our fork source is published at <TODO: our fork URL>.

```
MIT License
Copyright (c) DrC0ns0le and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction... [full MIT text as above].
```

<https://github.com/DrC0ns0le/RTXVideoProcessor>

## NVIDIA RTX Video SDK — `nvngx_vsr.dll` (proprietary)

The NVIDIA RTX Video Super Resolution runtime (`nvngx_vsr.dll`) is proprietary
software of NVIDIA Corporation, redistributed under the NVIDIA RTX Video SDK /
NGX Software License Agreement. It is **not** covered by any open-source license
above. © NVIDIA Corporation. All rights reserved.

Use of this component is subject to the NVIDIA license terms:
<https://developer.nvidia.com/rtx-video-sdk>. <TODO: confirm end-user EULA
passthrough text required by the NGX EULA and include it here.>
