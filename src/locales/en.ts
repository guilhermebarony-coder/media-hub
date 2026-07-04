// English strings (the source language + fallback for every other locale).
// Keys are namespaced by area ("nav.*", "topbar.*", …). When you add a UI
// string, add its key here first, then translate it in the other locales.
// A missing key in another locale falls back to this file automatically.

export const en: Record<string, string> = {
  // Language picker
  "lang.label": "Language",

  // Left navigation
  "nav.workspace": "Workspace",
  "nav.system": "System",
  "nav.download": "Download",
  "nav.library": "Library",
  "nav.projects": "Projects",
  "nav.settings": "Settings",
  "nav.help": "Help",
  "nav.ready": "ready",

  // Top bar
  "topbar.activeLabel": "Active",
  "topbar.library": "Library",
  "topbar.libraryHint": "reusable, lives forever",
  "topbar.newProject": "New project…",
  "topbar.searchClips": "Search clips…",
  "topbar.searchTitle": "Search clips (Ctrl+Space)",
  "topbar.background": "Run in background — hides to the tray, keeps downloading",
  "topbar.settings": "Settings",
  "topbar.downloadingOne": "downloading",
  "topbar.downloadingMany": "downloads",
  "topbar.activeDownloadsTitle": "{n} active {label} — click to view",
  "topbar.clip": "clip",
  "topbar.clips": "clips",

  // Onboarding — chrome
  "onb.aria": "Welcome to Media Hub",
  "onb.step.welcome": "Welcome",
  "onb.step.library": "Set up your library",
  "onb.step.cookies": "Browser cookies (optional)",
  "onb.step.segments": "How segment downloads work",
  "onb.stepper.current": "Step {n} of 4 · {title}",
  "onb.skip": "Skip",
  "onb.skip.title": "Skip onboarding — you can change all of this later in Settings.",
  "onb.back": "Back",
  "onb.next": "Next",
  "onb.finish": "Finish",

  // Onboarding — welcome
  "onb.welcome.title": "No bloat. Just the clip you need.",
  "onb.welcome.lead":
    "Media Hub is a desktop sourcing tool for editors and creators. Paste a video URL — YouTube, Twitter/X, TikTok, Pinterest, Reddit, Instagram — scrub or punch in timestamps, get only the segment you want — transcoded into a format your NLE actually likes (ProRes / DNxHR / optimized MP4), filed into a tagged library you can search a month later.",
  "onb.welcome.b1.t": "Segment downloads",
  "onb.welcome.b1.d": "never grab a 1-hour video to use 5 seconds of it.",
  "onb.welcome.b2.t": "Edit-friendly transcodes",
  "onb.welcome.b2.d": "ProRes 422 LT and DNxHR SQ bundled. Drop straight into Resolve / Premiere / Avid.",
  "onb.welcome.b3.t": "Tagged library + projects",
  "onb.welcome.b3.d": "every download gets a row. Search and filter by tag, channel, or source.",
  "onb.welcome.b4.t": "Local-first",
  "onb.welcome.b4.d": "files live on your disk in folders you can poke at directly. No cloud lock-in.",

  // Onboarding — configure
  "onb.cfg.title": "Set up your library",
  "onb.cfg.lead": "Two quick decisions. You can change both later in Settings.",
  "onb.cfg.rootLabel": "Library root",
  "onb.cfg.rootPlaceholder": "(default) ~/Media Hub",
  "onb.cfg.browse": "Browse…",
  "onb.cfg.pickTitle": "Choose your library folder",
  "onb.cfg.rootHintPre": "Where downloaded clips live on disk. Leave empty for the default (",
  "onb.cfg.rootHintPost": ").",
  "onb.cfg.presetLabel": "Default transcode preset",
  "onb.cfg.presetHint2":
    "ProRes 422 LT is the editing sweet spot for most B-roll workflows. Pick \"None\" if you want files exactly as downloaded.",

  // Onboarding — cookies
  "onb.ck.title": "Browser cookies — only if you need them",
  "onb.ck.lead":
    "Public videos work without any of this on every supported source. Cookies are only needed for sign-in-walled clips — age-restricted YouTube, private Twitter/X posts, members-only content, and similar. Pick None if you're not sure — flip it on later when you hit the wall.",
  "onb.ck.calloutTitle": "Heads up — browser cookie compatibility",
  "onb.ck.recommended": "Recommended",
  "onb.ck.macOnly": "macOS only",
  "onb.ck.recWhy": "Work while the browser is open. Firefox is the easiest path for daily use.",
  "onb.ck.broken": "Currently broken",
  "onb.ck.brokenWhy":
    "Chrome 127+ added \"App-Bound Encryption\" — yt-dlp can't decrypt cookies from any Chromium browser right now (yt-dlp issue #10927).",
  "onb.ck.tipLabel": "Tip —",
  "onb.ck.tip":
    "if your main browser is Chrome, sign in to YouTube in Firefox once and point Media Hub at Firefox. Or use a cookies.txt export from any browser (file mode below — works while everything is open).",
  "onb.ck.optNone": "None — skip cookies",
  "onb.ck.optBrowser": "Read from browser",
  "onb.ck.optFile": "Read from cookies.txt file",
  "onb.ck.browserLabel": "Browser",
  "onb.ck.brokenSuffix": " (broken — DPAPI)",
  "onb.ck.chromiumWarn":
    "⚠ Chromium browsers can't decrypt cookies right now. Pick Firefox above, or switch to cookies.txt file mode below.",
  "onb.ck.fileLabel": "Path to cookies.txt",
  "onb.ck.fileHint":
    "Netscape-format. Export from your browser with the free \"Get cookies.txt LOCALLY\" extension (Chrome / Firefox). Works even while the browser is open.",

  // Onboarding — workflow
  "onb.wf.title": "The 30-second workflow",
  "onb.wf.lead": "Here's the loop most editors run a hundred times a week:",
  "onb.wf.s1.t": "Paste a URL",
  "onb.wf.s1.d": " on the Download page. Metadata + scrubber load in a second or two.",
  "onb.wf.s2.t": "Scrub to mark segments.",
  "onb.wf.s2.d1": " Hit ",
  "onb.wf.s2.d2": " at the in point, scrub forward, hit ",
  "onb.wf.s2.d3": " at the out point. Repeat for multiple cuts from the same source.",
  "onb.wf.s3.t": "Pick a format + transcode preset",
  "onb.wf.s3.d": ", then download. yt-dlp pulls the source once and ffmpeg trims each segment locally — bandwidth saved.",
  "onb.wf.s4.t": "Files land in your library",
  "onb.wf.s4.d": ", tagged with the channel + source URL. Open them straight in your NLE.",
  "onb.wf.proLabel": "Pro tip — watch folder integration.",
  "onb.wf.proBody":
    "Point your NLE's media browser at ~/Media Hub/Library/raw/ (or your project's raw/ folder). Every clip you download auto-imports. Resolve calls it \"Auto-Sync Bin\"; Premiere has Media Browser; FCP uses watched event folders.",
};
