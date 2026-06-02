// Media Hub — Pinterest content script (1.3.x).
//
// URL discovery only — the portal/button/tracking lives in
// content-portal.js. We just find the pin URL for each video and
// hand it off.
//
// Pin URL shape:
//   https://<locale>.pinterest.<tld>/pin/<numeric_id>/
//   Locale subdomains + country TLDs (.co.uk, .de, .com.br…)
//   all carry the same numeric id; we keep whatever host the user
//   is currently on so region cookies / language stay consistent.

const MARKER_ATTR = "data-mh-pinterest";
const PIN_RE = /^\/pin\/(\d+)\/?/i;

function findPinUrl(video) {
  // Preferred: closest pin container via Pinterest's stable
  // `data-test-id` hooks.
  const pin =
    video.closest("[data-test-id='pin']") ||
    video.closest("[data-test-id='pinrep']") ||
    video.closest("article");
  if (pin) {
    const anchors = pin.querySelectorAll("a[href]");
    for (const a of anchors) {
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (PIN_RE.test(path)) {
        return `https://${location.host}${path}`;
      }
    }
  }
  // Closeup / direct /pin/<id>/ view — use the page URL.
  if (PIN_RE.test(location.pathname)) {
    return `https://${location.host}${location.pathname}`;
  }
  return null;
}

/**
 * 1.3.x — Layer 1 of the sniffer-fallback strategy: at CLICK TIME,
 * read the actual <video>'s current source. When Pinterest's player
 * uses a plain `<video src="https://v1.pinimg.com/.../foo_720w.mp4">`
 * (which is most pins), we get the real CDN URL with no sniffer
 * round-trip and the desktop app's queue auto-routes it through
 * media_direct_download. yt-dlp's flaky Pinterest extractor is
 * skipped entirely.
 *
 * If the src is a blob: URL (MediaSource Extensions, Pinterest's
 * fallback for some pins) or empty, we fall back to the pin-page
 * URL — yt-dlp will then take its normal shot at the extractor.
 * Layer 2 (sniffer round-trip for the blob: case) is the next-up
 * task; this layer alone should cover the majority of pins.
 */
function pickBestUrlAtClickTime(video, pinUrl) {
  return () => {
    try {
      const src = video.currentSrc || video.src || "";
      if (/^https?:\/\//i.test(src)) {
        console.log(`[mh] pinterest: using live <video>.currentSrc (${src})`);
        return src;
      }
    } catch {
      /* video element gone — fall through to pin URL */
    }
    console.log(`[mh] pinterest: live src unusable, falling back to pin URL (${pinUrl})`);
    return pinUrl;
  };
}

function processVideo(video) {
  if (!window.mhPortal) return; // portal helper missing — shouldn't happen
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const pinUrl = findPinUrl(video);
  if (!pinUrl) return;
  video.setAttribute(MARKER_ATTR, "1");

  const hoverContainer =
    video.closest("[data-test-id='pin']") ||
    video.closest("[data-test-id='pinrep']") ||
    video.closest("article") ||
    video.parentElement;

  window.mhPortal.attachPortalButton({
    video,
    // 1.3.x — pass a resolver instead of a fixed URL so we read
    // the live <video>.currentSrc at click time. See
    // pickBestUrlAtClickTime above for the layering.
    targetUrl: pickBestUrlAtClickTime(video, pinUrl),
    source: "content-pinterest",
    hoverContainer,
  });

  console.log(`[mh] pinterest: portaled button (pin: ${pinUrl})`);
}

function init() {
  const initial = document.querySelectorAll("video");
  console.log(
    `[mh] pinterest: init on ${location.href} — found ${initial.length} videos at load time`,
  );
  for (const v of initial) processVideo(v);

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
      console.log(`[mh] pinterest: observer has caught ${observed} new videos since init`);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  console.log("[mh] pinterest: MutationObserver attached, watching for new videos");
}

console.log("[mh] pinterest: content script loaded");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
