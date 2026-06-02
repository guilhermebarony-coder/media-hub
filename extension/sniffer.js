// Media Hub — stream sniffer (1.2.4).
//
// Passively watches every network request the browser makes (via
// chrome.webRequest.onBeforeRequest, observation-only — MV3 still
// allows read access without blocking). When a URL looks like a
// streaming manifest or direct media file, we add it to a per-tab
// list and bump the toolbar badge.
//
// Why we don't watch onHeadersReceived as well:
//   - URL-pattern matching catches >95% of cases (Twitter, IG,
//     embedded JW/Video.js/Vimeo, etc.) without an extra round-trip.
//   - Content-type sniffing would catch the last 5% (sites that
//     serve `.bin` or extensionless URLs with a video MIME) but
//     doubles the listener cost and adds latency.
//   - We can add it later as an opt-in if any tester reports a
//     site we miss.
//
// Privacy posture:
//   - URLs are kept in memory ONLY. Per-tab Map, cleared when the
//     tab navigates or closes. Nothing persisted to disk, nothing
//     sent anywhere unless the user explicitly clicks "Send".
//   - We never read response bodies (webRequest doesn't expose them
//     in MV3 without an opt-in flag we're not requesting).

/** Map<tabId, Map<url, StreamRecord>>.
 *  Keyed by full URL inside the inner map so dedupe is automatic —
 *  HLS manifests get requested once on load, fragments are filtered
 *  out by ext check, so we don't drown in `.ts` chunks. */
const tabStreams = new Map();

/** Patterns we treat as "this is a downloadable stream/file."
 *  Order matters — first match wins for the `type` label. */
const PATTERNS = [
  { type: "hls", ext: ".m3u8" },
  { type: "dash", ext: ".mpd" },
  { type: "video", ext: ".mp4" },
  { type: "video", ext: ".webm" },
  { type: "video", ext: ".mov" },
  { type: "video", ext: ".mkv" },
  { type: "audio", ext: ".mp3" },
  { type: "audio", ext: ".m4a" },
  { type: "audio", ext: ".flac" },
  { type: "audio", ext: ".ogg" },
  { type: "audio", ext: ".wav" },
];

/** Stuff that LOOKS like media but is a fragment / segment of an HLS
 *  or DASH stream — yt-dlp wants the playlist URL, not the fragments,
 *  so we drop these. `.m4s` is DASH segment, `.ts` is HLS segment,
 *  init segments + numeric-only filenames are also segments. */
const FRAGMENT_HINTS = [".ts", ".m4s", "/init", "/seg-", "/segment"];

/** 1.2.5 — Hosts that yt-dlp handles perfectly from the page URL
 *  (no sniffing benefit) AND that fire enough range-requests per
 *  video to noticeably slow playback if our listener runs for each.
 *
 *  Reported symptom: YouTube player stuck at 00:00 flickering until
 *  page refresh. Root cause: even a "do nothing" observer in
 *  webRequest adds per-request latency, and YouTube's player times
 *  out aggressively on slow chunk arrivals. Skipping these hosts
 *  at the very top of classify() is a single substring check, the
 *  cheapest possible fast-path.
 *
 *  Trade-off: we lose the ability to sniff streams on these hosts.
 *  Not a real loss — the popup "Send to Media Hub" button on the
 *  YouTube page already does the right thing via yt-dlp. */
const SKIP_HOSTS = [
  "googlevideo.com",        // YouTube media CDN
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "doubleclick.net",        // YouTube ads
  "vimeocdn.com",           // Vimeo handled by yt-dlp
  "ttvnw.net",              // Twitch CDN
  "twitch.tv",
  // 1.2.12 — reddit CDN. The signed-URL packaged-media.redd.it
  // links crash yt-dlp's PyInstaller bundle ("PYI-...:ERROR
  // Failed to execute script '__main__'"). content-reddit.js
  // injects an overlay button that sends the post URL instead,
  // which yt-dlp's reddit extractor handles cleanly.
  "redd.it",
  "redditmedia.com",
];

