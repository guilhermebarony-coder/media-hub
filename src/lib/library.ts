import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AssetInput, TranscodePreset } from "./types";

/**
 * Record an asset row in the SQLite library and return its id. Wrapped
 * so callers don't need to remember the command name and so we can
 * swallow errors without breaking the download flow — the file is
 * already on disk; library indexing is non-essential UX.
 *
 * Returns null on failure so the caller can skip the follow-up
 * thumbnail attach without extra error handling.
 */
export async function recordInLibrary(input: AssetInput): Promise<string | null> {
  try {
    return await invoke<string>("library_insert", { input });
  } catch (e) {
    console.warn("library_insert failed (non-fatal):", e);
    return null;
  }
}

/**
 * Extract a mid-clip frame from the downloaded file and record it
 * against the asset. Fire-and-forget — runs after the download flow
 * has already finished and the user sees their result. Library
 * refresh fires automatically via the `library:changed` event so the
 * card updates as soon as the JPG lands on disk.
 */
export async function attachLocalThumbnail(
  assetId: string,
  srcPath: string,
  durationSec: number | null,
): Promise<void> {
  try {
    const res = await invoke<{ path: string }>("media_extract_thumbnail", {
      srcPath,
      assetId,
      durationSec,
    });
    await invoke("library_set_thumbnail", { assetId, path: res.path });
  } catch (e) {
    console.warn("thumbnail extract/set failed (non-fatal):", e);
  }
}

/**
 * 1.2.0 — generate a waveform PNG for an audio-only asset and store
 * it as the asset's thumbnail. Same shape as attachLocalThumbnail
 * above (fire-and-forget post-download), just calls the waveform
 * extractor instead of the frame extractor. Library card treats the
 * resulting path as a normal thumbnail.
 */
export async function attachLocalWaveform(
  assetId: string,
  srcPath: string,
): Promise<void> {
  try {
    const res = await invoke<{ path: string }>("media_extract_waveform", {
      srcPath,
      assetId,
    });
    await invoke("library_set_thumbnail", { assetId, path: res.path });
  } catch (e) {
    console.warn("waveform extract/set failed (non-fatal):", e);
  }
}

/**
 * Resolve an asset's thumbnail to a renderable URL. Prefers the local
 * extracted frame (correct for segment downloads), falls back to the
 * remote YouTube/X CDN URL, then null. Local paths go through
 * `convertFileSrc` so the webview's asset protocol can serve them.
 */
export function thumbnailSrc(
  localPath: string | null,
  remoteUrl: string | null,
): string | null {
  if (localPath) return convertFileSrc(localPath);
  if (remoteUrl) return remoteUrl;
  return null;
}

/**
 * Best-effort codec inference. When a transcode was applied, the file
 * on disk has the preset's codec, not the source's.
 */
export function videoCodecFor(
  preset: TranscodePreset,
  sourceVcodec: string | null | undefined,
): string | null {
  switch (preset) {
    case "prores_422_lt":
      return "prores";
    case "dnxhr_sq":
      return "dnxhd";
    case "h264_mp4":
    case "h264_nvenc_mp4":
      return "h264";
    case "none":
      return sourceVcodec ? sourceVcodec.split(".")[0] : null;
  }
}

export function audioCodecFor(
  preset: TranscodePreset,
  sourceAcodec: string | null | undefined,
): string | null {
  switch (preset) {
    case "prores_422_lt":
    case "dnxhr_sq":
      return "pcm_s16le";
    case "h264_mp4":
    case "h264_nvenc_mp4":
      return "aac";
    case "none":
      return sourceAcodec ? sourceAcodec.split(".")[0] : null;
  }
}

/**
 * Open the OS file explorer with the file highlighted. Falls back to
 * just opening the containing folder on any error.
 */
export async function revealFile(filePath: string): Promise<void> {
  try {
    await revealItemInDir(filePath);
  } catch {
    const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
    const dir = idx > 0 ? filePath.slice(0, idx) : filePath;
    try {
      await openPath(dir);
    } catch {
      // swallow — caller's error state will catch it if it matters
    }
  }
}

/**
 * Open the file in the OS's default application (e.g. mpv for .mp3,
 * Premiere for .mp4 if registered). Used by the library card's
 * double-click + the right-click context menu.
 *
 * 1.2.0 — switched from `openPath` (plugin-opener) to our own
 * `os_open_path` Rust command. plugin-opener enforces a path scope
 * via capabilities (default `$HOME/**`), so files in a relocated
 * library root on E:/ or D:/ failed silently. Our command spawns
 * the OS shell directly — same trust boundary as our other Rust
 * commands.
 */
export async function openFileInDefaultApp(filePath: string): Promise<void> {
  try {
    await invoke("os_open_path", { path: filePath });
  } catch (e) {
    console.warn("openFileInDefaultApp failed:", e);
  }
}
