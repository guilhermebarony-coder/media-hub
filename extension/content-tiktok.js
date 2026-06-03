// Media Hub — TikTok content script (1.3.x).
//
// Same portal pattern as the others — URL discovery only, the
// button + tracking lives in content-portal.js.
//
// TikTok URL shapes we handle:
//   - /@username/video/<numeric_id>     — canonical "watch" page
//   - /@username/video/<id>?…           — same with tracking params
//   - vm.tiktok.com/<short>             — share-link redirect (rare in
//                                         feed since TikTok rewrites
//                                         these to the canonical URL
//                                         after navigation)
//   - "For You" feed (root URL):        — the in-view video's URL
//                                         lives on the closest article-
//                                         shaped wrapper as a permalink
//
// We pass the page-URL to yt-dlp, NOT the in-page <video>.src. TikTok
// CDN URLs are very short-lived signed URLs that expire fast and 403
// without the right cookies, so the desktop's direct-download path
// can't reliably grab them. yt-dlp's TikTok extractor handles the
// /@user/video/<id>/ shape cleanly + preserves title + uploader +
// like-count metadata.

const MARKER_ATTR = "data-mh-tiktok";
const WATCH_RE = /^\/@([A-Za-z0-9._]+)\/video\/(\d+)/i;
const SHORT_RE = /^\/(?:t|v)\/([A-Za-z0-9]+)/i;

function findVideoUrl(video) {
  // Preferred path: walk up to the post container and grab the
  // permalink. TikTok labels each post in the feed with a stable
  // data attribute on a wrapping div / article.
  const post =
    video.closest("[data-e2e='recommend-list-item-container']") ||
    video.closest("[data-e2e='feed-active-video']") ||
    video.closest("article");
  if (post) {
    const anchors = post.querySelectorAll("a[href]");
    for (const a of anchors) {
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (WATCH_RE.test(path) || SHORT_RE.test(path)) {
        return `https://www.tiktok.com${path}`;
      }
    }
  }
  // Closeup view (the user clicked into a single video page) or
  // single-video direct paste. The URL itself is the watch URL.
  if (WATCH_RE.test(location.pathname) || SHORT_RE.test(location.pathname)) {
    return `https://www.tiktok.com${location.pathname}`;
  }
  return null;
}

function processVideo(video) {
  if (!window.mhPortal) return;
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const url = findVideoUrl(video);
  if (!url) return;
  video.setAttribute(MARKER_ATTR, "1");

  // Hover container: outermost data-e2e wrapper if present, else
  // closest <article>, else the video's parent. Same fallback
  // ladder as findVideoUrl uses.
  const hoverContainer =
    video.closest("[data-e2e='recommend-list-item-container']") ||
    video.closest("[data-e2e='feed-active-video']") ||
    video.closest("article") ||
    video.parentElement;

  window.mhPortal.attachPortalButton({
    video,
    targetUrl: url,
    source: "content-tiktok",
    hoverContainer,
  });

  console.log(`[mh] tiktok: portaled button (url: ${url})`);
}

function init() {
  const initial = document.querySelectorAll("video");
  console.log(
    `[mh] tiktok: init on ${location.href} — found ${initial.length} videos at load time`,
  );
  for (const v of initial) processVideo(v);

  // TikTok's "For You" feed virtualizes hard — videos appear and
  // disappear as the user scrolls. Same MutationObserver pattern
  // as the other sites covers it.
  let observed = 0;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.tagName === "VIDEO") {
          observed++;
          processVideo(node);
        } else {
          const vids = node.querySelectorAll?.("video");
          if (vids?.length) {
            observed += vids.length;
            vids.forEach(processVideo);
          }
        }
      }
    }
    if (observed > 0 && observed % 3 === 0) {
      console.log(`[mh] tiktok: observer has caught ${observed} new videos since init`);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  console.log("[mh] tiktok: MutationObserver attached, watching for new videos");
}

console.log("[mh] tiktok: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
