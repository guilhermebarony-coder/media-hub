// Media Hub — Shared overlay portal (1.3.x).
//
// Loaded BEFORE each site-specific content script (content-twitter.js
// etc.) via the manifest's `js: [...]` ordering. Exposes a global
// `window.mhPortal` namespace; site scripts call `attachPortalButton`
// for each detected video element and only have to bring the
// site-specific URL discovery.
//
// Why a portal: several platforms (Pinterest, Instagram, sometimes
// Twitter) wrap their video player in an `overflow: hidden` container
// AND attach pointer-capture handlers across the player's bounding
// box. Anything we inject inside that DOM is either clipped at the
// edges or has its clicks stolen by the platform's handler. By
// portaling the button to a body-level <div> and tracking the video
// via getBoundingClientRect(), we sidestep both issues.

(() => {
  if (window.mhPortal) return; // idempotent — content scripts re-run on SPA nav sometimes

  const LAYER_ID = "mh-overlay-portal-layer";
  let layer = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement("div");
    layer.id = LAYER_ID;
    // The layer itself doesn't capture pointer events — only its
    // button children do — otherwise it'd block clicks on the page
    // underneath. Children explicitly enable pointer-events.
    Object.assign(layer.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.body.appendChild(layer);
    return layer;
  }

  // 1.3.x — `targetUrl` may be a string (most sites) OR a function
  // resolved at click time. The function form lets Pinterest read the
  // active <video>.currentSrc — which is the actual CDN .mp4 URL —
  // instead of the pin-page URL that yt-dlp's extractor sometimes
  // fails on. Return falsy from the resolver and we fall back to the
  // original targetUrl string (if the resolver was paired with one).
  function resolveTargetUrl(targetUrl) {
    if (typeof targetUrl === "function") {
      try {
        const v = targetUrl();
        if (v && typeof v === "string") return v;
      } catch (e) {
        console.warn("[mh] targetUrl resolver threw:", e);
      }
    }
    if (typeof targetUrl === "string") return targetUrl;
    return null;
  }

  function makeButton({ targetUrl, mode = "video", source }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mh-overlay-btn mh-overlay-btn--portal";
    btn.title = "Send to Media Hub";
    // 1.3.x — download arrow glyph instead of the plain square dot.
    // Tray + arrow, ~10x10, stroke uses currentColor on .mh-overlay-icon
    // so resting (lime) and hover (dark) inversion stays single-source.
    btn.innerHTML = `
      <span class="mh-overlay-icon" aria-hidden="true">
        <svg viewBox="0 0 12 12" fill="none">
          <path d="M6 1.6v5.4M3.5 5l2.5 2.5L8.5 5M2.4 10h7.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="mh-overlay-label">Media Hub</span>
    `;

    const fire = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") {
        ev.stopImmediatePropagation();
      }
      if (btn.classList.contains("mh-sending") || btn.classList.contains("mh-sent")) {
        return; // dedupe — mousedown + click can both fire
      }
      // Resolve the URL right now — for sites passing a function this
      // reads the live <video>.src so we capture the actual CDN URL
      // the player is on, even if the user nav'd between pins after
      // the button attached.
      const resolved = resolveTargetUrl(targetUrl);
      if (!resolved) {
        btn.classList.add("mh-err");
        btn.querySelector(".mh-overlay-label").textContent = "No URL";
        setTimeout(() => {
          btn.classList.remove("mh-err");
          btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
        }, 2500);
        return;
      }
      btn.classList.add("mh-sending");
      btn.querySelector(".mh-overlay-label").textContent = "Sending…";
      try {
        const reply = await chrome.runtime.sendMessage({
          kind: "send-to-hub",
          url: resolved,
          mode,
          source,
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

    // Capture-phase mousedown — primary path. Bubble-phase click is
    // the keyboard-activation / fallback path. pointerdown stop just
    // in case the platform listens at window level.
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
   * Track a video's on-screen position and keep the button glued to
   * its top-right corner (the CSS translateY(-50%) pulls the button
   * up so half sits above the video edge).
   *
   * Returns a cleanup function — call it when the video is removed
   * to detach observers and the button.
   */
  function trackVideo(video, btn) {
    let pendingFrame = null;
    let lastVisible = false;

    const positionBtn = () => {
      pendingFrame = null;
      const r = video.getBoundingClientRect();
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
      // top-right of video — the universal CSS adds translateY(-50%)
      // so the center of the pill lands on the video's top edge.
      btn.style.top = `${r.top}px`;
      btn.style.left = `${r.right - 14}px`;
    };

    const schedule = () => {
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(positionBtn);
    };

    const onScroll = schedule;
    const onResize = schedule;
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    const ro = new ResizeObserver(schedule);
    ro.observe(video);

    const io = new IntersectionObserver(schedule, {
      threshold: [0, 0.01, 0.99, 1],
    });
    io.observe(video);

    // Watch for video removal — site SPAs virtualize / unmount
    // <video> as the user scrolls past.
    const cleanupObs = new MutationObserver(() => {
      if (!document.body.contains(video)) {
        cleanup();
      }
    });
    cleanupObs.observe(document.body, { childList: true, subtree: true });

    function cleanup() {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      io.disconnect();
      cleanupObs.disconnect();
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    }

    positionBtn();
    return cleanup;
  }

  /**
   * Public API. Site scripts call this once per detected video with:
   *   - video: the <video> element (or player-anchor element)
   *   - targetUrl: the canonical URL we want yt-dlp to fetch
   *   - source: telemetry tag ("content-twitter", "content-reddit", …)
   *   - hoverContainer: outermost element used for hover-reveal
   *     binding. Hovering anywhere inside it shows the button. If
   *     null, defaults to the video.
   *   - mode: "video" (default) or audio variants if a site ever
   *     wants single-mode preference
   *
   * Returns the cleanup function from trackVideo.
   */
  function attachPortalButton({ video, targetUrl, source, hoverContainer, mode }) {
    const btn = makeButton({ targetUrl, mode, source });
    ensureLayer().appendChild(btn);

    const show = () => btn.classList.add("mh-visible");
    const hide = () => btn.classList.remove("mh-visible");
    const targets = [hoverContainer, video].filter(Boolean);
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

    return trackVideo(video, btn);
  }

  window.mhPortal = { attachPortalButton, ensureLayer };
})();
