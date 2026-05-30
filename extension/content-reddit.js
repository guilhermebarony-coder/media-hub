// Media Hub — Reddit content script (1.2.12).
//
// Same pattern as content-twitter.js — inject a hover-reveal
// "Media Hub" button on every <video> on reddit.com, click sends
// the parent POST's URL (not the raw CDN URL). yt-dlp's reddit
// extractor handles post URLs perfectly with title + subreddit +
// uploader metadata; it CRASHES on certain raw packaged-media.redd.it
// signed URLs (PYI / unhandled exception), so giving it the post
// URL is both prettier AND more reliable.
//
// Reddit layout coverage:
//   - new reddit (sh.reddit.com / reddit.com 2024+): <shreddit-post
//     permalink="...">  ← cleanest, has the post URL right there
//   - old reddit (old.reddit.com): doesn't render with web
//     components; we fall back to nearest `<a>` matching a comments
//     URL pattern.
//
// All shared overlay button styling lives in content-overlay.css —
// twitter + reddit + future sites use the same look.

const MARKER_CLASS = "mh-injected";
const POST_RE = /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/?#]*)?/i;

/** Walk up from a <video> to find the parent post and return its
 *  canonical URL. Returns null when we can't identify a post —
 *  in which case we skip injecting (no point sending unknown
 *  context). */
function findPostUrl(video) {
  // Preferred path: new reddit web components.
  const shred = video.closest("shreddit-post");
  if (shred) {
    const permalink = shred.getAttribute("permalink");
    if (permalink) {
      // permalink looks like "/r/Sub/comments/abc/title_slug/"
      try {
        return new URL(permalink, "https://www.reddit.com").href;
      } catch {
        /* fall through */
      }
    }
  }

  // Fallback: walk anchors in the containing article-ish element.
  const wrap = video.closest("article, shreddit-post, [data-testid='post-container']") || video.parentElement;
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

  // Last resort: if the page itself is a single-post URL, use it.
  if (POST_RE.test(location.pathname)) {
    return `https://www.reddit.com${location.pathname}`;
  }
  return null;
}

function makeButton(postUrl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mh-overlay-btn";
  btn.title = "Send to Media Hub";
  btn.innerHTML = `
    <span class="mh-overlay-dot"></span>
    <span class="mh-overlay-label">Media Hub</span>
  `;

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    btn.classList.add("mh-sending");
    btn.querySelector(".mh-overlay-label").textContent = "Sending…";
    try {
      const reply = await chrome.runtime.sendMessage({
        kind: "send-to-hub",
        url: postUrl,
        mode: "video",
        source: "content-reddit",
      });
      if (reply?.ok) {
        btn.classList.remove("mh-sending");
        btn.classList.add("mh-sent");
        btn.querySelector(".mh-overlay-label").textContent = "Queued ✓";
        setTimeout(() => {
          btn.classList.remove("mh-sent");
          btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
        }, 2000);
      } else {
        btn.classList.remove("mh-sending");
        btn.classList.add("mh-err");
        btn.querySelector(".mh-overlay-label").textContent =
          reply?.error?.slice(0, 22) || "Failed";
        setTimeout(() => {
          btn.classList.remove("mh-err");
          btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
        }, 3000);
      }
    } catch (e) {
      btn.classList.remove("mh-sending");
      btn.classList.add("mh-err");
      btn.querySelector(".mh-overlay-label").textContent = "Bridge offline";
      setTimeout(() => {
        btn.classList.remove("mh-err");
        btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
      }, 3000);
      console.warn("[mh] send failed:", e);
    }
  });

  btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  btn.addEventListener("mousedown", (ev) => ev.stopPropagation());

  return btn;
}

function findHostFor(video) {
  // Walk up looking for a positioned ancestor. Reddit's video
  // players wrap things in plenty of layers — cap at 8 to be safe
  // (more than Twitter's 6 because shreddit-player has extra
  // shadow-host wrappers).
  let cur = video.parentElement;
  for (let i = 0; i < 8 && cur; i++) {
    const pos = getComputedStyle(cur).position;
    if (pos === "relative" || pos === "absolute" || pos === "fixed") {
      return cur;
    }
    cur = cur.parentElement;
  }
  const parent = video.parentElement;
  if (parent) parent.style.position = parent.style.position || "relative";
  return parent;
}

// 1.2.13 — `target` can be a <video> OR a <shreddit-player> web
// component. New reddit puts the actual <video> inside <shreddit-
// player>'s closed shadow root which we can't see, so we treat
// the player element itself as the anchor.
function processVideo(target) {
  if (target.classList.contains(MARKER_CLASS)) return;
  const postUrl = findPostUrl(target);
  if (!postUrl) return;
  const host = findHostFor(target);
  if (!host) return;
  target.classList.add(MARKER_CLASS);
  const btn = makeButton(postUrl);
  host.classList.add("mh-host");
  host.appendChild(btn);

  // Same belt-and-suspenders hover binding as twitter — bind on
  // multiple targets with both pointer + mouse events because
  // reddit's <shreddit-player> shadow DOM eats events
  // unpredictably depending on layout.
  const show = () => btn.classList.add("mh-visible");
  const hide = () => btn.classList.remove("mh-visible");
  const article =
    target.closest("shreddit-post") ||
    target.closest("article") ||
    target.closest("[data-testid='post-container']");
  const hoverTargets = [article, host, target].filter(Boolean);
  for (const t of hoverTargets) {
    t.addEventListener("pointerenter", show);
    t.addEventListener("pointerleave", hide);
    t.addEventListener("mouseenter", show);
    t.addEventListener("mouseleave", hide);
  }
  btn.addEventListener("pointerenter", show);
  btn.addEventListener("mouseenter", show);

  console.log(
    `[mh] reddit: attached button (target: ${target.tagName}, host: ${host.tagName}, hoverTargets: ${hoverTargets.length}, post: ${postUrl})`,
  );
}

// 1.2.13 — Selector covers every variant we've seen:
//   - <video> — old reddit + some embed types (light DOM)
//   - <shreddit-player> — new reddit's primary video Web Component
//     (light DOM; the actual <video> is inside its closed shadow
//     root which we can't penetrate, so we anchor on the player
//     element itself)
//   - <faceplate-img-or-video> — rare alt component on some posts
const MEDIA_SELECTOR = "video, shreddit-player, faceplate-img-or-video";

function init() {
  const initial = document.querySelectorAll(MEDIA_SELECTOR);
  console.log(
    `[mh] reddit: init on ${location.href} — found ${initial.length} media elements at load time (selector: ${MEDIA_SELECTOR})`,
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
  console.log("[mh] reddit: MutationObserver attached, watching for new videos / shreddit-players");
}

console.log("[mh] reddit: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
