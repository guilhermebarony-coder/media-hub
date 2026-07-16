# Shipping / redistribution legal checklist (RTX feature + sidecars)

> **Not legal advice.** This is an engineering-level compliance map so we can ship
> to testers cleanly and know what a public release needs. For a public
> *commercial* release, have a human read each upstream license and consider
> counsel — especially the NVIDIA EULA.

## What we actually redistribute

The app spawns external binaries (sidecars) via CLI — it does **not** statically
link them. Each is a separate process. Media Hub's own source is MIT (confirm in
`/LICENSE`). Components shipped / downloaded to `%APPDATA%\com.guilherme.mediahub\bin`:

| Component | License | Obligation when we ship it |
|---|---|---|
| `ffmpeg.exe` | **GPLv3** (`--enable-gpl --enable-version3`, libx264/x265/xvid) | Ship GPLv3 text + provide **corresponding source** (or written offer, valid 3 yrs). |
| `aria2c.exe` | **GPLv2+** | Ship GPLv2 text + corresponding source / written offer. |
| `yt-dlp.exe` | Unlicense (public domain) | Attribution courtesy only. |
| `deno.exe` | MIT | Include MIT text + copyright. |
| `RTXVideoProcessor.exe` (our fork of DrC0ns0le) | MIT | Include MIT text + copyright. Publish our fork source (MIT requires nothing more, but we host it anyway). |
| `nvngx_vsr.dll` | **NVIDIA proprietary** (RTX Video SDK / NGX EULA) | See NVIDIA section below. **Gating item.** |
| `nvngx_truehdr.dll` | NVIDIA proprietary | **DROP IT** — TrueHDR was removed from the UI, so we don't ship this at all. Shrinks the legal surface to one DLL. |

The MIT source repo must **never contain** `nvngx_vsr.dll`, GPL binaries, or any
non-MIT binary. Binaries live only in the built installer / lazy-download host.

## NVIDIA RTX Video SDK (the gating item)

Per NVIDIA's NGX Programming Guide (docs.nvidia.com/rtx/ngx/programming-guide):

1. **Pre-release notification is REQUIRED.** Before releasing a product with NGX,
   notify NVIDIA at <https://developer.nvidia.com/sw-notification>. NVIDIA returns
   an **NGX-compatible application ID**. → **HUMAN action.** We currently init NGX
   with `APP_ID = 0` in the worker; once we have the real ID, wire it in.
2. **Ship only DLLs for features used** → just `nvngx_vsr.dll` (VSR). Not truehdr.
3. **Co-distribution model:** the DLL installs in the app's folder and the
   installer "should treat these DLLs like other components and remove them on
   uninstall." Interpretation: bundle in the app installer, not scattered.
   ⚠️ **Our lazy-download-from-public-GitHub plan is risky for the DLL** — public
   standalone hosting of NVIDIA's proprietary binary is likely outside the grant.
   OSS sidecars (worker/ffmpeg/yt-dlp/aria2) can lazy-download from GitHub fine;
   the **NVIDIA DLL should ship inside the installer** (or a controlled, app-tied
   endpoint) — for testers, just include it in the build directly.
4. **NGX EULA:** consult the separate NGX/RTX Video SDK EULA for exact attribution
   wording and whether an **end-user EULA passthrough** clause applies (i.e. our
   app's ToS/EULA must surface NVIDIA's terms to the end user). → **HUMAN: read EULA,
   confirm passthrough.**

## GPL obligations (ffmpeg, aria2c)

- App stays proprietary/MIT: invoking a GPL binary as a **separate process** is
  "mere aggregation" — it does not make Media Hub a derivative work.
- BUT we redistribute the GPL binaries, so we owe, for each: the **license text**
  and the **corresponding source** of that exact build (or a written offer good for
  3 years). Practical plan: pin the exact ffmpeg/aria2 build we ship and host (or
  link) its source + build config alongside the download.

## Sidecar packaging plan

- **OSS sidecars** (`RTXVideoProcessor.exe`, `ffmpeg.exe`, `yt-dlp.exe`,
  `aria2c.exe`, `deno.exe`): lazy-download from **our GitHub Releases** — allowed
  by their licenses; ship each license in `THIRD-PARTY-NOTICES.md` + the GPL
  source pointers.
- **`nvngx_vsr.dll`**: NOT on public GitHub. For **testers**, bundle it in the
  build/installer they receive. For public release, bundle in the signed installer
  after the NVIDIA notification + EULA review.

## Minimum to send to TESTERS (compliant)

1. [ ] File the NVIDIA software notification → get app ID. (HUMAN)
2. [ ] Read the NGX/RTX Video SDK EULA; confirm attribution + any end-user
       passthrough. (HUMAN)
3. [x] `THIRD-PARTY-NOTICES.md` shipped with the build (drafted — see repo root).
4. [ ] Bundle `nvngx_vsr.dll` in the tester build (not public host). Drop truehdr.
5. [ ] Include GPLv3 (ffmpeg) + GPLv2 (aria2) license texts + a source pointer /
       written offer in the build.
6. [ ] Wire the real NGX app ID into the worker (replace `APP_ID = 0`). (CLAUDE, once we have the ID)
7. [ ] Tester agreement noting pre-release software, no redistribution. (HUMAN, light)

## Open decisions for Gui
- Confirm Media Hub's app license (assumed MIT).
- Where do GPL source mirrors live (our GitHub, or link upstream build + our config)?
- Public installer signing (code-signing cert) — separate from licensing but
  needed so testers don't get SmartScreen walls.
