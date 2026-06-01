// Media Hub — Pinterest content script (1.3.x).
//
// Same pattern as content-twitter.js / content-reddit.js — inject a
// hover-reveal "Media Hub" button on every video pin on
// pinterest.com, click sends the parent PIN's URL (not the raw CDN
// .mp4). yt-dlp's pinterest extractor wants the pin URL — the raw
// CDN URLs are blob: / signed URLs that either expire fast or refuse
// to download anonymously.
//
// Pin URL shape:
//   https://www.pinterest.com/pin/<numeric_id>/
//   (locale subdomains and country TLDs like .co.uk all canonicalize
//    to the same numeric pin id; we keep whatever host the user is on
//    so cookies / region routing stays consistent)
//
// Pinterest layout coverage:
//   - Feed cards: <div data-test-id="pin"> ... <video> ...
//   - "Closeup" / lightbox pin view: URL is already /pin/<id>/, so
//     even if our DOM walk fails we can fall back to location.pathname.
//   - GIF "Idea pins" with multiple video frames count once per video
//     element thanks to the idempotent MARKER_CLASS guard.

const MARKER_CLASS = "mh-injected";
const PIN_RE = /^\/pin\/(\d+)\/?/i;

/**
 * Walk up from a <video> to find the parent pin and return its URL.
 * Returns null when we can't identify a pin — in which case we skip
 * injecting (no point sending unknown context).
 */
function findPinUrl(video) {
  // Preferred path: closest pin container.
  // Pinterest's stable hooks are `data-test-id="pin"` (feed cards)
  // and `data-test-id="pinrep"` (variant on some surfaces). Walk
  // anchors inside it for the pin permalink.
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
        // Keep the user's current host (locale TLD) — yt-dlp
        // resolves all of them.
        return `https://${location.host}${path}`;
      }
    }
  }

  // Fallback: page-level pin URL (closeup / direct /pin/<id>/ view).
  if (PIN_RE.test(location.pathname)) {
    return `https://${location.host}${location.pathname}`;
  }
  return null;
}

function makeButton(pinUrl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mh-overlay-btn";
  btn.title = "Send to Media Hub";
  btn.innerHTML = `
    <span class="mh-overlay-dot"></span>
    <span class="mh-overlay-label">Media Hub</span>
  `;

  // 1.3.x — Pinterest hovers a "Save" + react-button layer on every
  // pin that wins the click race by hooking `pointerdown` on a
  // sibling layer covering the whole pin. By the time `click` fires,
  // Pinterest has already navigated the user to the closeup view and
  // our button is gone with the previous DOM.
  //
  // Fix: trigger the send on `mousedown` in CAPTURE phase, which
  // fires before Pinterest's bubbling pointerdown handler. We swallow
  // propagation so Pinterest never sees the event at all. The
  // bubble-phase `click` handler below is the fallback for browsers
  // where the capture-phase trick somehow loses (none observed yet,
  // but cheap insurance).
  const fire = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }
    if (btn.classList.contains("mh-sending") || btn.classList.contains("mh-sent")) {
      return; // dedupe — mousedown + click may both fire
    }
    btn.classList.add("mh-sending");
    btn.querySelector(".mh-overlay-label").textContent = "Sending…";
    try {
      const reply = await chrome.runtime.sendMessage({
        kind: "send-to-hub",
        url: pinUrl,
        mode: "video",
        source: "content-pinterest",
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
  };

  // Capture-phase mousedown — fires BEFORE Pinterest's overlay
  // pointerdown handler can run. This is the actual primary path.
  btn.addEventListener("mousedown", fire, { capture: true });
  // Bubble-phase click fallback in case capture-phase mousedown
  // doesn't fire (e.g. keyboard activation via Enter).
  btn.addEventListener("click", fire);
  // Stop pointerdown propagating in case Pinterest also listens on
  // window/document to navigate the pin into closeup view.
  btn.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }
  });

  return btn;
}

/**
 * Pick the smallest positioned ancestor to host the button so
 * position:absolute lands in the video's corner. Pin cards usually
 * have a positioned wrapper a couple levels above the <video>.
 */
function findHostFor(video) {
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

function processVideo(video) {
  if (video.classList.contains(MARKER_CLASS)) return;
  const pinUrl = findPinUrl(video);
  if (!pinUrl) return;
  const host = findHostFor(video);
  if (!host) return;
  video.classList.add(MARKER_CLASS);
  const btn = makeButton(pinUrl);
  host.classList.add("mh-host");
  host.appendChild(btn);

  // Hover-reveal: same pattern as twitter/reddit. The 1.3.x button
  // redesign sits HALF ABOVE the video's top edge, which puts the
  // click hitbox outside Pinterest's player layer — so the
  // capture-phase mousedown + half-above geometry combined keeps
  // clicks safe even on Pinterest's overlay-happy DOM.
  const show = () => btn.classList.add("mh-visible");
  const hide = () => btn.classList.remove("mh-visible");
  const pin =
    video.closest("[data-test-id='pin']") ||
    video.closest("[data-test-id='pinrep']") ||
    video.closest("article");
  const targets = [pin, host, video].filter(Boolean);
  for (const t of targets) {
    t.addEventListener("pointerenter", show);
    t.addEventListener("pointerleave", hide);
    t.addEventListener("mouseenter", show);
    t.addEventListener("mouseleave", hide);
  }
  btn.addEventListener("pointerenter", show);
  btn.addEventListener("mouseenter", show);

  console.log(
    `[mh] pinterest: attached button (host: ${host.tagName}.${host.className.slice(0, 30)}, targets: ${targets.length}, pin: ${pinUrl})`,
  );
}

function init() {
  const initial = document.querySelectorAll("video");
  console.log(
    `[mh] pinterest: init on ${location.href} — found ${initial.length} videos at load time`,
  );
  for (const v of initial) processVideo(v);

  // Pinterest is an SPA that swaps the closeup lightbox in/out and
  // virtualizes the feed grid heavily. New <video> elements appear
  // constantly as the user scrolls and clicks pins.
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
      console.log(
        `[mh] pinterest: observer has caught ${observed} new videos since init`,
      );
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
