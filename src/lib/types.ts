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
  /** Project this asset belongs to. NULL = Library. Phase A: Download
   * always passes null. Phase B wires it to the active-project picker. */
  project_id: string | null;
  /** 1.1 Phase 2 — organizational folder. Orthogonal to project_id.
   *  NULL = Uncategorized. Doesn't affect on-disk location. */
  folder_id?: string | null;
  /** 1.2.0 — asset kind. Optional on input (server defaults to "video").
   *  Recognized: "video", "audio". Future: "image", "archive". */
  kind?: AssetKind | null;
};

/** What kind of asset we're holding. Drives card rendering (waveform
 *  for audio vs frame thumbnail for video), filter chips, and how the
 *  inspector lays out metadata. */
export type AssetKind = "video" | "audio";

export type Asset = AssetInput & {
  id: string;
  /** Always populated by the server — defaults to "video" if the row
   *  pre-dates the kind column. */
  kind: AssetKind;
  downloaded_at: number;
  tags: string[];
  /** Local path to extracted thumbnail JPG (~/Media Hub/_thumbnails/<id>.jpg).
   * Null until the post-download extract runs. UI prefers this over
   * `thumbnail_url` because for segment downloads the source's official
   * thumbnail no longer represents the trimmed file. */
  thumbnail_path: string | null;
  /** Count of OTHER assets sharing this asset's source_url. Drives the
   *  "+N siblings" chip on library cards. 0 for solo downloads. */
  sibling_count: number;
  /** 1.3.0 — true when file_path no longer exists on disk (deleted
   *  out-of-band, or its drive is offline). Drives the ⚠ MISSING badge.
   *  Computed per-list by the backend; never auto-deletes. */
  missing: boolean;
};

export type SiblingSummary = {
  id: string;
  title: string;
  thumbnail_path: string | null;
  thumbnail_url: string | null;
  in_sec: number | null;
  out_sec: number | null;
  duration_sec: number | null;
  downloaded_at: number;
  scope_label: string;
};

/** A single In/Out pair in seconds. */
export type Segment = {
  inSec: number;
  outSec: number;
};

// =====================================================================
// Settings (0.8.A foundation, fields filled in B/C)
// =====================================================================

export type CookiesSource =
  | { kind: "none" }
  | { kind: "browser"; browser: string }
  | { kind: "file"; path: string };

export type Settings = {
  cookies_source: CookiesSource;
  library_root: string | null;
  rename_template: string;
  download_concurrency: number;
  bandwidth_limit_kbps: number | null;
  default_transcode_preset: string;
  onboarding_complete: boolean;
  /** Per-platform sticky last-format memory (0.8.C). Key = platform
   * id ("youtube"); value = the format_id last picked for that
   * platform. Restored on metadata load if still present in the
   * fetched format list. */
  last_formats: Record<string, string>;
  /** Scrubber jog sensitivity multiplier (0.9.D). 1.0 = default
   * 80 px-per-second of drag. 0.5 = coarser, 2.0 = finer. */
  jog_sensitivity: number;
  /** 1.2.2 — Browser-extension bridge token. Auto-generated on first
   *  launch (64 hex chars). Regenerating invalidates any previously
   *  paired extension. Required to be non-empty for the bridge to
   *  start at all. */
  bridge_token: string;
  /** 1.2.2 — TCP port the bridge HTTP server binds on (127.0.0.1).
   *  Change requires app restart. */
  bridge_port: number;
  /** 1.2.2 — Master switch. When false, the bridge server doesn't
   *  start at all (extension/script integration disabled). Default true. */
  bridge_enabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  cookies_source: { kind: "none" },
  library_root: null,
  rename_template: "",
  download_concurrency: 3,
  bandwidth_limit_kbps: null,
  default_transcode_preset: "none",
  onboarding_complete: false,
  last_formats: {},
  jog_sensitivity: 1.0,
  bridge_token: "",
  bridge_port: 47821,
  bridge_enabled: true,
};

// =====================================================================
// Rename-template presets (0.8.C)
// =====================================================================

/** Built-in patterns surfaced in Settings → Library. Users can also
 *  type a freeform pattern using the same tokens. The empty string
 *  means "use the legacy yt-dlp default" (title + id). */
export type RenamePreset = {
  value: string;
  label: string;
  hint: string;
};

export const RENAME_PRESETS: RenamePreset[] = [
  {
    value: "",
    label: "Default — title + id",
    hint: "%(title).180B [%(id)s].%(ext)s",
  },
  {
    value: "{channel} - {title}",
    label: "{channel} - {title}",
    hint: "Big Buck Bunny Channel - Trailer.mp4",
  },
  {
    value: "{date} - {title}",
    label: "{date} - {title}",
    hint: "20240315 - Trailer.mp4 (yt-dlp date format)",
  },
  {
    value: "{channel} - {date} - {title}",
    label: "{channel} - {date} - {title}",
    hint: "Channel - 20240315 - Trailer.mp4",
  },
];

// =====================================================================
// Projects (0.6 Phase A)
// =====================================================================

export type Project = {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  asset_count: number;
  /** 1.3.0 — custom on-disk folder. null = legacy managed path
   *  (~/Media Hub/Projects/<slug>/raw/); set = that exact folder, clips
   *  land directly in it. Custom folders are never trashed by the app. */
  root_path: string | null;
};

export type DuplicateMatch = {
  id: string;
  title: string;
  file_path: string;
  project_id: string | null;
  downloaded_at: number;
  scope_label: string;
};

/** Active scope drives both the library filter and (in Phase B) where
 *  new downloads land. */
export type ActiveScope =
  | { kind: "library" }
  | { kind: "project"; id: string; name: string };

/** Tagged-enum filter shape matching Rust's LibraryScope. */
export type LibraryScope =
  | { kind: "any" }
  | { kind: "library" }
  | { kind: "project"; id: string };

/** 1.1 Phase 2 — folder filter for library_list. Three states:
 *   - {kind:"any"} or omitted → no filter (default)
 *   - {kind:"uncategorized"}  → folder_id IS NULL only
 *   - {kind:"id", id:"..."}   → folder_id = id
 */
export type FolderFilter =
  | { kind: "any" }
  | { kind: "uncategorized" }
  | { kind: "id"; id: string };

export type LibraryFilters = {
  query?: string | null;
  tags?: string[] | null;
  scope?: LibraryScope | null;
  folder?: FolderFilter | null;
  limit?: number | null;
  /** 1.3.0 — true → only trashed clips (the in-app Trash view); false/omit
   *  → only live clips. */
  trashed?: boolean | null;
};

export type TagCount = {
  name: string;
  count: number;
};

export type Folder = {
  id: string;
  name: string;
  created_at: number;
  asset_count: number;
};
