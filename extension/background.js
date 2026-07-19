// Media Hub — background service worker (MV3).
//
// Two jobs:
//   1. Right-click context menu on pages / links / videos / audio —
//      sends the relevant URL to the bridge in the chosen format.
//   2. Surfaces success/failure as a transient OS notification (the
//      user isn't looking at our popup when they right-click).
//
// Service workers can't hold state across invocations — Chrome
// suspends + resumes them. All config reads pull from storage on
// every event so we never act on stale data.

import { loadConfig, enqueue, buildDeepLink } from "./bridge.js";
import { installSniffer, getStreamsForTab, removeStream } from "./sniffer.js";

// 1.2.4 — passive stream sniffer. Watches network traffic per tab
// and surfaces detected media URLs in the popup. See sniffer.js for
// details. Cheap to install — just adds one webRequest listener.
installSniffer();

// Popup ⇄ service-worker bridge. The popup can't import sniffer.js
// directly (it'd run its own copy in the popup context), so we
// proxy via messages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.kind === "get-streams") {
    sendResponse({ streams: getStreamsForTab(msg.tabId) });
    return false; // sync response
  }
  if (msg.kind === "remove-stream") {
    removeStream(msg.tabId, msg.url);
    sendResponse({ ok: true });
    return false;
  }
  // 1.2.6 — content scripts (e.g. content-twitter.js) post here to
  // forward a click into the same sendToHub pipeline the popup +
  // context menu use. Mirrors enqueue()'s return shape so the caller
  // can render success/error in-place.
  if (msg.kind === "send-to-hub") {
    (async () => {
      const cfg = await loadConfig();
      if (!cfg.token) {
        sendResponse({ ok: false, error: "bridge token not configured" });
        return;
      }
      const r = await enqueue({
        url: cfg.url,
        token: cfg.token,
        target: msg.url,
        audioFormat:
          msg.mode === "mp3" || msg.mode === "m4a" || msg.mode === "flac"
            ? msg.mode
            : null,
        source: msg.source || "content-script",
        // 1.13.x — quick-menu overrides (forwarded verbatim when present).
        quality: msg.quality,
        transcode: msg.transcode,
        rename: msg.rename,
      });
      sendResponse(r);
    })();
    return true; // async response
  }

  // 1.13.x — cold-start launch. When the bridge is unreachable (app
  // closed), the content script asks us to fire the mediahub:// deep
  // link: the OS launches Media Hub and the app enqueues the URL on
  // boot. Content scripts can't call chrome.tabs, so it happens here.
  // Same tab-create-then-close dance the popup's launch button uses —
  // the mediahub:// "page" never loads (the OS hijacks it), so the
  // blank tab is cleaned up after a second.
  if (msg.kind === "launch-app") {
    (async () => {
      const cfg = await loadConfig();
      if (!cfg.token) {
        sendResponse({ ok: false, error: "bridge token not configured" });
        return;
      }
      const deepLink = buildDeepLink({
        token: cfg.token,
        target: msg.url,
        audioFormat:
          msg.mode === "mp3" || msg.mode === "m4a" || msg.mode === "flac"
            ? msg.mode
            : null,
      });
      chrome.tabs.create({ url: deepLink, active: false }, (newTab) => {
        if (newTab?.id) {
          setTimeout(() => {
            try {
              chrome.tabs.remove(newTab.id);
            } catch {
              /* tab already gone */
            }
          }, 1000);
        }
      });
      sendResponse({ ok: true, launched: true });
    })();
    return true; // async response
  }
  return false;
});

// ---------------------------------------------------------------
// Context menu registration
// ---------------------------------------------------------------
//
// Re-registers on every install / update because MV3 service workers
// don't persist menu state across browser restarts the way MV2 did.
// `removeAll` then `create` is the canonical pattern.

const MENU_DEFS = [
  // Top-level "Send to Media Hub" — fires for whatever the user
  // right-clicked on, defaulting to the link/media URL if present
  // (Chrome populates `linkUrl` / `srcUrl` automatically) else the
  // page URL.
  { id: "mh-send-video", title: "Send to Media Hub", mode: "video" },
  { id: "mh-sep", type: "separator" },
  { id: "mh-send-mp3", title: "Send as MP3 (audio)", mode: "mp3" },
  { id: "mh-send-m4a", title: "Send as M4A (audio)", mode: "m4a" },
  { id: "mh-send-flac", title: "Send as FLAC (audio)", mode: "flac" },
];

function registerMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const def of MENU_DEFS) {
      chrome.contextMenus.create({
        id: def.id,
        title: def.title,
        type: def.type || "normal",
        contexts: ["page", "link", "video", "audio", "selection"],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(registerMenus);
chrome.runtime.onStartup.addListener(registerMenus);

// ---------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Keyboard shortcuts (1.2.3 polish — YouTube/X/etc. hijack right-click,
// so a hotkey is the reliable path on those sites).
//   Ctrl+Shift+Y → send active tab as video
//   Ctrl+Shift+M → send active tab as MP3
// Users can rebind in chrome://extensions/shortcuts.
// ---------------------------------------------------------------

const CMD_MODE = {
  "send-video": "video",
  "send-mp3": "mp3",
};

chrome.commands.onCommand.addListener(async (command) => {
  const mode = CMD_MODE[command];
  if (!mode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    notify("Nothing to send", "Active tab doesn't have a usable URL.");
    return;
  }
  await sendToHub(tab.url, mode, "extension-hotkey");
});

// ---------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const def = MENU_DEFS.find((d) => d.id === info.menuItemId);
  if (!def || !def.mode) return;

  // Pick the most specific URL Chrome could see. Order matters:
  // a direct video/audio src is what the user clicked on, before
  // any wrapping link, before the page URL.
  const target =
    info.srcUrl ||
    info.linkUrl ||
    info.pageUrl ||
    tab?.url;
  if (!target) {
    notify("Nothing to send", "Couldn't find a URL on the clicked element.");
    return;
  }
  await sendToHub(target, def.mode, "extension-context");
});

// ---------------------------------------------------------------
// Shared send path (used by context menu + hotkeys)
// ---------------------------------------------------------------

async function sendToHub(target, mode, source) {
  const cfg = await loadConfig();
  if (!cfg.token) {
    notify(
      "Setup needed",
      "Open the extension options and paste your Media Hub bridge token.",
    );
    chrome.runtime.openOptionsPage();
    return;
  }

  const r = await enqueue({
    url: cfg.url,
    token: cfg.token,
    target,
    audioFormat: mode === "video" ? null : mode,
    source,
  });

  if (r.ok) {
    notify(
      mode === "video" ? "Sent to Media Hub" : `Sent as ${mode.toUpperCase()}`,
      truncate(target, 80),
    );
  } else if (r.offline) {
    notify(
      "Media Hub offline",
      "Couldn't reach the desktop app. Open the extension popup and click 'Try launching app'.",
    );
  } else {
    notify("Send failed", r.error || "unknown error");
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function notify(title, message) {
  // notifications.create with a basic template — works identically
  // across Chrome / Edge / Firefox. We skip the icon when the
  // extension hasn't shipped one yet (Chrome falls back to a default).
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
    });
  } catch {
    // notifications API isn't available in all firefox forks; swallow.
  }
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