function classify(url) {
  // 1.2.5 — fast-fail path. URL parsing (new URL()) allocates and
  // is the most expensive step in this hot path. Do the cheapest
  // possible filtering first.
  //
  // Step 1: skip-hosts via substring (no parse).
  for (let i = 0; i < SKIP_HOSTS.length; i++) {
    if (url.includes(SKIP_HOSTS[i])) return null;
  }

  // Step 2: extract path WITHOUT URL parsing. Split on '?' (query)
  // and '#' (fragment), lowercase the rest. URLs without a query
  // string skip the slice entirely.
  let path = url;
  const qIdx = url.indexOf("?");
  if (qIdx >= 0) path = url.slice(0, qIdx);
  const hIdx = path.indexOf("#");
  if (hIdx >= 0) path = path.slice(0, hIdx);
  const lower = path.toLowerCase();

  // Step 3: fragment fast-fail. Most of these are .ts/.m4s which
  // is the dominant traffic shape for HLS streams (one .m3u8 +
  // hundreds of .ts chunks per minute).
  if (lower.endsWith(".ts") || lower.endsWith(".m4s")) return null;
  for (let i = 0; i < FRAGMENT_HINTS.length; i++) {
    if (lower.includes(FRAGMENT_HINTS[i])) return null;
  }

  // Step 4: actual extension match.
  for (let i = 0; i < PATTERNS.length; i++) {
    if (lower.endsWith(PATTERNS[i].ext)) {
      return { type: PATTERNS[i].type, ext: PATTERNS[i].ext };
    }
  }
  return null;
}

function basename(urlStr) {
  try {
    const u = new URL(urlStr);
    const path = u.pathname;
    const idx = path.lastIndexOf("/");
    return decodeURIComponent(idx >= 0 ? path.slice(idx + 1) : path) || u.hostname;
  } catch {
    return urlStr.slice(0, 80);
  }
}

