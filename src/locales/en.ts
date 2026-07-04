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
};
