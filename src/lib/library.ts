import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AssetInput, TranscodePreset } from "./types";

/**
 * Record an asset row in the SQLite library. Wrapped so callers don't
 * need to remember the command name and so we can swallow errors
 * without breaking the download flow — the file is already on disk;
 * library indexing is non-essential UX.
 */
export async function recordInLibrary(input: AssetInput): Promise<void> {
  try {
    await invoke<string>("library_insert", { input });
  } catch (e) {
    console.warn("library_insert failed (non-fatal):", e);
  }
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
