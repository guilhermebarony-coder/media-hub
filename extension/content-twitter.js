// Media Hub — Twitter/X content script (1.2.6).
//
// Injects a small "Send to Media Hub" button overlay on every
// <video> element on x.com / twitter.com. Click → sends the
// PARENT TWEET's status URL (not the raw .mp4) so yt-dlp's
// Twitter extractor can preserve title + uploader metadata.
//
// Why a content script vs. the sniffer:
//   - The sniffer sees raw CDN URLs (video.twimg.com/.../abc.mp4)
//     with no metadata. yt-dlp downloads them as anonymous files.
//   - This script knows the URL the user is LOOKING AT — the
//     parent tweet's permalink — which yt-dlp's twitter extractor
//     handles properly.
//   - One-click UX next to the video itself, matches what
//     Media Harvest / VDH / etc. ship.
//
// Twitter is a heavily-dynamic SPA — articles get added/removed
// as the user scrolls. We use MutationObserver instead of a one-
// shot scan so newly-revealed videos get the button automatically.

const MARKER_CLASS = "mh-injected";
const STATUS_RE = /^\/(?:i\/web\/status|[A-Za-z0-9_]+\/status)\/(\d+)/;

/**
 * Walk up from a <video> to its enclosing <article> (the tweet
 * container), then find the closest permalink anchor that points
 * to a status URL. Returns the full https://x.com/... URL or null.
 *
 * Twitter's DOM is unstable, but the pattern "<article> contains
 * an anchor with /user/status/N href" has held for years.
 */
function findStatusUrl(video) {
  const article = video.closest("article");
  if (!article) return null;

  // All anchors in the article, find the first one whose pathname
  // matches a status URL pattern. Multiple anchors exist (timestamp,
  // photo links, etc.); status anchors come up first in DOM order
  // because Twitter wraps the tweet-level link near the top.
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
      // Canonicalize to x.com — works for both x.com and the
      // legacy twitter.com domain, yt-dlp accepts either.
      return `https://x.com${path}`;
    }
  }

  // Fallback: if the page itself is already a single-tweet view,
  // use the location URL. Useful when DOM walk fails on some layouts.
  const m = location.pathname.match(STATUS_RE);
  if (m) return `https://x.com${location.pathname}`;
  return null;
}

/**
 * Build the floating button. Returns the element; positioning is
 * absolute (CSS handles placement in the top-right corner of the
 * wrapping container).
 */
function makeButton(video, statusUrl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mh-overlay-btn";
  btn.title = "Send to Media Hub";
  btn.innerHTML = `
    <span class="mh-overlay-dot"></span>
    <span class="mh-overlay-label">Media Hub</span>
  `;

  // Click → message background to send. We don't import bridge.js
  // here — content scripts can't easily use ES modules without
  // extra build steps, and chrome.runtime.sendMessage is the
  // standard handoff path anyway.
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    btn.classList.add("mh-sending");
    btn.querySelector(".mh-overlay-label").textContent = "Sending…";
    try {
      const reply = await chrome.runtime.sendMessage({
        kind: "send-to-hub",
        url: statusUrl,
        mode: "video",
        source: "content-twitter",
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

  // Twitter intercepts most pointer events on the video for its
  // own player controls — stopPropagation on pointerdown too so
  // our click doesn't accidentally toggle play/pause.
  btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  btn.addEventListener("mousedown", (ev) => ev.stopPropagation());

  return btn;
}

/**
 * Pick the best ancestor to host the button. We want the smallest
 * positioned element wrapping the video so position:absolute lands
 * the button in the video's corner. Twitter wraps videos in a few
 * `<div>` layers — the closest positioned one is usually the right
 * pick. Fallback: the video's direct parent.
 */
function findHostFor(video) {
  // Walk up looking for an element with position: relative/absolute/fixed.
  // Cap at 6 levels to avoid landing on the page <body>.
  let cur = video.parentElement;
  for (let i = 0; i < 6 && cur; i++) {
    const pos = getComputedStyle(cur).position;
    if (pos === "relative" || pos === "absolute" || pos === "fixed") {
      return cur;
    }
    cur = cur.parentElement;
  }
  // Last resort: force the parent to be relative + use it.
  const parent = video.parentElement;
  if (parent) parent.style.position = parent.style.position || "relative";
  return parent;
}

/** Process one <video> element — idempotent via MARKER_CLASS. */
function processVideo(video) {
  if (video.classList.contains(MARKER_CLASS)) return;
  const statusUrl = findStatusUrl(video);
  if (!statusUrl) return;
  const host = findHostFor(video);
  if (!host) return;
  video.classList.add(MARKER_CLASS);
  const btn = makeButton(video, statusUrl);
  // Mark the host so our CSS knows to keep position: relative.
  host.classList.add("mh-host");
  host.appendChild(btn);

  // 1.2.9 — robust hover-reveal. Twitter overlays controls on the
  // video that hijack/swallow pointer events in unpredictable ways,
  // so we cast a wide net: bind on the article (the whole tweet
  // box), the host, AND the video. Use BOTH pointerenter/leave and
  // mouseenter/leave because Twitter occasionally disables one or
  // the other on certain overlay layers. Belt and suspenders.
  const show = () => btn.classList.add("mh-visible");
  const hide = () => btn.classList.remove("mh-visible");
  const article = video.closest("article");
  const targets = [article, host, video].filter(Boolean);
  for (const t of targets) {
    t.addEventListener("pointerenter", show);
    t.addEventListener("pointerleave", hide);
    t.addEventListener("mouseenter", show);
    t.addEventListener("mouseleave", hide);
  }
  // Keep button visible while hovered (in case a leave on the host
  // fires as the cursor crosses onto the button itself).
  btn.addEventListener("pointerenter", show);
  btn.addEventListener("mouseenter", show);

  console.log(
    `[mh] attached button to video (host: ${host.tagName}.${host.className.slice(0, 30)}, targets: ${targets.length}, status: ${statusUrl})`,
  );
}

/** Scan + observe. */
function init() {
  // Initial pass.
  for (const v of document.querySelectorAll("video")) processVideo(v);

  // Observe future mutations. We only care about ADDED nodes — when
  // Twitter swaps tweets in/out as the user scrolls, the new <video>
  // elements need our button. Removed nodes don't need cleanup
  // (button gets garbage-collected with its host).
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.tagName === "VIDEO") {
          processVideo(node);
        } else {
          // Check descendants — added nodes are often wrapper divs
          // with the video several levels deep.
          const vids = node.querySelectorAll?.("video");
          if (vids?.length) vids.forEach(processVideo);
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Twitter is an SPA but content scripts only run once on initial
// load. The MutationObserver above handles every navigation
// internally — no need to re-bind on history.pushState.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
