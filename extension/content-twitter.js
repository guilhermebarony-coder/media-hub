// Media Hub — Twitter/X content script (1.3.x).
//
// URL discovery only — portal/button/tracking lives in
// content-portal.js. We map each <video> to its parent tweet's
// status URL so yt-dlp's Twitter extractor preserves the title +
// uploader metadata.
//
// Why a content script vs. the sniffer:
//   - The sniffer sees raw CDN URLs (video.twimg.com/.../abc.mp4)
//     with no metadata. yt-dlp downloads them as anonymous files.
//   - This script knows the URL the user is LOOKING AT — the
//     parent tweet's permalink — which the extractor handles
//     properly.
//
// As of 1.3.x, the button portals to document.body so Twitter's
// video player overlay can't intercept clicks. Earlier versions
// injected the button inside the tweet DOM and worked, but the
// new pattern is consistent across all sites and click-safer.

const MARKER_ATTR = "data-mh-twitter";
const STATUS_RE = /^\/(?:i\/web\/status|[A-Za-z0-9_]+\/status)\/(\d+)/;

/**
 * Walk up from a <video> to its enclosing <article> (the tweet
 * container), then find the first permalink anchor pointing to a
 * status URL. Returns the full https://x.com/... URL or null.
 */
function findStatusUrl(video) {
  const article = video.closest("article");
  if (!article) {
    // Fallback: if the page IS a single-tweet view, use the
    // location URL — useful when DOM walk fails on some layouts.
    const m = location.pathname.match(STATUS_RE);
    if (m) return `https://x.com${location.pathname}`;
    return null;
  }
  const anchors = article.querySelectorAll("a[href]");
  for (const a of anchors) {
    let path;
    try {
      path = new URL(a.href, location.origin).pathname;
    } catch {
      continue;
    }
    const m = path.match(STATUS_RE);
    if (m) {
      // Canonicalize to x.com (legacy twitter.com is fine too,
      // yt-dlp accepts either).
      return `https://x.com${path}`;
    }
  }
  if (location.pathname.match(STATUS_RE)) {
    return `https://x.com${location.pathname}`;
  }
  return null;
}

function processVideo(video) {
  if (!window.mhPortal) return;
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const statusUrl = findStatusUrl(video);
  if (!statusUrl) return;
  video.setAttribute(MARKER_ATTR, "1");

  // Hover-reveal binds on the article so cursor anywhere over the
  // tweet shows the button. Falls back to parentElement for the
  // edge case where Twitter renders a video outside <article>.
  const hoverContainer = video.closest("article") || video.parentElement;

  window.mhPortal.attachPortalButton({
    video,
    targetUrl: statusUrl,
    source: "content-twitter",
    hoverContainer,
  });

  console.log(`[mh] twitter: portaled button (status: ${statusUrl})`);
}

function init() {
  for (const v of document.querySelectorAll("video")) processVideo(v);

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
}

console.log("[mh] twitter: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
