// In-app Help / Manual content.
//
// This mirrors docs/MANUAL.md and is the SOURCE the Help page renders +
// searches. Every entry's `id` is a STABLE anchor: the planned per-button
// (?) icons will deep-link to #<id> (e.g. /help#dl-download). Never rename
// an existing id once a (?) icon points at it — add new ones, keep old ones.
// Keep this roughly in sync with docs/MANUAL.md when the UI changes.
//
// Translations live in helpContent.<lang>.ts and share these ids — see
// getHelpContent() below.

import { HELP_CONTENT_PT } from "./helpContent.pt";

export type HelpEntry = {
  /** Stable anchor id — matches docs/MANUAL.md. Used for (?) deep-links. */
  id: string;
  /** Category id this entry belongs to (see HELP_CATEGORIES). */
  category: string;
  title: string;
  /** Words people actually search by — powers the search box. */
  keywords: string[];
  /** Body paragraphs (plain text). */
  body: string[];
  /** Optional keyboard shortcut shown as a chip on the entry. */
  shortcut?: string;
  /** Optional highlighted tip line. */
  tip?: string;
};

export type HelpCategory = {
  id: string;
  title: string;
  blurb?: string;
};

/** A full localized help set: categories + entries, all sharing ids. */
export type HelpContent = {
  categories: HelpCategory[];
  entries: HelpEntry[];
};

/**
 * Return the help content for a locale. English today; adding a language is
 * a pure drop-in with NO page changes:
 *   1. Create `helpContent.<lang>.ts` exporting a `HelpContent` whose entry
 *      `id`s and `category` ids are IDENTICAL to the English ones (so the
 *      (?) deep-links + category nav keep working across languages).
 *   2. `import` it here and add a `case "<lang>"` below.
 * Translators only touch `title` / `body` / `tip` / `keywords` strings.
 * Unknown locales fall back to English.
 */
export function getHelpContent(locale: string = "en"): HelpContent {
  switch (locale) {
    case "pt":
      return HELP_CONTENT_PT;
    case "en":
    default:
      return { categories: HELP_CATEGORIES, entries: HELP_ENTRIES };
  }
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "getting-started", title: "Getting started" },
  { id: "core-ideas", title: "Core ideas", blurb: "The handful of concepts worth reading once." },
  { id: "top-bar", title: "Top bar" },
  { id: "download", title: "Download page" },
  { id: "scrubber", title: "Preview / Scrubber" },
  { id: "library", title: "Library page" },
  { id: "projects", title: "Projects page" },
  { id: "settings", title: "Settings" },
  { id: "extension", title: "Browser extension" },
  { id: "troubleshooting", title: "Troubleshooting" },
  { id: "developers", title: "For developers", blurb: "Media Hub is open source — build it, hack on it, or file a good bug." },
];

