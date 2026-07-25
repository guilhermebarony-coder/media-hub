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

// A quoted tweet is rendered INSIDE the outer tweet's <article>, wrapped
// in its own div[role="link"] card. That nesting is what made the old
// "first status anchor in the article" logic download the wrong video:
// both players resolved to whichever permalink appeared first in the DOM
// (usually the quote's, since on a status page the main tweet has no
// timestamp anchor in its header). Now each video resolves within its own
// tweet's scope.
const QUOTE_SEL = 'div[role="link"]';

/** First status permalink inside `root`, preferring the <time> anchor
 *  (the canonical permalink) over any other status link. When
 *  `skipQuotes` is set, anchors living inside a nested quote card are
 *  ignored so the outer tweet never resolves to its quote. */
function statusUrlIn(root, { skipQuotes = false } = {}) {
  const anchors = Array.from(root.querySelectorAll("a[href]"));
  const inQuote = (a) => {
    const q = a.closest(QUOTE_SEL);
    return !!q && q !== root && root.contains(q);
  };
  const usable = skipQuotes ? anchors.filter((a) => !inQuote(a)) : anchors;
  // Pass 1: the permalink anchor wraps a <time>. Pass 2: any status link.
  for (const pass of [true, false]) {
    for (const a of usable) {
      if (pass && !a.querySelector("time")) continue;
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      // Canonicalize to x.com (legacy twitter.com works too — yt-dlp
      // accepts either).
      if (STATUS_RE.test(path)) return `https://x.com${path}`;
    }
  }
  return null;
}

/**
 * Map a <video> to the permalink of the tweet it actually belongs to —
 * the quoted tweet when the player sits inside a quote card, otherwise
 * the outer tweet. Returns the full https://x.com/... URL or null.
 */
function findStatusUrl(video) {
  const article = video.closest("article");

  // Video inside a quoted tweet.
  const quote = video.closest(QUOTE_SEL);
  if (quote && (!article || article.contains(quote))) {
    // Best case: the quote card carries its own permalink.
    const url = statusUrlIn(quote);
    if (url) return url;
    // X usually renders the quote card with NO inner anchor at all (the
    // whole card is the link), so its permalink isn't in the DOM. Fall
    // back to the outer tweet's URL — yt-dlp enumerates the quoted media
    // under it too, and findMediaIndex() below tells the app WHICH item
    // to take, so this no longer downloads the wrong video.
    if (article) {
      return (
        statusUrlIn(article, { skipQuotes: true }) ||
        (STATUS_RE.test(location.pathname) ? `https://x.com${location.pathname}` : null)
      );
    }
    return null;
  }

  if (article) {
    // Outer tweet: ignore anything belonging to a nested quote.
    const url = statusUrlIn(article, { skipQuotes: true });
    if (url) return url;
    // Status pages render the focused tweet without a timestamp anchor
    // in its header — there the page URL IS the outer tweet.
    if (STATUS_RE.test(location.pathname)) {
      return `https://x.com${location.pathname}`;
    }
    return null;
  }

  // No <article> (some layouts): a single-tweet view still tells us.
  if (STATUS_RE.test(location.pathname)) {
    return `https://x.com${location.pathname}`;
  }
  return null;
}

/**
 * Which media item of the tweet this video is, 1-based — what yt-dlp
 * calls the playlist index.
 *
 * A tweet can expose several videos under ONE status URL: its own media,
 * plus a quoted tweet's. yt-dlp enumerates them as entries, so the URL
 * alone can't say which one the user clicked — every button used to
 * download entry 1, which is why clicking one video could hand you the
 * other. DOM order matches yt-dlp's entry order (own media first, quote
 * after), so the video's position among the tweet's <video> elements is
 * the index. Returns null when there's only one (nothing to disambiguate).
 */
function findMediaIndex(video) {
  const article = video.closest("article");
  if (!article) return null;
  const vids = Array.from(article.querySelectorAll("video"));
  if (vids.length < 2) return null;
  const i = vids.indexOf(video);
  return i >= 0 ? i + 1 : null;
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

  const mediaIndex = findMediaIndex(video);

  window.mhPortal.attachPortalButton({
    video,
    targetUrl: statusUrl,
    source: "content-twitter",
    hoverContainer,
    mediaIndex,
  });

  console.log(
    `[mh] twitter: portaled button (status: ${statusUrl}${mediaIndex ? `, media #${mediaIndex}` : ""})`,
  );
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
