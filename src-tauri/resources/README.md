# Bundled resources

Files here are packed into the Media Hub installer (`tauri.conf.json` →
`bundle.resources`) and end up in the app's install directory.

## `nvngx_vsr.dll` — NOT in this repo, you must drop it in

**This file is NVIDIA proprietary and must never be committed.** `.gitignore`
excludes `src-tauri/resources/*.dll`; if you ever see one staged, stop.

### Where to get it

`scripts/fetch-sidecars.ps1` handles this. It takes the first that works:

1. **already here** and matching sha256 `c3d88eea…bf58a1ed` — nothing to do;
2. **CI**: `MH_DEPS_TOKEN` set → pulled from the private
   `guilhermebarony-coder/media-hub-deps` repo, sha256 verified;
3. **local**: copied from an RTX Video SDK install
   (<https://developer.nvidia.com/rtx-video-sdk>, free developer account —
   the file is `bin/Windows/x64/rel/nvngx_vsr.dll`). On Gui's machine the SDK
   is already unpacked at `E:\TESTE RTX VIDEO\sdk`;
4. otherwise it stops with `exit 1` and tells you which of the above to fix.

Without it, `npm run tauri build` fails at COMPILE time with `resource path
resources/nvngx_vsr.dll doesn't exist` (measured -- earlier than the bundle
step this file used to claim). That is deliberate: a Media Hub installer that
silently lacks the runtime would ship an "Install enhancer" button that
downloads a worker which then dies at RTX init.

### Why it is here and not in the download

The RTX worker arrives as a public GitHub release asset. NVIDIA's grant covers
redistribution *incorporated into an application*; a proprietary binary sitting
at a URL anyone can `curl` is the standalone case that §4(b) excludes. Shipping
it inside our own installer is the co-distribution model NVIDIA's NGX guide
describes. The public archive therefore carries **only MIT-licensed files**
(`RTXVideoProcessor.exe`, `cc_32x4.blob`).

### Why it is copied instead of pointed at

At install time `tools::place_rtx_runtime` copies this DLL into
`%APPDATA%\com.guilherme.mediahub\bin`, next to `RTXVideoProcessor.exe`.

It has to be *beside the executable*. The worker statically links NGX's loader,
which resolves feature DLLs from the executable's own directory only. Measured
2026-08-20 against the shipped worker:

| DLL location | Result |
|---|---|
| on `PATH` | `Failed to init RTX GPU path: RTX API create failed` |
| in the working directory | same failure |
| next to `RTXVideoProcessor.exe` | clean run, 24.9 fps |

So `PATH`/`SetDllDirectory` tricks do not work from our side. The clean fix
would be for the worker to pass a `pathListInfo` to `NVSDK_NGX_*_Init`; until
it does, we copy.

**Open consequence:** because the copy lands in `%APPDATA%`, it survives an
uninstall. NVIDIA's guide asks that the installer remove these DLLs on
uninstall — that needs an NSIS uninstall hook, which is not written yet.

## `nvngx_truehdr.dll` — dropped on purpose

TrueHDR was removed in 1.15.0 and this DLL is no longer shipped anywhere.
`rtx.rs` forces `--no-thdr` on every run, and `tools::RTX_OBSOLETE` deletes any
copy an older bundle left in `bin`. Verified 2026-08-20: the worker runs 2×
upscale fine with `--no-thdr` and no truehdr DLL on disk.

Bringing HDR back means recutting the worker bundle **and** covering truehdr in
the NVIDIA notification. Read `docs/SHIPPING_LEGAL.md` first.