export const HELP_ENTRIES: HelpEntry[] = [
  // ---------------------------------------------------------------- getting started
  {
    id: "quick-start",
    category: "getting-started",
    title: "Quick start (the 30-second version)",
    keywords: ["getting started", "first time", "how to download", "basics", "start"],
    body: [
      "1. Go to Download (left nav, or press 1).",
      "2. Paste a video URL (YouTube, Twitter/X, Pinterest, etc.) and hit Fetch.",
      "3. Pick a format (or just Best), then press Download.",
      "4. The clip lands in your Library (press 2) with a thumbnail, ready to drag into your editor.",
      "That's the whole loop. Everything else in this manual is detail for when you want it.",
    ],
  },
  {
    id: "shortcuts",
    category: "getting-started",
    title: "Keyboard shortcuts",
    keywords: ["shortcuts", "hotkeys", "keys", "keyboard"],
    body: [
      "1 / 2 / 3 — go to Download / Library / Projects.",
      ", (comma) — open Settings.",
      "Ctrl+Space — open search / command palette.",
      "Space — play/pause in the Scrubber.",
      "← / → — step one frame back / forward.",
      "I / O — mark In / mark Out.",
      "Ctrl (hold) while clicking Download — send that one clip to the Library.",
      "Delete — move the selected clip to Trash.",
      "Esc — close the open drawer or dialog.",
      "Number and letter shortcuts are ignored while you're typing in a text box.",
    ],
  },

  // ---------------------------------------------------------------- core ideas
  {
    id: "idea-library-vs-projects",
    category: "core-ideas",
    title: "Library vs. Projects",
    keywords: ["what is a project", "difference", "scope", "where do clips go", "active", "library"],
    body: [
      "Media Hub has two places a clip can live, chosen by the Active picker in the top bar.",
      "Library — your permanent, reusable shelf. Stock B-roll you'll grab again and again. Clips here live forever until you delete them.",
      "A Project — a temporary bucket for one job (e.g. \"BrandSpot 001\"). Download into a project while you work; when you're done, Finish the project to clear its files and keep your disk clean.",
      "The Active picker decides where new downloads go and what the Library page shows. Switching back to Library is always one click away.",
    ],
  },
  {
    id: "idea-trash",
    category: "core-ideas",
    title: "The Trash (deleting & recovering clips)",
    keywords: ["delete", "recover", "undo delete", "recycle bin", "removed clip", "restore"],
    body: [
      "Deleting a clip from the Library moves it to an in-app Trash first — it's not gone yet, and you can restore it.",
      "Emptying the Trash, or choosing \"permanently delete\", sends the actual files to your operating system's Recycle Bin.",
      "So there are two safety nets before anything is truly lost.",
    ],
  },
  {
    id: "idea-cookies",
    category: "core-ideas",
    title: "Cookies & why some sites need a login",
    keywords: [
      "login", "sign in", "private video", "age restricted", "members only",
      "cookies.txt", "bot check", "video unavailable", "authentication",
    ],
    body: [
      "Some videos won't download unless the site thinks you're logged in — age-restricted, members-only, region-locked, or behind a \"confirm you're not a bot\" wall.",
      "Cookies are how a browser proves you're signed in. In Settings → Sources you can point Media Hub at your browser's cookies so it fetches those videos as you.",
      "You only need this if a download fails asking you to sign in.",
    ],
  },
  {
    id: "idea-presets",
    category: "core-ideas",
    title: "Transcode presets explained",
    keywords: [
      "convert", "prores", "dnxhd", "h264", "format", "codec",
      "editing format", "proxy", "why transcode", "mezzanine",
    ],
    body: [
      "Downloaded video is usually compressed (H.264 / VP9 / AV1) — great for storage, bad for scrubbing on a timeline. Transcoding re-wraps it into an edit-friendly format.",
      "ProRes (Apple) / DNxHD (Avid) — \"mezzanine\" formats that NLEs love; large files, buttery-smooth editing. Best for Premiere / Resolve / FCP.",
      "H.264 — stays small; fine for playback, less ideal as an editing source.",
      "Copy / Remux — just changes the container with no quality loss, and it's instant.",
      "You can set a default in Settings → Transcode, or transcode a clip on demand from the Library.",
    ],
  },
  {
    id: "idea-preview",
    category: "core-ideas",
    title: "Preview quality & the scrubber",
    keywords: ["preview", "scrub", "slow preview", "laggy", "quality", "storyboard", "frame accurate", "jog"],
    body: [
      "Before you download, the Scrubber lets you preview the video and mark exact In/Out points.",
      "To feel smooth it downloads a small \"proxy\" copy in the background. Preview quality (in Settings) trades sharpness for speed — lower quality means faster, lighter previews.",
      "This never affects the quality of what you actually download; it only changes the preview.",
    ],
  },
  {
    id: "idea-background",
    category: "core-ideas",
    title: "Background mode & the tray",
    keywords: ["minimize", "run in background", "tray", "keep downloading", "close", "hide window"],
    body: [
      "Media Hub can hide into the system tray and keep downloading while you work in other apps.",
      "Use the eye icon in the top bar to send it to the tray; click the tray icon to bring the window back.",
    ],
  },

  // ---------------------------------------------------------------- top bar
  {
    id: "topbar-active",
    category: "top-bar",
    title: "Active project picker",
    keywords: ["active", "scope", "switch project", "where clips go", "library dropdown"],
    body: [
      "The dropdown showing \"Active: Library\" (or a project name). It sets where new downloads go and what the Library shows.",
      "Pick Library for permanent stock, a project for a specific job, or \"New project…\" to create one.",
    ],
  },
  {
    id: "topbar-activity",
    category: "top-bar",
    title: "Activity badge",
    keywords: ["downloading indicator", "active downloads", "progress dot", "how many"],
    body: [
      "Only appears while downloads are running. Shows how many are active; click it to jump to the Download page and watch them.",
    ],
  },
  {
    id: "topbar-search",
    category: "top-bar",
    title: "Search clips",
    keywords: ["search", "find clip", "command palette", "quick open"],
    shortcut: "Ctrl+Space",
    body: [
      "Opens the command palette — a quick search over your clips. Type part of a title or channel to jump straight to it.",
    ],
  },
  {
    id: "topbar-background",
    category: "top-bar",
    title: "Run in background (eye icon)",
    keywords: ["background", "tray", "minimize", "keep downloading", "hide", "eye"],
    body: [
      "Hides the window into the system tray while downloads keep running.",
      "Hover the tray icon to see the live download count; click it to bring the window back. The first use shows a one-time hint so you know where the app went.",
    ],
  },
  {
    id: "topbar-settings",
    category: "top-bar",
    title: "Settings (gear icon)",
    keywords: ["settings", "preferences", "options", "gear", "cog"],
    shortcut: ",",
    body: ["Opens the Settings page."],
  },

  // ---------------------------------------------------------------- download page
  {
    id: "dl-fetch",
    category: "download",
    title: "URL box + Fetch",
    keywords: ["paste url", "fetch", "load video", "get info", "metadata"],
    body: [
      "Paste a video / playlist / channel URL and press Fetch (or Enter).",
      "Media Hub reads the video's info — title, duration, available formats, chapters — so you can choose before committing. Nothing is downloaded yet.",
    ],
  },
  {
    id: "dl-fetch-playlist",
    category: "download",
    title: "Fetch playlist",
    keywords: ["playlist", "multiple videos", "batch", "whole list"],
    body: [
      "Appears when the URL is a playlist. Loads every entry so you can pick which ones to queue.",
    ],
  },
  {
    id: "dl-mode",
    category: "download",
    title: "Video / Audio tabs",
    keywords: ["audio only", "mp3", "extract audio", "music", "video vs audio", "podcast"],
    body: [
      "Switch between downloading the full video or audio only (for music, podcasts, sound beds). The format choices below change to match.",
    ],
  },
  {
    id: "dl-formats",
    category: "download",
    title: "Show / Hide format list",
    keywords: ["format", "resolution", "quality", "1080p", "4k", "codec", "bitrate", "which format"],
    body: [
      "Expands the full list of every resolution and codec the source offers, each row showing resolution, codec, and size.",
      "Pick one for precise control, or leave the default Best and let Media Hub choose the highest-quality option.",
    ],
  },
  {
    id: "dl-manual",
    category: "download",
    title: "Manual format mode",
    keywords: ["advanced", "custom format", "format code", "expert", "yt-dlp"],
    body: [
      "Lets you type a raw format selector instead of picking from cards. For power users who know yt-dlp format syntax; most people never need this.",
    ],
  },
  {
    id: "dl-download",
    category: "download",
    title: "Download",
    keywords: ["download button", "start download", "save", "go"],
    tip: "Hold Ctrl while clicking Download to send this one clip to the Library even if a project is active. The button highlights to confirm.",
    body: [
      "The main action. Sends the clip — with exactly the format, trim segments and transcode you picked — into your current Active scope (Library or a project).",
      "The download goes into the batch queue below, and the fetch card frees up immediately. You don't have to wait: paste the next URL and keep going while the queue works through them (several run in parallel).",
      "Watch progress on the queue row; the clip lands in your Library when it finishes.",
    ],
  },
  {
    id: "dl-cancel",
    category: "download",
    title: "Cancel / Stop download",
    keywords: ["cancel", "stop", "abort", "halt download", "partial file"],
    body: [
      "Stops the download. The partial files that download left behind (.part, .ytdl and the pre-merge streams) are cleaned up automatically, so nothing half-finished piles up in your folder.",
      "Only that download's leftovers are removed — other downloads running in parallel, and any complete copy of the same video you already had, are left alone.",
    ],
  },
  {
    id: "dl-open",
    category: "download",
    title: "Open (folder)",
    keywords: ["open folder", "reveal", "find file", "show in explorer", "locate"],
    body: ["After a download finishes, reveals the saved file in your file manager (Explorer / Finder)."],
  },
  {
    id: "dl-playlist-select",
    category: "download",
    title: "Playlist selection",
    keywords: ["select all", "select none", "first 5", "first 10", "choose videos"],
    body: [
      "When a playlist is loaded you get Select all, Select none, and first 5 / first 10 helpers, then a button to queue the chosen entries. Everything selected goes into the download queue.",
    ],
  },
  {
    id: "dl-queue",
    category: "download",
    title: "Download queue",
    keywords: ["queue", "batch", "multiple downloads", "paste list", "bulk"],
    body: [
      "Paste several URLs (one per line) and Queue all to download them in sequence.",
      "Clear completed tidies finished rows out of the list. Retry failed re-attempts any that errored (it only appears when something failed).",
    ],
  },
  {
    id: "dl-duplicate",
    category: "download",
    title: "Duplicate warning / Open existing",
    keywords: ["already downloaded", "duplicate", "same video", "exists"],
    body: [
      "If you've already got this exact video, Media Hub warns you instead of downloading twice and offers to reveal the existing file.",
    ],
  },

  // ---------------------------------------------------------------- scrubber
  {
    id: "scrub-play",
    category: "scrubber",
    title: "Play / pause",
    keywords: ["play", "pause", "watch"],
    shortcut: "Space",
    body: ["Click the video or press Space to play/pause the preview."],
  },
  {
    id: "scrub-step",
    category: "scrubber",
    title: "Step back / forward one frame",
    keywords: ["frame", "previous frame", "next frame", "precise", "arrow keys", "nudge"],
    shortcut: "← / →",
    body: [
      "The arrow buttons (and keys) move exactly one frame at a time — for finding the precise cut point.",
      "These are precision tools, so the fast-preview optimizations stay out of their way.",
    ],
  },
  {
    id: "scrub-jog",
    category: "scrubber",
    title: "Fine scrub (jog)",
    keywords: ["jog", "fine scrub", "slow scrub", "davinci", "drag", "precise seek"],
    body: ["A DaVinci-style jog strip: drag it to scrub slowly (about 1 second per 80 pixels) for frame-hunting without overshooting."],
  },
  {
    id: "scrub-volume",
    category: "scrubber",
    title: "Volume",
    keywords: ["volume", "mute", "sound", "audio level"],
    body: ["Adjusts preview volume only."],
  },
  {
    id: "scrub-in",
    category: "scrubber",
    title: "Mark In",
    keywords: ["mark in", "start point", "in point", "trim start"],
    shortcut: "I",
    body: ["Sets the start of a segment at the current position."],
  },
  {
    id: "scrub-out",
    category: "scrubber",
    title: "Mark Out",
    keywords: ["mark out", "end point", "out point", "trim end", "commit segment"],
    shortcut: "O",
    body: [
      "Sets the end and commits the segment. You can mark several segments and download them all at once.",
    ],
  },
  {
    id: "scrub-clear",
    category: "scrubber",
    title: "Clear segments",
    keywords: ["clear", "reset", "remove all segments", "start over"],
    body: ["Removes all marked segments and any in-progress draft."],
  },
  {
    id: "scrub-chapters",
    category: "scrubber",
    title: "Chapters: jump & add",
    keywords: ["chapters", "markers", "sections", "jump to chapter", "youtube chapters"],
    body: [
      "If the source has chapters, they show as markers. Click a chapter to jump to it, or use its + to add that chapter as a segment instantly — great for grabbing one titled section of a long video.",
    ],
  },
  {
    id: "scrub-segments",
    category: "scrubber",
    title: "Segment list",
    keywords: ["segments", "clips list", "seek segment", "remove segment"],
    body: [
      "Each committed segment appears in a list. Click one to seek to its start, or use its ✕ to remove just that segment.",
    ],
  },

  // ---------------------------------------------------------------- library
  {
    id: "lib-view",
    category: "library",
    title: "Grid view / List view",
    keywords: ["grid", "list", "view mode", "thumbnails", "table", "layout"],
    body: [
      "Toggle between a big thumbnail grid and a compact list (with columns you can resize; double-click a divider to reset).",
    ],
  },
  {
    id: "lib-search",
    category: "library",
    title: "Search box",
    keywords: ["search", "find", "filter by name", "title", "channel"],
    body: ["Filters the current view by title or channel as you type."],
  },
  {
    id: "lib-filter-source",
    category: "library",
    title: "Source / date filter",
    keywords: ["filter", "source", "site", "date added", "when", "youtube only"],
    body: ["Narrow clips by where they came from (YouTube, Twitter, etc.) and when they were added."],
  },
  {
    id: "lib-filter-tags",
    category: "library",
    title: "Tag filter",
    keywords: ["tags", "filter tags", "labels", "categories"],
    body: ["Show only clips carrying the tags you pick."],
  },
  {
    id: "lib-clear-filters",
    category: "library",
    title: "Clear filters",
    keywords: ["clear filters", "reset", "show all", "remove filters"],
    body: ["Drops all active filters and shows everything in scope again."],
  },
  {
    id: "lib-folders",
    category: "library",
    title: "Folders sidebar",
    keywords: ["folders", "organize", "nest", "move", "drag", "collections"],
    body: [
      "Your custom folders. A folder chip does a lot in one place:",
      "Click — filter to that folder. Double-click — rename it. Right-click — more actions (color, delete…).",
      "Drag a folder onto another folder to nest it. Drop clips onto a folder to move those clips in.",
    ],
  },
  {
    id: "lib-folder-new",
    category: "library",
    title: "Create folder",
    keywords: ["new folder", "add folder", "create", "plus"],
    body: ["The + in the folders sidebar makes a new folder."],
  },
  {
    id: "lib-unfiled",
    category: "library",
    title: "Unfiled",
    keywords: ["unfiled", "no folder", "uncategorized", "loose clips"],
    body: ["Clips not in any folder. Drop a clip here to remove it from its folder."],
  },
  {
    id: "lib-rollup",
    category: "library",
    title: "Include subfolders (rollup)",
    keywords: ["subfolders", "include children", "nested", "rollup"],
    body: ["When viewing a folder, toggles whether clips from its subfolders show too."],
  },
  {
    id: "lib-trash",
    category: "library",
    title: "Trash folder",
    keywords: ["trash", "deleted", "recover", "restore", "permanently delete", "recycle", "empty trash"],
    tip: "Right-click Trash in the sidebar for Restore all / Empty trash without opening the view.",
    body: [
      "Holds deleted clips. Restore puts a clip back where it was.",
      "Permanently delete removes it for good — the files go to the OS Recycle Bin, and this can't be undone.",
      "Inside the Trash view, Restore and Empty act on your selection, or on everything when nothing is selected.",
    ],
  },
  {
    id: "lib-card",
    category: "library",
    title: "Clip card",
    keywords: ["clip", "card", "thumbnail", "tile", "open clip"],
    body: [
      "Each clip. Single-click selects it (opens the inspector); double-click or the open action plays it in your default app.",
      "An audio-only clip shows a waveform glyph; a clip whose file was moved or deleted shows a \"not found\" badge.",
    ],
  },
  {
    id: "lib-card-open",
    category: "library",
    title: "Card: Open",
    keywords: ["open", "play", "default app", "watch"],
    body: ["Opens the clip in your system's default player."],
  },
  {
    id: "lib-card-reveal",
    category: "library",
    title: "Card: Reveal in file manager",
    keywords: ["reveal", "show in explorer", "finder", "locate file", "folder"],
    body: ["Opens the folder containing the file and highlights it."],
  },
  {
    id: "lib-card-delete",
    category: "library",
    title: "Card: Move to Recycle Bin",
    keywords: ["delete", "remove", "trash", "recycle bin", "get rid of"],
    shortcut: "Delete",
    body: ["Sends the clip to the Trash (recoverable), then eventually to the OS Recycle Bin."],
  },
  {
    id: "lib-rtx",
    category: "library",
    title: "Enhance with NVIDIA RTX Video",
    keywords: [
      "rtx", "upscale", "enhance", "super resolution", "vsr", "nvidia",
      "quality", "restore", "4k", "improve video",
    ],
    tip: "Best on compressed web footage (a 720p YouTube rip). It rebuilds detail compression destroyed — it can't invent detail that was never filmed.",
    body: [
      "Right-click a clip → Enhance (NVIDIA RTX Video). It runs NVIDIA's Video Super Resolution on your GPU: cleans compression artifacts and rebuilds edges while upscaling, without the plastic look of most AI upscalers.",
      "The enhanced clip is saved next to the original as a sibling — your source file is never modified.",
      "Set up in RTX window… opens a review window instead, where you can preview a slice, compare before/after, and tune the clean-up before committing to the full render.",
      "Needs a supported NVIDIA GPU; the menu entry is hidden on machines that can't run it.",
    ],
  },
  {
    id: "lib-transcode",
    category: "library",
    title: "Transcode a clip you already have",
    keywords: [
      "transcode", "convert", "prores", "dnxhr", "h264", "nvenc",
      "editing format", "premiere", "resolve", "after effects",
    ],
    body: [
      "Right-click a clip → Transcode to… and pick a preset (ProRes 422 LT, DNxHR SQ, H.264, or H.264 NVENC).",
      "Useful when you downloaded something as-is and only later found your editor won't scrub it smoothly — no need to download it again.",
      "It runs as a job in the Download page queue. When it finishes, the transcoded file stays in your Library and the original moves to the Trash, so you're left with one clip, not two. The original is recoverable from the Trash if you want it back.",
    ],
  },
  {
    id: "lib-import",
    category: "library",
    title: "Add your own files (drag and drop)",
    keywords: [
      "import", "drag", "drop", "add file", "own footage", "local file",
      "external", "existing video", "bring in",
    ],
    tip: "Imported clips are first-class — you can upscale, transcode, tag and organize them exactly like downloaded ones.",
    body: [
      "Drag video or audio files from Explorer onto the Library grid. A dashed overlay confirms the drop target.",
      "Files are COPIED into the Media Hub library folder, then read for duration, resolution and codec, and given a thumbnail. Because it's a copy, moving or deleting the original afterwards won't break the card.",
      "Several files at once is fine. Anything that isn't video or audio is ignored.",
      "You can also paste files with Ctrl+V — copy them in Explorer, then paste into the Library.",
    ],
  },
  {
    id: "lib-clipboard",
    category: "library",
    title: "Copy, cut and paste clips like files",
    keywords: [
      "copy", "cut", "paste", "ctrl+c", "ctrl+x", "ctrl+v", "clipboard",
      "explorer", "move file", "export",
    ],
    shortcut: "Ctrl+C / Ctrl+X / Ctrl+V",
    body: [
      "Select clips and press Ctrl+C — the real files go on the Windows clipboard, so you can paste them straight into any Explorer folder, an editor's media bin, or a chat window.",
      "Ctrl+X marks them to be MOVED instead. After you paste somewhere else the file physically leaves the library folder, so the card is flagged as missing — that's expected, and you can clear it with Remove missing.",
      "Ctrl+V does the reverse: files copied in Explorer are imported into the Library.",
    ],
  },
  {
    id: "lib-inspector",
    category: "library",
    title: "Inspector drawer",
    keywords: ["details", "info", "inspector", "drawer", "metadata", "edit clip"],
    body: [
      "The panel on the right for the selected clip — thumbnail, metadata (duration, dimensions, container, size, codec, added date), tags, source URL and the quick actions (open, reveal, send to Eagle, move to Trash).",
      "Select several clips and it switches to a batch view: total size, source breakdown, a shared tag editor and the list of what's selected.",
      "Actions that work on many clips at once — delete, transcode, send to Eagle — live in the right-click menu, so they act on your whole selection.",
      "Press Esc to clear the selection.",
    ],
  },
  {
    id: "lib-tags",
    category: "library",
    title: "Tags (add / remove)",
    keywords: ["tags", "label", "categorize", "add tag", "remove tag", "keyword"],
    body: [
      "Type in the tag box to add a tag (create one on the fly), or ✕ a chip to remove it. Tags power the tag filter and search.",
    ],
  },
  {
    id: "lib-folder-color",
    category: "library",
    title: "Folder color",
    keywords: ["color", "folder color", "colour", "no color", "label color"],
    body: ["Give a folder a color for fast visual scanning; \"No color\" clears it."],
  },
  {
    id: "lib-selection",
    category: "library",
    title: "Selection actions",
    keywords: ["select multiple", "bulk", "multi-select", "batch actions"],
    body: [
      "Select several clips to act on them together (tag all, delete all, move to a folder). A bar shows what's selected; Clear deselects.",
    ],
  },

  // ---------------------------------------------------------------- projects
  {
    id: "proj-list",
    category: "projects",
    title: "All projects list",
    keywords: ["all projects", "list", "open project", "clip count"],
    body: ["Every project with its clip count. Click one to open its detail view."],
  },
  {
    id: "proj-new",
    category: "projects",
    title: "New project",
    keywords: ["new project", "create", "add project", "name"],
    body: [
      "Name and create a project (e.g. \"Drone Reel\"). New downloads go here while it's the Active scope.",
    ],
  },
  {
    id: "proj-finish",
    category: "projects",
    title: "Finish project",
    keywords: ["finish", "done", "complete", "clean up", "close project", "delete files"],
    body: [
      "Wraps a project up: it clears the project's files off your disk to keep things tidy. Use it when the job is delivered.",
    ],
  },
  {
    id: "proj-return",
    category: "projects",
    title: "Return clips to Library",
    keywords: ["return", "move to library", "keep clips", "unassign"],
    body: [
      "Moves a project's clips back to the permanent Library instead of removing them — the files stay on disk. Good for keepers you'll reuse.",
    ],
  },

  // ---------------------------------------------------------------- settings
  {
    id: "set-sources",
    category: "settings",
    title: "Sources (cookies / login)",
    keywords: ["cookies", "login", "browser", "sign in", "private", "age restricted", "cookies.txt", "authentication"],
    body: [
      "Point Media Hub at your browser cookies so it can download videos that require you to be signed in (age-restricted, members-only, etc.).",
      "Either pick a browser to pull cookies from, or supply a cookies.txt file path. Only needed when a download asks you to log in.",
    ],
  },
  {
    id: "set-library",
    category: "settings",
    title: "Library (root + rename)",
    keywords: ["save location", "folder", "where files go", "root", "rename pattern", "filename", "path"],
    body: [
      "Library root — the base folder where downloaded files are stored. Leave blank for the default (~/Media Hub).",
      "Filename pattern — how files are named, e.g. {title} [{id}].",
    ],
  },
  {
    id: "set-downloads",
    category: "settings",
    title: "Downloads (workers + throttle)",
    keywords: ["speed", "concurrency", "parallel", "workers", "throttle", "limit speed", "fast downloads", "aria2"],
    body: [
      "Concurrency / workers — how many downloads run at once.",
      "Speed limit (KiB/s) — cap bandwidth so downloads don't hog your connection.",
      "Fast downloads (aria2) — optional external downloader for big or segmented files; it downloads its helper on first enable.",
    ],
  },
  {
    id: "set-transcode",
    category: "settings",
    title: "Transcode (default preset)",
    keywords: ["default format", "prores", "dnxhd", "convert", "editing format", "preset"],
    body: ["Choose the preset applied by default when you transcode."],
  },
  {
    id: "set-bridge",
    category: "settings",
    title: "Browser bridge (extension)",
    keywords: ["extension", "browser bridge", "pairing", "token", "send to app", "connect browser"],
    body: [
      "Connects the Media Hub browser extension so you can send videos from your browser straight to the app.",
      "Copy URL — the local address the extension connects to. Copy token — the pairing secret.",
      "Generate new token makes a fresh token and unpairs the old one (use if you think it leaked).",
    ],
  },
  {
    id: "set-diagnostics",
    category: "settings",
    title: "Diagnostics (logs + repair)",
    keywords: ["logs", "debug", "versions", "repair", "broken", "ffmpeg missing", "troubleshoot"],
    body: [
      "Read-only health info plus repair tools.",
      "Repair tools re-downloads ffmpeg + deno if they're missing or broken. Try this first if transcoding or previews suddenly fail.",
      "Open logs folder opens the folder with media-hub.log for bug reports. The section also shows the installed yt-dlp / ffmpeg / deno versions.",
    ],
  },
  {
    id: "set-about",
    category: "settings",
    title: "About",
    keywords: ["version", "about", "update", "credits", "license"],
    body: ["App version and info. Media Hub checks for updates and can update itself."],
  },

  // ---------------------------------------------------------------- troubleshooting
  {
    id: "trouble-login",
    category: "troubleshooting",
    title: "\"Sign in / not a bot / video unavailable\"",
    keywords: ["error", "sign in", "bot", "unavailable", "cannot download", "fails"],
    body: ["The site needs you logged in. Set up cookies in Settings → Sources."],
  },
  {
    id: "trouble-transcode",
    category: "troubleshooting",
    title: "Transcode or preview suddenly fails",
    keywords: ["transcode failed", "no packets", "preview broken", "ffmpeg", "deno", "repair"],
    body: ["ffmpeg or deno may be missing or corrupted. Run Settings → Diagnostics → Repair tools."],
  },
  {
    id: "trouble-slow-preview",
    category: "troubleshooting",
    title: "Preview is slow to seek",
    keywords: ["slow", "laggy", "seek", "preview quality", "buffering"],
    body: [
      "Lower the Preview quality; the first seek also has to fetch a proxy, so give it a moment on a new video.",
    ],
  },
  {
    id: "trouble-slow-download",
    category: "troubleshooting",
    title: "Download is slow",
    keywords: ["slow download", "speed", "aria2", "fast"],
    body: ["Enable Fast downloads (aria2) in Downloads settings, especially for large or segmented files."],
  },
  {
    id: "trouble-file-not-found",
    category: "troubleshooting",
    title: "A clip shows \"file not found\"",
    keywords: ["file not found", "missing", "moved", "deleted", "broken clip"],
    body: ["Its file was moved or deleted outside the app. Re-download it, or reveal it to check where it went."],
  },
  {
    id: "trouble-logs",
    category: "troubleshooting",
    title: "Where are the logs?",
    keywords: ["logs", "log file", "media-hub.log", "bug report"],
    body: ["Settings → Diagnostics → Open logs folder (media-hub.log)."],
  },
  {
    id: "trouble-deleted",
    category: "troubleshooting",
    title: "I deleted a clip by accident",
    keywords: ["accident", "recover", "restore", "undo delete", "trash"],
    body: ["Check the Trash folder and Restore it — as long as you haven't permanently deleted it."],
  },

  // ---------------------------------------------------------------- browser extension
  {
    id: "ext-what",
    category: "extension",
    title: "What the browser extension does",
    keywords: ["extension", "add-on", "addon", "browser", "send to app", "chrome", "firefox", "edge"],
    body: [
      "Media Hub has an optional browser extension that adds a \"Send to Media Hub\" button to your browser. Click it on a video and it drops straight into the app's download queue — no copy-pasting URLs.",
      "It's completely optional. Everything works from the app by pasting a URL; the extension just saves you the trip.",
    ],
  },
  {
    id: "ext-install",
    category: "extension",
    title: "Installing the extension",
    keywords: ["install extension", "load unpacked", "developer mode", "chrome extensions", "add"],
    body: [
      "Chrome / Edge / Brave: open chrome://extensions (or edge://, brave://), turn on \"Developer mode\" (top-right), click \"Load unpacked\", and pick the app's `extension` folder.",
      "Firefox: open about:debugging → \"This Firefox\" → \"Load Temporary Add-on\" → pick `manifest.json` in the extension folder. (Firefox forgets it when you close the browser.)",
      "Then pair it with the app — see \"Pairing the extension\".",
    ],
  },
  {
    id: "ext-pair",
    category: "extension",
    title: "Pairing the extension with the app",
    keywords: ["pair", "token", "connect extension", "bridge", "test connection", "couldn't reach app"],
    body: [
      "The extension talks to the app over your own computer (localhost), and a token stops random sites from doing the same. Pair once:",
      "1. In the app: Settings → Browser bridge → Copy token.",
      "2. In the browser: click the Media Hub extension icon → Options → paste the token → Save → Test connection.",
      "A green \"Connected\" message means you're set. If it can't reach the app, make sure the desktop app is open.",
    ],
  },
  {
    id: "ext-use",
    category: "extension",
    title: "Ways to send a video from the browser",
    keywords: ["send video", "download from browser", "shortcut", "right click", "toolbar button", "mp3"],
    body: [
      "Toolbar button (works everywhere): click the extension icon, pick Video / MP3 / M4A / FLAC, hit Send.",
      "In-page button (YouTube, Twitter/X, Reddit, Pinterest, TikTok, Instagram): hover a video and click the little lime \"Media Hub\" button.",
      "Right-click a video/link → Send to Media Hub (some sites block this — use another way there).",
      "Keyboard: Ctrl+Shift+Y sends the current tab as video, Ctrl+Shift+M as MP3. These work even on YouTube.",
      "If Media Hub isn't running when you send, the extension launches it for you and queues the video once it's up.",
    ],
  },
  {
    id: "ext-quickmenu",
    category: "extension",
    title: "Choosing options before sending (quick menu)",
    keywords: [
      "options", "quality", "rename", "transcode", "ctrl click",
      "before download", "1080p", "720p", "audio", "name file",
    ],
    shortcut: "Ctrl+click",
    tip: "Rename names the FILE on disk, not just the card — handy for dropping straight into an edit with the name your project expects.",
    body: [
      "Ctrl+click (Cmd+click on Mac) the in-page \"Media Hub\" button to open a small options menu instead of sending right away.",
      "You can set the quality cap (Best / 1080p / 720p / 480p), switch to audio-only (MP3 / M4A / FLAC), type a filename, and pick a transcode preset — all before the download starts.",
      "A plain click still sends immediately with your saved defaults, so the fast path isn't slowed down.",
    ],
  },
  {
    id: "ext-privacy",
    category: "extension",
    title: "Is the extension safe / private?",
    keywords: ["safe", "private", "privacy", "security", "data", "tracking", "localhost"],
    body: [
      "Yes. The extension only talks to your own computer (127.0.0.1) — it never sends anything to the internet or to us.",
      "It only sends a video URL when you click a button; it never downloads on its own. The pairing token acts as a password so other websites can't fire downloads at your app.",
    ],
  },
  {
    id: "ext-trouble",
    category: "extension",
    title: "Extension won't connect / button missing",
    keywords: ["extension not working", "offline", "can't connect", "button not showing", "reload"],
    body: [
      "\"Media Hub offline\" / can't connect → the desktop app isn't running. Open it and try again.",
      "In-page button doesn't appear → refresh the page (Ctrl+F5); it only shows on freshly loaded pages.",
      "Changed the token in the app → re-open the extension Options, paste the new token, Save.",
      "Edited the extension files → reload it from chrome://extensions (the ↻ icon on the card).",
    ],
  },

  // ---------------------------------------------------------------- troubleshooting (added)
  {
    id: "trouble-download-fails",
    category: "troubleshooting",
    title: "A download fails or errors out",
    keywords: ["download failed", "error", "won't download", "cannot", "unavailable", "extractor"],
    body: [
      "Most download failures are one of three things:",
      "1. The video needs a login → set up cookies (Settings → Sources).",
      "2. The site changed and the downloader is out of date → Settings → Diagnostics shows the yt-dlp version; a newer app build ships a newer yt-dlp.",
      "3. A bad or region-locked URL → try opening it in your browser to confirm it plays.",
      "If it still fails, grab the log (Diagnostics → Open logs folder) and report it — see \"How to report a bug\".",
    ],
  },
  {
    id: "trouble-first-run",
    category: "troubleshooting",
    title: "Stuck on first-run setup / tools won't download",
    keywords: ["first run", "setup", "tools", "ffmpeg download", "deno", "stuck", "loading"],
    body: [
      "On first launch the app downloads its media tools (ffmpeg + deno). If that stalls, it's almost always the network (a firewall/VPN blocking GitHub).",
      "Try again on a normal connection, or use Settings → Diagnostics → Repair tools to re-download them. The app is usable once the tools finish.",
    ],
  },
  {
    id: "trouble-app-wont-start",
    category: "troubleshooting",
    title: "App won't open or shows a blank window",
    keywords: ["won't start", "blank", "white screen", "crash", "black window", "not opening"],
    body: [
      "Fully quit it first — check the system tray (it may be running hidden, since it keeps downloads alive in the background) and choose Quit, then reopen.",
      "If a blank window persists, reinstall over the top (your library and settings are stored separately and aren't touched). Still stuck? Send the log from the logs folder.",
    ],
  },
  {
    id: "trouble-update",
    category: "troubleshooting",
    title: "Updating Media Hub",
    keywords: ["update", "auto update", "version", "not updating", "old version", "new version"],
    body: [
      "When a new version is out, a small notice appears in the corner shortly after launch — click Update now and it downloads, verifies and installs itself, then reopens. The notice only shows once per version, so it never nags.",
      "You can also check whenever you like: Settings → Diagnostics → Check for app updates.",
      "If an update seems stuck, confirm the running version in Settings → About, then fully quit (including from the tray) and reopen so the installer can swap files in.",
      "Reinstalling the latest release over your current install is always safe — settings and library are preserved.",
    ],
  },
  {
    id: "report-bug",
    category: "troubleshooting",
    title: "How to report a bug properly",
    keywords: ["report bug", "bug report", "issue", "feedback", "broken", "how to report", "logs"],
    body: [
      "A good report gets fixed fast. Please include:",
      "1. What you did, what you expected, and what happened instead.",
      "2. The exact URL (if it's a download/fetch problem) — a lot of bugs are site-specific.",
      "3. Your app version (Settings → About) and OS (e.g. Windows 11).",
      "4. The log file — Settings → Diagnostics → Open logs folder → attach `media-hub.log`.",
      "5. A screenshot of any error message.",
      "Send it wherever the project points you (GitHub issues / the release thread). The log is the single most useful thing — it usually shows the real error.",
    ],
  },

  // ---------------------------------------------------------------- for developers
  {
    id: "dev-open-source",
    category: "developers",
    title: "What it's built with",
    keywords: ["open source", "stack", "tech", "tauri", "rust", "react", "typescript", "sqlite"],
    body: [
      "Media Hub is a Tauri 2 desktop app: a Rust core with a React + TypeScript (Vite) frontend, an SQLite library, and yt-dlp / ffmpeg / deno as helper binaries.",
      "The UI talks to Rust through Tauri commands (invoke) and listens to events for live progress. See the repo's docs/ARCHITECTURE.md for the full picture.",
    ],
  },
  {
    id: "dev-run-source",
    category: "developers",
    title: "Run it from source",
    keywords: ["dev setup", "build from source", "run locally", "npm", "cargo", "tauri dev", "develop"],
    body: [
      "You'll need Node.js 20+, the Rust stable toolchain (rustup), and your platform's webview build tools (Windows: VS C++ Build Tools; macOS: Xcode CLT).",
      "Then: `npm install`, fetch the sidecars with `pwsh scripts/fetch-sidecars.ps1` (or the mac .sh), and `npm run tauri dev`. The first Rust build takes several minutes, then it's incremental.",
    ],
  },
  {
    id: "dev-build",
    category: "developers",
    title: "Build an installer",
    keywords: ["build", "installer", "release", "package", "msi", "exe", "bundle"],
    body: [
      "`npm run tauri build` produces the installer for your platform under src-tauri/target/release/bundle.",
      "Releases are tag-driven via GitHub Actions (push a `v*` tag → CI builds Windows + macOS, signs the updater artifacts, and drafts a release). Frontend type-check is `npx tsc --noEmit`; Rust tests are `cargo test` in src-tauri.",
    ],
  },
  {
    id: "dev-structure",
    category: "developers",
    title: "Where the code lives",
    keywords: ["structure", "layout", "files", "modules", "architecture", "where is"],
    body: [
      "Frontend (src/): pages/ (Download, Library, Projects, Settings, Help), components/ (Scrubber, Onboarding, HelpHint…), lib/ (settings, downloads, types, helpContent).",
      "Backend (src-tauri/src/): lib.rs wires everything; feature modules include download/direct, library, settings, tools (lazy ffmpeg/deno), transcode, metadata, playlist, preview, media_extract, bridge (extension server), tray, updater, diag.",
      "Docs (docs/): ARCHITECTURE, ROADMAP, NOTES, IMPROVEMENTS, MANUAL. Read those first.",
    ],
  },
  {
    id: "dev-add-feature",
    category: "developers",
    title: "Add a command or feature",
    keywords: ["add command", "new feature", "tauri command", "invoke", "backend", "contribute code"],
    body: [
      "Backend: write a `#[tauri::command]` in the relevant module, register it in the `generate_handler!` list in lib.rs, then call it from the frontend with `invoke(\"your_command\", { args })`.",
      "For long-running work, emit events (Emitter) and `listen()` on the frontend for progress — that's how downloads/transcodes stream status. Keep the split behavior-neutral and run cargo test + tsc.",
    ],
  },
  {
    id: "dev-extension",
    category: "developers",
    title: "Hack on the browser extension",
    keywords: ["extension dev", "content script", "background", "manifest", "bridge", "loopback"],
    body: [
      "The extension (extension/) is a plain MV3 add-on — no build step. Edit a file and hit the reload icon on chrome://extensions.",
      "It talks to the app's local bridge server (127.0.0.1:47821 by default) with the pairing token from chrome.storage.local as auth. background.js routes messages; content-*.js add the in-page buttons; bridge.js is the shared HTTP client. See extension/README.md.",
    ],
  },
  {
    id: "dev-docs",
    category: "developers",
    title: "How this Help / docs system works",
    keywords: ["help docs", "add topic", "translate", "i18n", "question mark", "tooltip", "manual"],
    body: [
      "In-app Help is rendered from src/lib/helpContent.ts (mirrored by docs/MANUAL.md). Add a topic by appending a HelpEntry with a category; every entry's id is a stable anchor.",
      "The (?) tooltips (HelpHint) deep-link to /help#<id>, and the search (lib/helpSearch.ts) is typo/synonym-tolerant. Translation is a drop-in: add helpContent.<lang>.ts with the same ids and a case in getHelpContent — no page changes.",
    ],
  },
  {
    id: "dev-contribute",
    category: "developers",
    title: "Contributing",
    keywords: ["contribute", "pull request", "pr", "issue", "help out", "github"],
    body: [
      "Issues and PRs are welcome. Keep changes focused, run `npx tsc --noEmit` and `cargo test` before opening a PR, and describe what you changed and why.",
      "Not a coder? Filing clear bug reports with logs (see \"How to report a bug\") and testing new releases is genuinely valuable.",
    ],
  },
];
