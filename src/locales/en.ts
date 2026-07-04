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

  // Settings — page + common
  "set.title": "Settings",
  "set.browse": "Browse…",
  "set.opt.none": "None",
  "set.opt.fromBrowser": "From browser",
  "set.opt.fromFile": "From file",
  "set.reset.confirm": "Reset this section to defaults?",
  "set.reset.title": "Reset section?",
  "set.reset.label": "Reset",

  // Settings — Sources
  "set.sec.sources": "Sources",
  "set.chip.cookies": "browser cookies",
  "set.src.intro":
    "Some videos require sign-in — age-restricted YouTube, private Twitter/X posts, members-only content. Point at a browser you're signed in to and Media Hub will use the cookies. Public videos work without any of this — leave it at None if you don't hit the wall.",
  "set.src.browserLogin": "Browser login",
  "set.src.loginOn": "Media Hub uses cookies the extension syncs from your browser, for restricted downloads.",
  "set.src.loginOff": "Off — restricted/private videos may fail until you enable this (or pick a source below).",
  "set.src.mode": "Mode",
  "set.src.browser": "Browser",
  "set.src.path": "Path",
  "set.src.perSite": "Per-site rules",
  "set.src.noRules": "No per-site rules yet — every site uses the default above.",
  "set.src.addRule": "+ Add site rule…",

  // Settings — Library
  "set.sec.library": "Library",
  "set.chip.library": "root + rename",
  "set.lib.intro":
    "Choose where Media Hub stores downloads and how files are named. Editing the path here only redirects future downloads; use \"Move library\" below to also relocate everything you've already downloaded.",
  "set.lib.root": "Library root",
  "set.lib.rootHint": "Empty = default. Editing here only affects new downloads.",
  "set.lib.move": "Move library",
  "set.lib.moveBtn": "Move existing library to…",
  "set.lib.moving": "Moving…",
  "set.lib.renamePreset": "Rename preset",
  "set.lib.template": "Template",

  // Settings — Downloads
  "set.sec.downloads": "Downloads",
  "set.chip.downloads": "workers + throttle",
  "set.dl.intro":
    "How many downloads run at the same time, an optional speed limit, and per-site format memory.",
  "set.dl.workers": "Parallel workers",
  "set.dl.quality": "Preferred quality",
  "set.dl.qualitySource": "Source (no cap)",
  "set.dl.bandwidth": "Bandwidth",
  "set.dl.throttle": "Throttle",
  "set.dl.fast": "Fast downloads",
  "set.dl.fastFetching": "Downloading the aria2c engine…",
  "set.dl.preview": "Preview quality",
  "set.dl.previewAuto": "Auto (by length)",
  "set.dl.previewStreaming": "Streaming only",
  "set.dl.clearCache": "Clear cache",
  "set.dl.openFolder": "Open folder",
  "set.dl.sticky": "Sticky formats",
  "set.dl.stickyNone": "none yet — first downloaded format per platform is remembered automatically",
  "set.dl.forget": "Forget",
  "set.dl.forgetAll": "Forget all",
  "set.dl.jog": "Scrubber jog",

  // Settings — Transcode
  "set.sec.transcode": "Transcode",
  "set.chip.transcode": "default preset",
  "set.tr.intro":
    "New downloads use this preset by default. You can still pick a different one per download. Keep it on None unless your editor struggles with the raw file.",
  "set.tr.default": "Default preset",

  // Settings — Bridge
  "set.sec.bridge": "Browser bridge",
  "set.chip.bridge": "extension + scripts",
  "set.br.intro":
    "Media Hub runs a tiny server on your own computer (127.0.0.1) so the browser extension can send URLs into the download queue. It's never exposed to the network. Paste the token + URL below into the extension to pair it once.",
  "set.br.enabled": "Enabled",
  "set.br.enabledOn": "server starts on next launch",
  "set.br.enabledOff": "server is off — extension can't reach the app",
  "set.br.port": "Port",
  "set.br.portHint": "change requires app restart",
  "set.br.token": "Token",
  "set.br.copy": "Copy",
  "set.br.copied": "✓ Copied",
  "set.br.regenerate": "Regenerate",

  // Settings — Diagnostics
  "set.sec.diag": "Diagnostics",
  "set.chip.diag": "read-only",
  "set.diag.intro":
    "A quick health check of the bundled tools and where files live. If something feels broken, look here first.",
  "set.diag.tools": "Media tools",
  "set.diag.repair": "Repair tools",
  "set.diag.repairing": "Setting up…",
  "set.diag.recheck": "Re-check versions",
  "set.diag.checking": "Checking…",
  "set.diag.engine": "yt-dlp engine",
  "set.diag.updateEngine": "Update engine now",
  "set.diag.updating": "Updating…",
  "set.diag.app": "Media Hub app",
  "set.diag.checkUpdates": "Check for app updates",
  "set.diag.working": "Working…",
  "set.diag.log": "Diagnostics log",
  "set.diag.openLogs": "Open logs folder",
  "set.diag.toolsDownloading": "Downloading media tools…",
  "set.diag.toolsReady": "Media tools ready.",

  // Settings — About
  "set.sec.about": "About",
  "set.about.intro":
    "Desktop sourcing + organizing tool for video editors. Built with Tauri 2 + React + Rust. Bundles yt-dlp + ffmpeg.",
  "set.about.version": "Version",
  "set.about.identifier": "Identifier",

  // Settings — longer helper descriptions
  "set.src.closedRule": "On Windows, close the browser first — Chromium locks the cookie database while it's running.",
  "set.src.pathHint": "Netscape-format cookies.txt. Tip: avoid paths with non-ASCII characters (e.g. \"Área de Trabalho\") — they can break file access. Try C:\\cookies.txt as a test.",
  "set.src.perSiteHint": "Override the default for specific sites. Typical setup: default None, then add Instagram → From browser — Instagram uses your login while YouTube stays cookie-free (logged-in cookies often break YouTube). The right cookies go to the right site automatically, based on the URL.",
  "set.src.warnTitle": "⚠ Chromium browsers are currently broken",
  "set.src.warnBody1": "As of Chrome 127+ (Aug 2024), yt-dlp can't decrypt cookies from Chrome / Brave / Edge / Vivaldi / Opera because of Google's \"App-Bound Encryption\" change (yt-dlp issue #10927). You'll get a \"Failed to decrypt with DPAPI\" error even with the browser closed.",
  "set.src.warnBody2": "Working alternatives: switch to Firefox above, or use the cookies.txt file mode instead.",
  "set.src.checking": "Checking file…",
  "set.src.fileOk": "✓ {n} youtube.com cookies, login token found. Should work for age-restricted videos.",
  "set.src.fileWarnTitle": "⚠ This cookies file is missing your YouTube login",
  "set.src.lib.moveHint": "Physically moves Library/, Projects/ and _thumbnails/ and rewrites every file path. Refused while any download is running.",
  "set.lib.templateHint": "Tokens: {title} · {channel} · {date} · {id}. Empty = default. The extension is added automatically.",
  "set.dl.workersHint": "Applies to the batch queue. Single-URL downloads ignore this.",
  "set.dl.qualityHint": "Cap for the batch queue + extension sends. Picks the highest option at or below the cap; falls back to the original if the video doesn't go that high. The Download page's format picker overrides this.",
  "set.dl.bandwidthHint": "KiB/s per worker. Off = unlimited. e.g. 5000 ≈ 5 MB/s per parallel download.",
  "set.dl.fastOn": "On — best for very large / long videos, or when a download is crawling (YouTube throttling one connection). For normal downloads the built-in engine is usually just as fast, so you can leave this off.",
  "set.dl.fastOff": "Only helps when YouTube throttles a single connection — big / long videos, or a download stuck well below your real speed. Otherwise the built-in engine is as fast or faster, so keep this off unless a download is crawling. Downloaded once on enable (~3 MB, Windows).",
  "set.dl.previewHint": "The player downloads a small local copy for smooth seeking, plus tiny frame-exact windows where you pause. Auto picks the best quality that stays small — 720p when under ~1.5 GB, otherwise 360p (tiny even for multi-hour videos). The cache is capped at 2 GB; \"Clear cache\" wipes it now.",
  "set.dl.jogHint": "Mouse-drag sensitivity on the player's fine-jog disc. Higher = less dragging per second of timeline. Frame-step keys (←/→) ignore this. Default 1.00×.",
  "set.diag.engineHint": "The download engine (yt-dlp) updates itself quietly at launch so sites that change often keep working. Use this if something breaks mid-session and you want the newest version right away.",
  "set.diag.appHint": "Updates the whole app to the latest signed release. The installer checks the signature, runs quietly, then reopens Media Hub.",
  "set.diag.logHint": "If a download or conversion fails, open this folder and send media-hub.log — it records the exact command, the full output, and what the input file actually was. That's everything needed to diagnose it.",
  "set.diag.dtLibrary": "Library",
  "set.diag.dtThumbnails": "Thumbnails",
  "set.diag.dtSettings": "Settings",
};
