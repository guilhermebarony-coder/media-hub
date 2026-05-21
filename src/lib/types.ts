// Shared types — kept in sync with src-tauri/src/lib.rs + library.rs serializers.

export type SidecarVersion = {
  name: string;
  version: string;
  ok: boolean;
  error: string | null;
};

export type FormatOption = {
  id: string;
  ext: string;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  filesize_bytes: number | null;
  note: string | null;
  has_video: boolean;
  has_audio: boolean;
};

export type VideoMetadata = {
  id: string;
  title: string;
  channel: string;
  duration_sec: number | null;
  thumbnail: string | null;
  upload_date: string | null;
  webpage_url: string;
  view_count: number | null;
  formats: FormatOption[];
};

export type DownloadResult = {
  path: string;
  bytes: number | null;
};

export type ProgressEvent = {
  job_id: string | null;
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
  speed_bps: number | null;
  eta_sec: number | null;
};

export type TranscodeProgress = {
  job_id: string | null;
  processed_sec: number;
  total_sec: number | null;
  percent: number | null;
  speed_mult: number | null;
};

export type TranscodeResult = {
  path: string;
  bytes: number | null;
};

export type TranscodePreset =
  | "none"
  | "prores_422_lt"
  | "dnxhr_sq"
  | "h264_mp4"
  | "h264_nvenc_mp4";

export type TranscodePresetMeta = {
  value: TranscodePreset;
  label: string;
  hint: string;
};

export const TRANSCODE_PRESETS: TranscodePresetMeta[] = [
  { value: "none", label: "None", hint: "keep source as-is" },
  {
    value: "prores_422_lt",
    label: "ProRes 422 LT",
    hint: ".mov · NLE-friendly · ~100 Mbps · default for editing",
  },
  { value: "dnxhr_sq", label: "DNxHR SQ", hint: ".mov · Avid-native intermediate" },
  {
    value: "h264_mp4",
    label: "H.264 MP4 (optimized)",
    hint: ".mp4 · small file · for sharing, not editing",
  },
  {
    value: "h264_nvenc_mp4",
    label: "H.264 MP4 (NVENC, NVIDIA GPU)",
    hint: ".mp4 · 5–10× faster on NVIDIA · errors gracefully if no GPU",
  },
];

// Library

export type AssetInput = {
  source_url: string;
  platform: string;
  video_id: string | null;
  channel: string | null;
  title: string;
  duration_sec: number | null;
  in_sec: number | null;
  out_sec: number | null;
  file_path: string;
  file_size: number | null;
  container: string | null;
  codec_video: string | null;
  codec_audio: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  transcoded_to: string | null;
  thumbnail_url: string | null;
};

export type Asset = AssetInput & {
  id: string;
  downloaded_at: number;
  tags: string[];
};

export type TagCount = {
  name: string;
  count: number;
};

export type LibraryFilters = {
  query?: string | null;
  tags?: string[] | null;
  limit?: number | null;
};
