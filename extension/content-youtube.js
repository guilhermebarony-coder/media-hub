// Media Hub — YouTube content script (1.3.x).
//
// Safety net: YouTube is the primary source for editors and the
// popup + sniffer already handle it cleanly, but having the in-page
// button means the user never has to remember a shortcut or open
// the popup — same one-click flow as Twitter / Reddit / Pinterest /
// Instagram.
//
// URL discovery is the simplest of all sites:
//   - /watch?v=<id>             → standard video
//   - /shorts/<id>              → shorts
//   - /embed/<id>               → embedded player (rare on youtube.com itself)
// We canonicalize to `https://www.youtube.com/watch?v=<id>` for
// consistency in the library (yt-dlp accepts every shape, but using
// one canonical form means library dedupe works correctly).

const MARKER_ATTR = "data-mh-youtube";

function findVideoUrl() {
  const path = location.pathname;
  const params = new URLSearchParams(location.search);

  // /watch?v=<id> — the canonical viewer page.
  if (path === "/watch") {
    const id = params.get("v");
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  // /shorts/<id>
  let m = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  // /embed/<id>
  m = path.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  return null;
}

function processVideo(video) {
  if (!window.mhPortal) return;
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const url = findVideoUrl();
  if (!url) return;
  video.setAttribute(MARKER_ATTR, "1");

  // Hover container: the player wrapper (#movie_player) on the
  // standard watch page is the most reliable target. For shorts,
  // YouTube uses a ytd-reel-video-renderer wrapper; closest <video>
  // ancestor covers both. Fallback to the player itself.
  const hoverContainer =
    video.closest("#movie_player") ||
    video.closest("ytd-reel-video-renderer") ||
    video.closest("ytd-player") ||
    video.parentElement;

  // Stash the cleanup so SPA navigation can detach the old button
  // (which still points at the previous video's URL) before we
  // re-process and attach a new one.
  video.__mhCleanup = window.mhPortal.attachPortalButton({
    video,
    targetUrl: url,
    source: "content-youtube",
    hoverContainer,
  });

  console.log(`[mh] youtube: portaled button (url: ${url})`);
}

function init() {
  for (const v of document.querySelectorAll("video")) processVideo(v);

  // YouTube is an SPA — new <video> elements appear when the user
  // navigates between videos without a full page reload, and when
  // shorts scroll through the reel feed.
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.tagName === "VIDEO") {
          processVideo(node);
        } else {
          const vids = node.querySelectorAll?.("video");
          if (vids?.length) vids.forEach(processVideo);
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // YouTube's SPA navigates by firing `yt-navigate-finish`. We need
  // to refresh the URL on the already-attached buttons (the <video>
  // element stays the same DOM node across nav, but the URL changes).
  // Easiest: clear our marker on yt-navigate-finish and re-process
  // every video.
  window.addEventListener("yt-navigate-finish", () => {
    for (const v of document.querySelectorAll(`video[${MARKER_ATTR}='1']`)) {
      v.__mhCleanup?.();
      v.__mhCleanup = null;
      v.removeAttribute(MARKER_ATTR);
    }
    for (const v of document.querySelectorAll("video")) processVideo(v);
  });
}

console.log("[mh] youtube: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
