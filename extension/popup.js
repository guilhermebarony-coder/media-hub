// Media Hub — popup script.
//
// Loads the active tab, lets the user pick a format (Video / MP3 /
// M4A / FLAC), and POSTs to the bridge. Shows a live connection
// status pill in the header (green when the bridge is up).
//
// Failure modes handled:
//   - No token saved → button stays disabled, pointer to Options.
//   - Bridge offline → button still works, but on failure we surface
//     a "Try launching app" button that uses the mediahub:// deep
//     link to cold-launch Media Hub with the URL already queued.
//   - Bridge reachable but returns auth error → red message + Options
//     link.

import {
  loadConfig,
  pingHealth,
  enqueue,
  buildDeepLink,
} from "./bridge.js";

let currentTab = null;
let selectedMode = "video"; // "video" | "mp3" | "m4a" | "flac"
let cfg = null;

const $ = (id) => document.getElementById(id);

async function init() {
  cfg = await loadConfig();

  // Active tab info.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab) {
    $("tab-title").textContent = tab.title || "(no title)";
    $("tab-url").textContent = tab.url || "";
  }

  // Mode tabs wire up.
  document.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMode = btn.dataset.mode;
    });
  });

  $("send-btn").addEventListener("click", handleSend);
  $("options-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("launch-btn").addEventListener("click", handleLaunchFallback);

  await refreshStatus();

  // Enable the button iff token configured + tab has a usable URL.
  const enabled = !!cfg.token && !!currentTab?.url && /^https?:/i.test(currentTab.url);
  $("send-btn").disabled = !enabled;
  if (!cfg.token) {
    showMsg("setup", "Open Options and paste your bridge token to pair.", "");
  } else if (!enabled) {
    showMsg("skip", "This page doesn't have a usable URL.", "");
  }

  // 1.2.4 — load and render any streams the sniffer captured for
  // this tab while it loaded. Asks the background service worker
  // for its in-memory list (we can't share state with the popup
  // directly — they're separate JS contexts).
  await refreshStreams();
}

async function refreshStreams() {
  if (!currentTab?.id) return;
  try {
    const reply = await chrome.runtime.sendMessage({
      kind: "get-streams",
      tabId: currentTab.id,
    });
    const streams = reply?.streams ?? [];
    renderStreams(streams);
  } catch (e) {
    console.warn("[popup] get-streams failed:", e);
  }
}

