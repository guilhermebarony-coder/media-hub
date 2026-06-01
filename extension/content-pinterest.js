// Media Hub — Pinterest content script (1.3.x).
//
// Pinterest's player layer is a heavyweight overlay that captures
// pointerdown across the entire video bbox AND its wrapper has
// `overflow: hidden`, clipping anything that tries to spill out
// the top edge. The earlier attempt to plant the button inside the
// pin DOM lost both fights: the button visually clipped at the
// top, and clicks got eaten by the player layer.
//
// Solution: PORTAL THE BUTTON TO document.body with position:fixed.
//   - Outside Pinterest's DOM tree → their overflow:hidden + overlays
//     can't touch us
//   - getBoundingClientRect() tracks the video's on-screen position
//   - rAF-throttled scroll / resize / mutation observer keeps the
//     button glued to the video corner
//   - When the video leaves the viewport (or is removed by
//     Pinterest's virtualized scroll), the button hides itself
//
// Pin URL discovery is unchanged from the in-DOM version.

const MARKER_ATTR = "data-mh-pinterest";
const PIN_RE = /^\/pin\/(\d+)\/?/i;

// Single overlay container appended to <body>. All Pinterest pin
// buttons live as siblings inside it — keeps the DOM tidy when the
// user has 30+ pins on screen.
let overlayLayer = null;
function ensureOverlayLayer() {
  if (overlayLayer && document.body.contains(overlayLayer)) return overlayLayer;
  overlayLayer = document.createElement("div");
  overlayLayer.id = "mh-pinterest-layer";
  // The layer itself doesn't capture pointer events — only its
  // button children do. Otherwise the layer would block every
  // click on the page underneath.
  Object.assign(overlayLayer.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.body.appendChild(overlayLayer);
  return overlayLayer;
}

/**
 * Walk up from a <video> to find the parent pin and return its URL.
 * Same logic as the in-DOM version.
 */
function findPinUrl(video) {
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
  if (PIN_RE.test(location.pathname)) {
    return `https://${location.host}${location.pathname}`;
  }
  return null;
}

function makeButton(pinUrl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mh-overlay-btn mh-overlay-btn--portal";
  btn.title = "Send to Media Hub";
  btn.innerHTML = `
    <span class="mh-overlay-dot"></span>
    <span class="mh-overlay-label">Media Hub</span>
  `;

  const fire = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }
    if (btn.classList.contains("mh-sending") || btn.classList.contains("mh-sent")) {
      return;
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

  // Capture-phase mousedown — fires before any Pinterest handler
  // that might still try to reach us through the portal.
  btn.addEventListener("mousedown", fire, { capture: true });
  btn.addEventListener("click", fire);
  btn.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }
  });

  return btn;
}

/**
 * Track a video element's on-screen position and keep the button
 * glued just above its top-right corner. The button lives in the
 * body-portal overlay layer, so we only need to update top/left
 * (in viewport coords) — no transforms relative to host elements.
 */
function trackVideo(video, btn) {
  let pendingFrame = null;
  let lastVisible = false;

  const positionBtn = () => {
    pendingFrame = null;
    const r = video.getBoundingClientRect();
    // Hide when the video is offscreen, collapsed, or hidden.
    const visible =
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      r.right > 0 &&
      r.left < window.innerWidth;
    if (visible !== lastVisible) {
      btn.style.display = visible ? "" : "none";
      lastVisible = visible;
    }
    if (!visible) return;
    // Sit at the video's top-right corner, with the button's
    // center pulled to the video's top edge (translateY -50% on
    // the button via CSS). top/right anchor in viewport coords.
    btn.style.top = `${r.top}px`;
    btn.style.left = `${r.right - 14}px`; // 14 ≈ half the compact pill width
  };

  const schedule = () => {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(positionBtn);
  };

  // Update on every scroll + resize. Capture-phase so it catches
  // scrolls from inner containers too (Pinterest's feed virtualizes
  // through nested scroll regions on some surfaces).
  const onScroll = schedule;
  const onResize = schedule;
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onResize, { passive: true });

  // ResizeObserver on the video catches layout changes when
  // Pinterest swaps the player size (autoplay, ratio change).
  const ro = new ResizeObserver(schedule);
  ro.observe(video);

  // IntersectionObserver hides the button when the video scrolls
  // out of viewport. Cheaper than re-checking on every scroll.
  const io = new IntersectionObserver(schedule, {
    threshold: [0, 0.01, 0.99, 1],
  });
  io.observe(video);

  // Pinterest will eventually unmount the video as the user scrolls.
  // Detect that via a MutationObserver on body, watch for removed
  // nodes; when our tracked video is gone, clean up.
  const cleanupObs = new MutationObserver(() => {
    if (!document.body.contains(video)) {
      cleanup();
    }
  });
  cleanupObs.observe(document.body, { childList: true, subtree: true });

  const cleanup = () => {
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onResize);
    ro.disconnect();
    io.disconnect();
    cleanupObs.disconnect();
    if (btn.parentNode) btn.parentNode.removeChild(btn);
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  };

  // First paint.
  positionBtn();

  return { cleanup };
}

function processVideo(video) {
  if (video.getAttribute(MARKER_ATTR) === "1") return;
  const pinUrl = findPinUrl(video);
  if (!pinUrl) return;
  video.setAttribute(MARKER_ATTR, "1");

  const btn = makeButton(pinUrl);
  ensureOverlayLayer().appendChild(btn);

  // Hover-reveal: bind on the pin's outermost container so the
  // button shows whenever the cursor enters the pin card, and
  // hides when it leaves. Track the button itself too so moving
  // onto the button doesn't trigger hide.
  const show = () => btn.classList.add("mh-visible");
  const hide = () => btn.classList.remove("mh-visible");
  const pin =
    video.closest("[data-test-id='pin']") ||
    video.closest("[data-test-id='pinrep']") ||
    video.closest("article") ||
    video.parentElement;
  const targets = [pin, video].filter(Boolean);
  for (const t of targets) {
    t.addEventListener("pointerenter", show);
    t.addEventListener("pointerleave", hide);
    t.addEventListener("mouseenter", show);
    t.addEventListener("mouseleave", hide);
  }
  btn.addEventListener("pointerenter", show);
  btn.addEventListener("mouseenter", show);
  btn.addEventListener("pointerleave", hide);
  btn.addEventListener("mouseleave", hide);

  trackVideo(video, btn);

  console.log(
    `[mh] pinterest: portaled button (pin: ${pinUrl})`,
  );
}

function init() {
  ensureOverlayLayer();
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
