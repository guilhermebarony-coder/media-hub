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
    targetUrl: pinUrl,
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