// 1.3.x — Quality / stream-root extraction. Sites often serve the
// same video at multiple sizes (Pinterest: foo_240w.mp4, foo_480w.mp4,
// foo_720w.mp4 — three rows for one clip pre-rework). We compute:
//   - root: the URL with the quality marker stripped, used as the
//     group key so the popup can render one row per actual video.
//   - quality: human-readable label ("720w", "1080p", "HD") so the
//     popup can offer a quality picker on grouped rows.
//
// Patterns we recognize (most common first):
//   - "_<n>w" before extension      (Pinterest, some Twitter)
//   - "_<n>p" before extension      (generic resolution-tagged)
//   - "_<n>x<m>" before extension   (occasional CDN)
//   - "/<n>p/" path segment         (some Vimeo-style CDNs)
const QUALITY_RES = [
  // captures: 1=full marker incl. underscore, 2=marker text without underscore
  { re: /_((?:\d{2,4})(?:w|p))(\.[a-z0-9]+)?$/i, label: (m) => m[1] },
  { re: /_((?:\d{2,4})x(?:\d{2,4}))(\.[a-z0-9]+)?$/i, label: (m) => m[1] },
  { re: /\/((?:\d{2,4}p))\//i, label: (m) => m[1] },
];

function rootAndQuality(urlStr) {
  for (const { re, label } of QUALITY_RES) {
    const m = urlStr.match(re);
    if (m) {
      // Strip the captured marker for the group key; keep the file
      // extension when present so different formats of the same
      // content (.mp4 vs .webm) don't get collapsed.
      let root;
      if (re.source.includes("\\/")) {
        // path-segment pattern — replace "/720p/" with "/"
        root = urlStr.replace(re, "/");
      } else {
        // "_NNNw" before extension — strip the marker only
        root = urlStr.replace(re, m[2] || "");
      }
      return { root, quality: label(m) };
    }
  }
  // No quality marker found — the URL is its own root, quality unknown.
  return { root: urlStr, quality: null };
}

/** Approximate quality rank for sorting "best first" inside a group.
 *  Higher number = higher resolution. Falls back to 0 for unknown. */
function qualityRank(label) {
  if (!label) return 0;
  const m = String(label).match(/^(\d{2,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return "";
  }
}

// 1.2.5 — Per-tab badge update debounce. A burst of detections (e.g.
// Twitter loading a feed) used to fire setBadgeText dozens of times
// per second. Coalesce into one update per ~200ms per tab.
const badgeTimers = new Map();
function updateBadge(tabId) {
  if (badgeTimers.has(tabId)) return;
  const t = setTimeout(() => {
    badgeTimers.delete(tabId);
    const set = tabStreams.get(tabId);
    const count = set ? set.size : 0;
    const text = count > 0 ? String(count > 99 ? "99+" : count) : "";
    try {
      chrome.action.setBadgeText({ tabId, text });
      if (count > 0) {
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#c5ff3d" });
        chrome.action.setBadgeTextColor?.({ tabId, color: "#0a0a0c" });
      }
    } catch {
      /* badge APIs unavailable in some firefox forks — ignore */
    }
  }, 200);
  badgeTimers.set(tabId, t);
}

function recordStream(tabId, url, frameUrl) {
  if (tabId < 0) return; // service-worker fetches, etc.
  const hit = classify(url);
  if (!hit) return;
  let set = tabStreams.get(tabId);
  if (!set) {
    set = new Map();
    tabStreams.set(tabId, set);
  }
  if (set.has(url)) return; // dedupe
  const { root, quality } = rootAndQuality(url);
  set.set(url, {
    url,
    type: hit.type,
    ext: hit.ext,
    name: basename(url),
    host: hostnameOf(url),
    // 1.3.x — group key + quality label so the popup can collapse
    // multiple resolutions of the same video into one row.
    root,
    quality,
    qualityRank: qualityRank(quality),
    frameUrl: frameUrl || "",
    detectedAt: Date.now(),
  });
  updateBadge(tabId);
}

function clearTab(tabId) {
  if (!tabStreams.has(tabId)) return;
  tabStreams.delete(tabId);
  updateBadge(tabId);
}

/** Public — called by the popup via chrome.runtime.sendMessage. */
export function getStreamsForTab(tabId) {
  const set = tabStreams.get(tabId);
  if (!set) return [];
  // Newest-first so the most recently observed stream is at the top
  // (matches "I just clicked play, send THAT").
  return Array.from(set.values()).sort((a, b) => b.detectedAt - a.detectedAt);
}

/** Public — set up the listeners. Called once from background.js. */
export function installSniffer() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      recordStream(details.tabId, details.url, details.documentUrl || "");
    },
    {
      urls: ["<all_urls>"],
      // Watch the request types most likely to carry media. `media`
      // covers <video>/<audio> src; `xmlhttprequest` + `other` catch
      // HLS/DASH manifests fetched by JS players (Twitter, IG, etc.).
      types: ["media", "xmlhttprequest", "other"],
    },
  );

  // Tab nav resets the per-tab list — a Twitter feed → single-tweet
  // navigation should re-detect, not accumulate from the previous
  // page. We watch onCommitted (after the user actually navigates)
  // so reloads on the same URL DO clear (which feels right).
  chrome.webNavigation?.onCommitted?.addListener?.((details) => {
    if (details.frameId === 0) clearTab(details.tabId);
  });

  // Fallback for browsers without webNavigation perm (we didn't ask
  // for it because tabs.onUpdated covers the same case for us).
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading" && info.url) clearTab(tabId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabStreams.delete(tabId);
  });
}

/** Public — clear a single stream from a tab's set (called after
 *  the user sends it, optional cleanup). */
export function removeStream(tabId, url) {
  const set = tabStreams.get(tabId);
  if (set && set.delete(url)) updateBadge(tabId);
}
