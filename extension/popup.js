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
// 1.3.x — sniffer filter state. Mirrors the .filter-chip[data-filter]
// values: "all" / "video" / "audio" / "stream" (hls+dash). Persisted
// via chrome.storage.local so the choice survives popup re-opens —
// editors who only care about MP4 don't have to re-click each time.
let streamFilter = "all";
// Cache of the last-rendered streams so filter toggles can re-render
// without round-tripping to the background service worker.
let cachedStreams = [];

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

  // 1.3.x — restore last filter selection + wire chip clicks.
  try {
    const stored = await chrome.storage.local.get("sniffer.filter");
    const f = stored["sniffer.filter"];
    if (typeof f === "string") streamFilter = f;
  } catch {
    /* storage unavailable in some browser forks — fall back to "all" */
  }
  document.querySelectorAll(".filter-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === streamFilter);
    btn.addEventListener("click", () => {
      streamFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach((b) =>
        b.classList.toggle("active", b === btn),
      );
      chrome.storage.local.set({ "sniffer.filter": streamFilter }).catch(() => {});
      renderStreams(cachedStreams);
    });
  });

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
    cachedStreams = streams;
    renderStreams(streams);
  } catch (e) {
    console.warn("[popup] get-streams failed:", e);
  }
}

/**
 * 1.3.x — Group streams by their stream-root key so multi-quality
 * versions of the same video collapse into one row. The sniffer
 * computes `root` and `quality` for each record; we just bucket
 * here and sort variants high-quality-first.
 *
 * Returns an array of groups:
 *   { root, type, host, name, variants[], best, latestDetectedAt }
 * The `best` variant is what the row's primary click sends.
 */
function groupStreams(streams) {
  const groups = new Map();
  for (const s of streams) {
    const key = s.root || s.url;
    let g = groups.get(key);
    if (!g) {
      g = {
        root: key,
        type: s.type,
        host: s.host,
        // Pretty name from the highest-quality variant's filename
        // (filled in below after sorting).
        name: s.name,
        variants: [],
        latestDetectedAt: s.detectedAt,
      };
      groups.set(key, g);
    }
    g.variants.push(s);
    if (s.detectedAt > g.latestDetectedAt) g.latestDetectedAt = s.detectedAt;
  }
  // Sort each group's variants by quality rank desc (highest first)
  // so `best` is the leading element. Tie-break by recency.
  for (const g of groups.values()) {
    g.variants.sort((a, b) => {
      const dq = (b.qualityRank ?? 0) - (a.qualityRank ?? 0);
      if (dq !== 0) return dq;
      return b.detectedAt - a.detectedAt;
    });
    g.best = g.variants[0];
    g.name = g.best.name;
  }
  // Sort groups by their newest member's detectedAt desc — the pin
  // you just clicked into is at the top.
  return Array.from(groups.values()).sort(
    (a, b) => b.latestDetectedAt - a.latestDetectedAt,
  );
}

function applyFilter(streams, filter) {
  if (filter === "all") return streams;
  if (filter === "stream") {
    return streams.filter((s) => s.type === "hls" || s.type === "dash");
  }
  return streams.filter((s) => s.type === filter);
}

function renderStreams(streams) {
  const section = $("streams-section");
  const list = $("streams-list");
  const count = $("streams-count");
  if (!streams.length) {
    section.classList.add("hidden");
    // 1.3.x — pop the popup back to its compact width when there's
    // nothing in the sniffer (or the panel was just cleared).
    document.body.classList.remove("has-streams");
    return;
  }
  section.classList.remove("hidden");
  // Widen the popup to give the row + quality picker + two action
  // buttons room to breathe.
  document.body.classList.add("has-streams");
  // Show the total raw count, not the grouped/filtered count, so the
  // user knows "the sniffer caught N media URLs even if my filter
  // hides some". Matches the toolbar badge.
  count.textContent = String(streams.length);

  const filtered = applyFilter(streams, streamFilter);
  const groups = groupStreams(filtered);
  list.innerHTML = "";

  if (groups.length === 0) {
    const empty = document.createElement("li");
    empty.className = "streams-empty";
    empty.textContent = `Nothing matches the "${streamFilter}" filter.`;
    list.appendChild(empty);
    return;
  }

  for (const g of groups) {
    list.appendChild(renderGroup(g));
  }
}