function renderStreams(streams) {
  const section = $("streams-section");
  const list = $("streams-list");
  const count = $("streams-count");
  if (!streams.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  count.textContent = String(streams.length);
  list.innerHTML = "";
  for (const s of streams) {
    const li = document.createElement("li");
    li.title = `${s.url}\n\nClick row to send · click 👁 to preview`;
    li.innerHTML = `
      <span class="stream-type ${s.type}">${escapeHtml(s.type)}</span>
      <span class="stream-name">${escapeHtml(s.name)}</span>
      <span class="stream-host mono">${escapeHtml(s.host)}</span>
      <button class="stream-preview" type="button" title="Open URL in a new tab to preview">👁</button>
    `;
    li.addEventListener("click", () => handleStreamClick(li, s));
    li.querySelector(".stream-preview").addEventListener("click", (ev) => {
      // Don't fall through to the row's send handler.
      ev.stopPropagation();
      // Direct .mp4 URLs play inline in a new tab. HLS/DASH manifests
      // download as a tiny text file in the browser — not useful as a
      // "preview" per se, but at least confirms the URL is alive and
      // shows you what server you're hitting.
      chrome.tabs.create({ url: s.url, active: true });
    });
    list.appendChild(li);
  }
}

async function handleStreamClick(li, stream) {
  if (!cfg?.token) {
    showMsg("setup", "Open Options and paste your bridge token to pair.", "");
    return;
  }
  li.classList.add("sending");
  // For audio-typed streams, default to MP3 conversion. For everything
  // else (hls/dash/video), respect the user's mode tab choice — if
  // they picked MP3 in the tabs we extract audio from the stream too.
  const audioFormat =
    selectedMode === "video"
      ? stream.type === "audio"
        ? "mp3"
        : null
      : selectedMode;
  const r = await enqueue({
    url: cfg.url,
    token: cfg.token,
    target: stream.url,
    audioFormat,
    source: "extension-sniffer",
  });
  if (r.ok) {
    showMsg("queued", `Sent · ${stream.type.toUpperCase()} stream`, "ok");
    // Remove it from the list so re-opens of the popup don't show
    // a stream we already grabbed (it's still queued in Media Hub).
    try {
      await chrome.runtime.sendMessage({
        kind: "remove-stream",
        tabId: currentTab.id,
        url: stream.url,
      });
    } catch {
      /* badge update is best-effort */
    }
    li.remove();
    setTimeout(() => window.close(), 600);
  } else {
    li.classList.remove("sending");
    showMsg("error", r.error || "send failed", "err");
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function refreshStatus() {
  const status = $("status");
  const text = $("status-text");
  status.classList.remove("ok", "err");
  text.textContent = "checking…";
  const r = await pingHealth(cfg.url);
  if (r.ok) {
    status.classList.add("ok");
    status.title = `connected · v${r.version}`;
    text.textContent = `v${r.version}`;
  } else {
    status.classList.add("err");
    status.title = r.error;
    text.textContent = "offline";
  }
}

async function handleSend() {
  if (!currentTab?.url) return;
  const btn = $("send-btn");
  btn.disabled = true;
  btn.classList.add("sending");
  btn.querySelector(".send-label").textContent = "Sending…";

  const result = await enqueue({
    url: cfg.url,
    token: cfg.token,
    target: currentTab.url,
    audioFormat: selectedMode === "video" ? null : selectedMode,
    source: "extension-popup",
  });

  btn.classList.remove("sending");
  btn.querySelector(".send-label").textContent = "Send to Media Hub";

  if (result.ok) {
    showMsg("queued", `Sent · ${labelForMode(selectedMode)}`, "ok");
    $("launch-btn").hidden = true;
    // Auto-close after a brief beat so the popup gets out of the way.
    setTimeout(() => window.close(), 700);
  } else if (result.offline) {
    showMsg("offline", "Media Hub isn't running. Try the launch link below.", "err");
    $("launch-btn").hidden = false;
    btn.disabled = false;
  } else {
    showMsg("error", result.error || "unknown error", "err");
    btn.disabled = false;
  }
}

function handleLaunchFallback() {
  if (!currentTab?.url || !cfg.token) return;
  const deepLink = buildDeepLink({
    token: cfg.token,
    target: currentTab.url,
    audioFormat: selectedMode === "video" ? null : selectedMode,
  });
  // Browsers can't open custom-scheme URLs from extension contexts
  // directly via window.location, but they CAN open a new tab with
  // the scheme — the OS catches it and the tab closes itself.
  chrome.tabs.create({ url: deepLink, active: false }, (newTab) => {
    if (newTab?.id) {
      // The mediahub:// page never actually loads (OS hijacks it),
      // but the empty tab can linger. Close after 1s as cleanup.
      setTimeout(() => chrome.tabs.remove(newTab.id).catch(() => {}), 1000);
    }
    window.close();
  });
}

function showMsg(label, body, kind) {
  const row = $("msg-row");
  row.classList.remove("hidden", "ok", "err");
  if (kind) row.classList.add(kind);
  $("msg-label").textContent = label;
  $("msg-body").textContent = body;
}

function labelForMode(m) {
  if (m === "video") return "video";
  return m.toUpperCase() + " audio";
}

init().catch((e) => {
  console.error("popup init failed:", e);
  showMsg("error", String(e?.message || e), "err");
});
