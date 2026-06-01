// Media Hub — Instagram content script (1.3.x).
//
// Re-introduced in 1.3.x after 1.2.14 pulled the earlier attempt.
// The original lost the pointer-capture race no matter what — Instagram
// hooks pointerdown on a sibling layer covering the entire player
// bbox. The body-portal pattern (see content-portal.js) sidesteps the
// issue by rendering the button OUTSIDE the player's DOM tree, with
// the click target physically above the player's top edge.
//
// URL shapes we care about:
//   - Reels        : /reel/<id>/[?…]
//   - Feed videos  : /p/<id>/[?…]
//   - tv (legacy)  : /tv/<id>/
//   - stories: not supported (auth-gated, ephemeral, yt-dlp's path is fragile)

const MARKER_ATTR = "data-mh-instagram";
const POST_RE = /^\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i;

/**
 * Walk up from a <video> to its parent post/reel container and find
 * the canonical URL. Falls back to the page URL when on a single-post
 * page (reel/p/tv).
 */
function findPostUrl(video) {
  // Preferred: closest <article> (feed/explore) — Instagram wraps
  // each post in an article with a permalink anchor inside.
  const article = video.closest("article");
  if (article) {
    const anchors = article.querySelectorAll("a[href]");
    for (const a of anchors) {
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (POST_RE.test(path)) {
        return `https://www.instagram.com${path}`;
      }
    }
  }
  // Reels viewer doesn't always use <article>. The page URL itself
  // is the reel URL in that view.
  if (POST_RE.test(location.pathname)) {
    return `https://www.instagram.com${location.pathname.replace(/\/+$/, "/")}`;
  }
  return null;
}

function processVideo(video) {
  if (!window.mhPortal) return;
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const postUrl = findPostUrl(video);
  if (!postUrl) return;
  video.setAttribute(MARKER_ATTR, "1");

  // Hover-reveal binds on the article wrapper (feed/explore) or the
  // video itself (reels viewer where no article exists).
  const hoverContainer = video.closest("article") || video.parentElement;

  window.mhPortal.attachPortalButton({
    video,
    targetUrl: postUrl,
    source: "content-instagram",
    hoverContainer,
  });

  console.log(`[mh] instagram: portaled button (url: ${postUrl})`);
}

function init() {
  const initial = document.querySelectorAll("video");
  console.log(
    `[mh] instagram: init on ${location.href} — found ${initial.length} videos at load time`,
  );
  for (const v of initial) processVideo(v);

  // Instagram's feed virtualizes aggressively — observer is essential.
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
      console.log(`[mh] instagram: observer has caught ${observed} new videos since init`);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  console.log("[mh] instagram: MutationObserver attached, watching for new videos");
}

console.log("[mh] instagram: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