/** Render a single grouped row. Returns the <li> element. */
function renderGroup(g) {
  const li = document.createElement("li");
  li.className = "stream-row";
  // Selected variant defaults to `best` (highest quality). Switching
  // via the dropdown updates this without re-rendering the whole row.
  let selected = g.best;
  const directlyPlayable = selected.type === "video" || selected.type === "audio";
  const qualityCount = g.variants.length;

  li.innerHTML = `
    <div class="stream-row-main">
      <span class="stream-type ${escapeHtml(g.type)}">${escapeHtml(g.type)}</span>
      <span class="stream-name" title="${escapeHtml(selected.url)}">${escapeHtml(g.name)}</span>
      ${
        qualityCount > 1
          ? `<select class="stream-quality mono" title="Pick a quality">${g.variants
              .map(
                (v, i) =>
                  `<option value="${i}">${escapeHtml(v.quality || `var ${i + 1}`)}</option>`,
              )
              .join("")}</select>`
          : g.best.quality
            ? `<span class="stream-quality-static mono">${escapeHtml(g.best.quality)}</span>`
            : ""
      }
      <span class="stream-host mono">${escapeHtml(g.host)}</span>
      ${
        directlyPlayable
          ? `<button class="stream-preview" type="button" title="Inline preview">▶</button>`
          : ""
      }
      <button class="stream-open" type="button" title="Open URL in a new tab (full-size view)">👁</button>
    </div>
    <div class="stream-row-preview hidden"></div>
  `;

  const previewBtn = li.querySelector(".stream-preview"); // may be null for HLS/DASH
  const openBtn = li.querySelector(".stream-open");
  const previewSlot = li.querySelector(".stream-row-preview");
  const qualitySel = li.querySelector(".stream-quality");
  const nameEl = li.querySelector(".stream-name");

  if (qualitySel) {
    qualitySel.addEventListener("click", (ev) => ev.stopPropagation());
    qualitySel.addEventListener("change", () => {
      selected = g.variants[parseInt(qualitySel.value, 10)] || g.best;
      nameEl.title = selected.url;
      // If the preview is open, swap its source to the new variant.
      const existingVideo = previewSlot.querySelector("video");
      if (existingVideo) {
        existingVideo.src = selected.url;
        existingVideo.load();
      }
    });
  }

  // Row click → send. Skip if click landed inside the quality picker
  // or either action button (each handles its own behavior).
  li.querySelector(".stream-row-main").addEventListener("click", (ev) => {
    if (
      ev.target.closest(".stream-quality, .stream-preview, .stream-open")
    )
      return;
    void handleStreamClick(li, selected);
  });

  // ▶ — inline mini preview (direct video/audio only).
  if (previewBtn) {
    previewBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePreview(previewSlot, selected);
    });
  }

  // 👁 — open the URL in a new browser tab. Works for direct media
  // (plays full-size in the tab's native player), and is the only
  // option for HLS/DASH manifests (the tab will just download the
  // manifest as a tiny text file, which still confirms it resolves).
  openBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    chrome.tabs.create({ url: selected.url, active: true });
  });

  return li;
}

/** Mount or unmount the inline <video>/<audio> preview. */
function togglePreview(slot, stream) {
  if (!slot.classList.contains("hidden")) {
    slot.classList.add("hidden");
    slot.innerHTML = "";
    return;
  }
  slot.classList.remove("hidden");
  // preload="metadata" so the popup doesn't yank a multi-MB file
  // just because the user clicked play-preview; we let the browser
  // decide based on the user's network. controls give scrub + mute.
  const tag = stream.type === "audio" ? "audio" : "video";
  slot.innerHTML = `<${tag} src="${escapeHtml(stream.url)}" controls preload="metadata"></${tag}>`;
  const el = slot.querySelector(tag);

  const ERR_MSG = `<div class="stream-preview-err mono">Preview blocked by source (CDN refused without the right Referer / cookies — Twitter MP4s and some Pinterest pins do this). Click the row to send — Media Hub fetches it properly.</div>`;
  const showErr = () => {
    slot.innerHTML = ERR_MSG;
  };

  // The hard `error` event covers obvious failures (DNS, 404, CORS).
  el.addEventListener("error", showErr);

  // 1.3.x — stall watchdog for the Twitter case: the player loads
  // metadata fine (duration shows up) but the byte-range requests
  // 403 silently, so the controls render with a black void instead
  // of erroring out. After 3 seconds, if the video still hasn't
  // reached HAVE_CURRENT_DATA, surface our friendly message early.
  //
  // readyState reference:
  //   0 = HAVE_NOTHING        — not even metadata
  //   1 = HAVE_METADATA       — duration known, no actual frame data
  //   2 = HAVE_CURRENT_DATA   — current playback position has data
  //   3 = HAVE_FUTURE_DATA    — and a bit ahead
  //   4 = HAVE_ENOUGH_DATA    — plus enough to play through
  //
  // Anything < 2 after 3s means "we got the headers, the bytes
  // refused" — the Twitter signed-URL trap exactly.
  const watchdog = setTimeout(() => {
    // readyState < 2 means we never got past metadata — the byte
    // stream stalled. (A successfully-playing or even paused-after-
    // buffering video has readyState >= 2.)
    if (el.readyState < 2) showErr();
  }, 3000);
  // Cancel the watchdog as soon as the video proves it can actually
  // play, so a slow-but-fine connection doesn't get false-positived.
  const cancelWatchdog = () => clearTimeout(watchdog);
  el.addEventListener("playing", cancelWatchdog);
  el.addEventListener("canplay", cancelWatchdog);
  el.addEventListener("loadeddata", cancelWatchdog);
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
