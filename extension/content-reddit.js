// Media Hub — Reddit content script (1.3.x).
//
// URL discovery only — portal/button/tracking lives in
// content-portal.js. We map each video element to its parent
// post's URL so yt-dlp's Reddit extractor preserves title +
// subreddit + uploader metadata.
//
// Reddit layout coverage:
//   - new reddit (sh.reddit.com / reddit.com 2024+): <shreddit-post
//     permalink="..."> — cleanest, the post URL is right there
//   - old reddit (old.reddit.com): doesn't use web components; we
//     fall back to nearest <a> matching a /r/<sub>/comments/<id>/
//     pattern
//
// The target element can be <video>, <shreddit-player>, or
// <faceplate-img-or-video>. New reddit's <shreddit-player> hides the
// actual <video> inside a closed shadow DOM we can't penetrate, so we
// anchor on the player element itself.

const MARKER_ATTR = "data-mh-reddit";
const POST_RE = /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/?#]*)?/i;
const MEDIA_SELECTOR = "video, shreddit-player, faceplate-img-or-video";

function findPostUrl(target) {
  // Preferred: <shreddit-post permalink="...">
  const shred = target.closest("shreddit-post");
  if (shred) {
    const permalink = shred.getAttribute("permalink");
    if (permalink) {
      try {
        return new URL(permalink, "https://www.reddit.com").href;
      } catch {
        /* fall through */
      }
    }
  }
  // Fallback: walk anchors inside the containing post-ish element.
  const wrap =
    target.closest("article, shreddit-post, [data-testid='post-container']") ||
    target.parentElement;
  if (wrap) {
    const anchors = wrap.querySelectorAll("a[href]");
    for (const a of anchors) {
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (POST_RE.test(path)) {
        // Canonicalize host so yt-dlp doesn't get confused by
        // sh.reddit.com / old.reddit.com variants.
        return `https://www.reddit.com${path}`;
      }
    }
  }
  if (POST_RE.test(location.pathname)) {
    return `https://www.reddit.com${location.pathname}`;
  }
  return null;
}

function processVideo(target) {
  if (!window.mhPortal) return;
  if (target.getAttribute(MARKER_ATTR) === "1") return;
  const postUrl = findPostUrl(target);
  if (!postUrl) return;
  target.setAttribute(MARKER_ATTR, "1");

  const hoverContainer =
    target.closest("shreddit-post") ||
    target.closest("article") ||
    target.closest("[data-testid='post-container']") ||
    target.parentElement;

  window.mhPortal.attachPortalButton({
    video: target, // can be <shreddit-player> etc., the portal just needs getBoundingClientRect
    targetUrl: postUrl,
    source: "content-reddit",
    hoverContainer,
  });

  console.log(`[mh] reddit: portaled button (target: ${target.tagName}, post: ${postUrl})`);
}

function init() {
  const initial = document.querySelectorAll(MEDIA_SELECTOR);
  console.log(
    `[mh] reddit: init on ${location.href} — found ${initial.length} media elements at load time`,
  );
  for (const v of initial) processVideo(v);

  let observed = 0;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const tag = node.tagName.toLowerCase();
        if (tag === "video" || tag === "shreddit-player" || tag === "faceplate-img-or-video") {
          observed++;
          processVideo(node);
        } else {
          const vids = node.querySelectorAll?.(MEDIA_SELECTOR);
          if (vids?.length) {
            observed += vids.length;
            vids.forEach(processVideo);
          }
        }
      }
    }
    if (observed > 0 && observed % 3 === 0) {
      console.log(`[mh] reddit: observer has caught ${observed} new media elements since init`);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  console.log("[mh] reddit: MutationObserver attached, watching for new media");
}

console.log("[mh] reddit: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
