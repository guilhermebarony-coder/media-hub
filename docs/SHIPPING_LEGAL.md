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
| `nvngx_truehdr.dll` | NVIDIA proprietary | ✅ **DROPPED for real (2026-08-20).** The row used to claim this while the switch was still in Settings and the DLL still in the bundle. Now: the **SDR → HDR** switch is gone, `run_worker` forces `--no-thdr` unconditionally, the DLL is out of `members`, and `tools::RTX_OBSOLETE` deletes any copy an older bundle left in `bin`. Verified against the shipped worker: 2× upscale runs clean with no truehdr DLL on disk. Legal surface is **one** proprietary DLL. |

The MIT source repo must **never contain** `nvngx_vsr.dll`, GPL binaries, or any
non-MIT binary. Binaries live only in the built installer / lazy-download host.

## NVIDIA RTX Video SDK (the gating item)

Per NVIDIA's NGX Programming Guide (docs.nvidia.com/rtx/ngx/programming-guide):

1. **Pre-release notification is REQUIRED.** Before releasing a product with NGX,
   notify NVIDIA at <https://developer.nvidia.com/sw-notification>.
   ⚠️ **Correction (2026-08-20):** this item used to say NVIDIA "returns an
   NGX-compatible application ID", and that we should wire it in once we have
   it. Reading the RTX Video SDK licence supplement §4, the obligation is
   **notification only** — there is no approval step and no application ID is
   issued back. `APP_ID = 0` in the worker is therefore not a placeholder
   waiting on NVIDIA; it is the end state. What still has to happen is the
   notification itself. → **HUMAN action, still open.**
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

### Where this stands in the shipped code (2026-08-20)

Up to 1.14.0 the app lazy-downloaded **both** NVIDIA DLLs from a public GitHub
release asset — exactly the shape item 3 above calls "likely outside the grant".
1.15.0 splits that install; see below.

### DECIDED 2026-08-20: option B, split install

The app no longer takes any NVIDIA binary from the public archive.

| Half | Where it comes from | Licence |
|---|---|---|
| `RTXVideoProcessor.exe`, `cc_32x4.blob` | public GitHub release asset, downloaded on demand | MIT |
| `nvngx_vsr.dll` | **inside the Media Hub installer** (`bundle.resources` in `tauri.windows.conf.json`), copied to `bin` at install time by `tools::place_rtx_runtime`. Reaches the build machine from the PRIVATE `guilhermebarony-coder/media-hub-deps` repo (CI, via `MH_DEPS_TOKEN`) or from a local SDK install. | NVIDIA proprietary |
| `nvngx_truehdr.dll` | nowhere — feature removed | — |

Rejected: **A (leave it)** — the asset URL is compiled into the app, so if the
release asset is ever pulled, the Install button breaks in every copy already
installed, with no fallback. **C (app-tied endpoint)** — buys obscurity, not
compliance; a non-guessable URL is still hosting, and it costs a server plus a
client secret that eventually leaks.

**Why the DLL is copied rather than pointed at.** It must sit beside
`RTXVideoProcessor.exe`. The worker statically links NGX's loader
(`nvsdk_ngx_s`), which resolves feature DLLs from the executable's directory
only. Measured 2026-08-20 against the shipped worker:

| DLL location | Result |
|---|---|
| on `PATH` | `Failed to init RTX GPU path: RTX API create failed` |
| in the working directory | same failure |
| beside the exe | clean run, 24.9 fps |

### Where the build machine gets it

The DLL is in no public place at all. `scripts/fetch-sidecars.ps1` resolves it
in this order:

1. already in `src-tauri/resources/` and matching its sha256 → use it;
2. `MH_DEPS_TOKEN` set (CI) → `gh release download nvngx-vsr-sdk-1.0` from the
   **private** `media-hub-deps` repo, then verify sha256 or `exit 1`;
3. local RTX Video SDK install → copy from it;
4. none of the above → `exit 1` with instructions.

Verified 2026-08-20: the private asset returns **HTTP 404 to an unauthenticated
request**, and the download with credentials matches
`c3d88eea…bf58a1ed`.

`bundle.resources` lives in `tauri.windows.conf.json`, not the shared config —
RTX is Windows-only (`rtx::detect` refuses elsewhere), so the macOS bundle must
not carry NVIDIA's runtime. It also could not: the shared config broke the
macOS job too, at compile time.

### Still owed

- [x] ~~Worker author: recut the archive without the NVIDIA DLLs.~~ **DONE
      2026-08-20** — `rtx-worker-v0.2.0-18` holds `RTXVideoProcessor.exe` +
      `cc_32x4.blob` and nothing else (12,757,040 bytes, sha256
      `8a29e58d…9a235211`). Verified by downloading the published asset back
      and listing it, not by trusting the build. `rtx_worker_spec()` points
      at it.
- [ ] **Delete the `rtx-worker-v0.2.0-15` release asset.** It is still public
      and it still contains both NVIDIA DLLs — that asset, not the new one,
      is the remaining exposure. Not deleted yet because any tester still
      running a Media Hub build that pins v-15 would lose their Install
      button. Do it once everyone is on a build pointing at v-18:
      `gh release delete rtx-worker-v0.2.0-15 --repo guilhermebarony-coder/media-hub --yes`
- [ ] **NSIS uninstall hook** to delete `%APPDATA%\com.guilherme.mediahub\bin`.
      The copy lands there, so today it survives an uninstall — NVIDIA's guide
      asks that the installer remove these DLLs. (No worse than before, when
      the DLL also lived there; but now we are choosing the location.)
- [ ] **File the NVIDIA notification** (item 1 above) — now for VSR only.

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
