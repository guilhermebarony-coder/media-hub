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

  // 1.13.x — quick options menu (Ctrl/Cmd+click on the overlay button).
  // App-styled popover: quality, type, rename, transcode → onSubmit(extras).
  // Only one is ever open; opening a new one closes the previous.
  let openMenuEl = null;
  function closeQuickMenu() {
    if (openMenuEl) {
      openMenuEl.remove();
      openMenuEl = null;
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    }
  }
  function onDocDown(e) {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeQuickMenu();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") closeQuickMenu();
  }
  // 1.13.x — ask the OS to launch Media Hub via its registered protocol,
  // WITHOUT opening a tab. A hidden same-page iframe pointed at
  // `mediahub://open` does it: the navigation inherits the click's user
  // activation (required — Chrome ignores protocol launches from
  // background tabs), the OS catches the scheme, and the page itself
  // never navigates. The iframe is torn down right after.
  //
  // Deliberately payload-free: the app's deep-link handler no-ops on an
  // unknown action, so it just starts. The actual enqueue is sent over
  // the bridge once the app is up, which keeps all the menu options.
  function launchAppViaProtocol() {
    try {
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = "mediahub://open";
      document.documentElement.appendChild(frame);
      setTimeout(() => frame.remove(), 2000);
    } catch (e) {
      console.warn("[mh] protocol launch failed:", e);
    }
  }

  // 1.13.x — custom dropdown. The native <select> popup list is drawn by
  // the OS and ignores our font/colors (it rendered white-on-blue inside
  // the dark card), so we roll a div listbox we fully control.
  // Value lives in wrap.dataset.value; `onChange` fires on pick.
  function makeSelect(key, options, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "mh-sel";
    wrap.dataset.k = key;
    wrap.dataset.value = options[0].v;
    wrap.innerHTML = `
      <button class="mh-sel-btn" type="button">
        <span class="mh-sel-val"></span>
        <svg class="mh-sel-chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.4"
                fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="mh-sel-list" hidden></div>
    `;
    const btn = wrap.querySelector(".mh-sel-btn");
    const list = wrap.querySelector(".mh-sel-list");
    const valEl = wrap.querySelector(".mh-sel-val");
    valEl.textContent = options[0].l;
    for (const o of options) {
      const el = document.createElement("div");
      el.className = "mh-sel-opt" + (o.v === options[0].v ? " sel" : "");
      el.dataset.v = o.v;
      el.textContent = o.l;
      list.appendChild(el);
    }
    const closeList = () => {
      list.hidden = true;
      wrap.classList.remove("open");
    };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = !list.hidden;
      // Only one list open at a time inside the menu.
      const menu = wrap.closest(".mh-menu");
      menu.querySelectorAll(".mh-sel-list").forEach((l) => (l.hidden = true));
      menu.querySelectorAll(".mh-sel").forEach((s) => s.classList.remove("open"));
      if (!wasOpen) {
        list.hidden = false;
        wrap.classList.add("open");
      }
    });
    list.addEventListener("click", (e) => {
      const opt = e.target.closest(".mh-sel-opt");
      if (!opt) return;
      e.preventDefault();
      e.stopPropagation();
      wrap.dataset.value = opt.dataset.v;
      valEl.textContent = opt.textContent;
      list.querySelectorAll(".mh-sel-opt").forEach((o) => o.classList.toggle("sel", o === opt));
      closeList();
      if (onChange) onChange(opt.dataset.v);
    });
    return wrap;
  }
  // Build a labeled row: <span>label</span> + control.
  function makeRow(label, control) {
    const row = document.createElement("label");
    row.className = "mh-menu-row";
    const span = document.createElement("span");
    span.textContent = label;
    row.appendChild(span);
    row.appendChild(control);
    return row;
  }
  function openQuickMenu(btn, onSubmit) {
    closeQuickMenu();
    const menu = document.createElement("div");
    menu.className = "mh-menu";

    const title = document.createElement("div");
    title.className = "mh-menu-title";
    title.textContent = "Opções de download";
    menu.appendChild(title);

    const qualitySel = makeSelect("quality", [
      { v: "", l: "Melhor" },
      { v: "1080", l: "1080p" },
      { v: "720", l: "720p" },
      { v: "480", l: "480p" },
    ]);
    const transcodeSel = makeSelect("transcode", [
      { v: "none", l: "Nenhum" },
      { v: "prores_422_lt", l: "ProRes 422 LT" },
      { v: "dnxhr_sq", l: "DNxHR SQ" },
      { v: "h264_mp4", l: "H.264 MP4" },
      { v: "h264_nvenc_mp4", l: "H.264 NVENC" },
    ]);
    // Audio types have no quality/transcode meaning — hide those rows.
    // Class, not inline display: .mh-menu-row is `display: flex
    // !important`, which an inline style can't override (same trap that
    // made the overlay button impossible to hide — see positionBtn).
    const syncType = (v) => {
      const audio = v !== "video";
      qualityRow.classList.toggle("mh-row-off", audio);
      transcodeRow.classList.toggle("mh-row-off", audio);
    };
    const typeSel = makeSelect(
      "type",
      [
        { v: "video", l: "Vídeo" },
        { v: "mp3", l: "Áudio MP3" },
        { v: "m4a", l: "Áudio M4A" },
        { v: "flac", l: "Áudio FLAC" },
      ],
      syncType,
    );
    const renameInput = document.createElement("input");
    renameInput.className = "mh-menu-field";
    renameInput.type = "text";
    renameInput.placeholder = "(opcional)";

    const qualityRow = makeRow("Qualidade", qualitySel);
    const transcodeRow = makeRow("Transcode", transcodeSel);
    menu.appendChild(qualityRow);
    menu.appendChild(makeRow("Tipo", typeSel));
    menu.appendChild(makeRow("Renomear", renameInput));
    menu.appendChild(transcodeRow);

    const actions = document.createElement("div");
    actions.className = "mh-menu-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "mh-menu-btn";
    cancelBtn.textContent = "Cancelar";
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "mh-menu-btn mh-menu-btn--go";
    goBtn.textContent = "Baixar";
    actions.appendChild(cancelBtn);
    actions.appendChild(goBtn);
    menu.appendChild(actions);

    document.body.appendChild(menu);
    openMenuEl = menu;
    syncType("video");

    // Position: below-left of the button, clamped to the viewport.
    const r = btn.getBoundingClientRect();
    const mw = 240;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 8;
    if (top + 240 > window.innerHeight) top = Math.max(8, r.top - 248);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    cancelBtn.addEventListener("click", closeQuickMenu);
    goBtn.addEventListener("click", () => {
      const type = typeSel.dataset.value;
      const rename = renameInput.value;
      const extras =
        type === "video"
          ? {
              mode: "video",
              quality: qualitySel.dataset.value || undefined,
              transcode: transcodeSel.dataset.value,
              rename,
            }
          : { mode: type, rename };
      closeQuickMenu();
      onSubmit(extras);
    });
    // Defer the outside-click listener so THIS opening click doesn't close it.
    setTimeout(() => {
      document.addEventListener("mousedown", onDocDown, true);
      document.addEventListener("keydown", onKeyDown, true);
    }, 0);
  }

  function makeButton({ targetUrl, mode = "video", source, mediaIndex }) {
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

    // Send to the app with the button's status feedback. `extras` carries
    // the quick-menu overrides ({ mode, quality, transcode, rename }) — for
    // a plain click it's just the default { mode }.
    const sendWith = async (resolved, extras) => {
      btn.classList.add("mh-sending");
      btn.querySelector(".mh-overlay-label").textContent = "Sending…";
      try {
        const reply = await chrome.runtime.sendMessage({
          kind: "send-to-hub",
          url: resolved,
          source,
          mode: extras.mode ?? mode,
          quality: extras.quality,
          transcode: extras.transcode,
          rename: extras.rename,
          mediaIndex,
        });
        if (reply?.ok) {
          btn.classList.remove("mh-sending");
          btn.classList.add("mh-sent");
          btn.querySelector(".mh-overlay-label").textContent = "Queued ✓";
          setTimeout(() => {
            btn.classList.remove("mh-sent");
            btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
          }, 2000);
        } else if (reply?.offline) {
          // 1.13.x — app is closed: launch it, wait for it, then enqueue.
          // The launch must happen IN THE PAGE (hidden iframe) because a
          // protocol handler needs the click's user activation — Chrome
          // silently ignores mediahub:// opened in a background tab, which
          // is why the old tab-based version never launched anything.
          // We fire `mediahub://open` (no payload) so the app doesn't
          // also self-enqueue; the background then sends the real enqueue
          // once /health answers, preserving every quick-menu option.
          btn.querySelector(".mh-overlay-label").textContent = "Abrindo app…";
          launchAppViaProtocol();
          try {
            const r = await chrome.runtime.sendMessage({
              kind: "await-app-and-enqueue",
              url: resolved,
              source,
              mode: extras.mode ?? mode,
              quality: extras.quality,
              transcode: extras.transcode,
              rename: extras.rename,
              mediaIndex,
            });
            btn.classList.remove("mh-sending");
            if (r?.ok) {
              btn.classList.add("mh-sent");
              btn.querySelector(".mh-overlay-label").textContent = "Queued ✓";
              setTimeout(() => {
                btn.classList.remove("mh-sent");
                btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
              }, 2000);
            } else {
              btn.classList.add("mh-err");
              btn.querySelector(".mh-overlay-label").textContent =
                r?.error === "app didn't start" ? "App não abriu" : "Falhou";
              setTimeout(() => {
                btn.classList.remove("mh-err");
                btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
              }, 3500);
            }
          } catch {
            btn.classList.remove("mh-sending");
            btn.classList.add("mh-err");
            btn.querySelector(".mh-overlay-label").textContent = "App fechado";
            setTimeout(() => {
              btn.classList.remove("mh-err");
              btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
            }, 3000);
          }
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
        // sendMessage throwing usually means THIS tab's content script
        // is orphaned — the extension was installed/updated/reloaded
        // after the page loaded ("Extension context invalidated").
        const stale =
          !(chrome.runtime && chrome.runtime.id) ||
          /context invalidated|receiving end does not exist/i.test(
            String(e?.message || e),
          );
        btn.querySelector(".mh-overlay-label").textContent = stale
          ? "Reload page (F5)"
          : "Bridge offline";
        setTimeout(() => {
          btn.classList.remove("mh-err");
          btn.querySelector(".mh-overlay-label").textContent = "Media Hub";
        }, 4000);
        console.warn("[mh] send failed:", e);
      }
    };

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
      // the player is on, even if the user nav'd between pins.
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
      // 1.13.x — Ctrl/Cmd+click opens the quick options menu (quality,
      // type, rename, transcode) before sending. Plain click sends now.
      // The openMenuEl guard dedupes the mousedown+click pair.
      if (ev.ctrlKey || ev.metaKey) {
        if (!openMenuEl) openQuickMenu(btn, (extras) => sendWith(resolved, extras));
        return;
      }
      await sendWith(resolved, { mode });
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
  // 1.13.x — how much of the video is ACTUALLY on screen after every
  // clipping ancestor has had its say, as a 0–1 fraction of its area.
  //
  // A viewport-only test isn't enough: an Instagram carousel keeps the
  // neighbouring slides in the DOM, sitting at viewport coordinates but
  // visually cut off by the carousel's `overflow: hidden`. Those slides
  // looked "visible", so every one of them got its own button — hence a
  // pile of buttons on a multi-video post, some landing over unrelated
  // page furniture. Intersecting with the clipping ancestors leaves only
  // the slide the user is actually looking at.
  // Walking ancestors with getComputedStyle forces a style recalc, and
  // this runs per video per animation frame while scrolling — so cache
  // WHICH ancestors clip (that rarely changes) and re-read only their
  // rects each call. Refreshed on a TTL, or if the chain went stale.
  const clipperCache = new WeakMap();
  const CLIPPER_TTL_MS = 1000;
  function clippersFor(el) {
    const hit = clipperCache.get(el);
    const now = Date.now();
    if (hit && now - hit.at < CLIPPER_TTL_MS && hit.list.every((n) => n.isConnected)) {
      return hit.list;
    }
    const list = [];
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (/hidden|clip|auto|scroll/.test(`${cs.overflow}${cs.overflowX}${cs.overflowY}`)) {
        list.push(node);
      }
      node = node.parentElement;
    }
    clipperCache.set(el, { at: now, list });
    return list;
  }

  function visibleFraction(el, r, scope) {
    if (r.width <= 0 || r.height <= 0) return 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Denominator is the area that COULD be on screen, not the element's
    // full area — otherwise a video taller than the viewport (a portrait
    // reel on a laptop) could never clear the 50% bar and would never get
    // a button at all.
    const area = Math.min(r.width, vw) * Math.min(r.height, vh);
    if (area <= 0) return 0;
    let { left, top, right, bottom } = r;
    // The viewport is the outermost clipper, and the one that matters
    // most here: a carousel's previous slide sits at negative x, fully
    // off screen. Intersecting only with `overflow: hidden` ancestors
    // scored it 1.0 whenever that ancestor chain wasn't what we expected
    // — tying with the slide actually on screen, so neither out-ranked
    // the other and BOTH kept a button. That tie was the ghost.
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, vw);
    bottom = Math.min(bottom, vh);
    // The post box is a clipper we can actually trust. Instagram's
    // article is exactly one slide wide, so a carousel neighbour — which
    // lives outside it, on screen but in the next post's column of empty
    // space — scores 0 here even when the real `overflow: hidden`
    // ancestor eludes us. Mid-swipe it also separates the incoming slide
    // (>50% inside the post) from the outgoing one (<50%), which the
    // viewport alone can't do: both are on screen at that moment.
    //
    // Guarded: only clip to a scope that's actually big enough to hold
    // the video, so a site whose hover container is some small header
    // can't zero out every button.
    if (scope) {
      const sr = scope.getBoundingClientRect();
      if (sr.width >= r.width * 0.9 && sr.height >= r.height * 0.9) {
        left = Math.max(left, sr.left);
        top = Math.max(top, sr.top);
        right = Math.min(right, sr.right);
        bottom = Math.min(bottom, sr.bottom);
      }
    }
    for (const clip of clippersFor(el)) {
      const cr = clip.getBoundingClientRect();
      // A zero-size clipper (collapsed/detached) would falsely zero the
      // result — skip those rather than hide a legitimate button.
      if (cr.width <= 0 || cr.height <= 0) continue;
      left = Math.max(left, cr.left);
      top = Math.max(top, cr.top);
      right = Math.min(right, cr.right);
      bottom = Math.min(bottom, cr.bottom);
    }
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    // Cap at 1 — with the clamped denominator an oversized element that's
    // filling the screen can otherwise score slightly above it.
    return Math.min(1, (w * h) / area);
  }

  // 1.13.4 — carousel arbitration: among the videos of the SAME POST,
  // a slide loses its button to any sibling that's more visible.
  //
  // Scope is the post container (the <article>, i.e. the hoverContainer
  // the site script already computes) — NOT the clipping ancestor, which
  // is what the first attempt used and why the ghost survived: when a
  // carousel gives each slide its own overflow-hidden wrapper, that
  // wrapper holds exactly one <video>, so there were never any "peers"
  // to arbitrate against and every slide kept its button.
  //
  // Comparing fractions (rather than picking one winner outright) is what
  // keeps X working: a tweet showing two videos side by side has BOTH at
  // fraction ~1.0, neither out-ranks the other, so both keep their button
  // and media_index still decides which one you get. In a carousel the
  // off-screen neighbour is always strictly less visible than the slide
  // you're looking at, so it always loses.
  function isDominantVideo(el, myFraction, scope) {
    if (!scope) return true;
    const peers = scope.querySelectorAll("video");
    if (peers.length < 2) return true;
    for (const p of peers) {
      if (p === el) continue;
      const pr = p.getBoundingClientRect();
      if (pr.width < 80 || pr.height < 80) continue;
      // Strictly greater (with a small epsilon) so an exact tie can't
      // hide both and leave the post with no button at all.
      if (visibleFraction(p, pr, scope) > myFraction + 0.01) return false;
    }
    return true;
  }

  function trackVideo(video, btn, scope) {
    let pendingFrame = null;

    const positionBtn = () => {
      pendingFrame = null;
      const r = video.getBoundingClientRect();
      // A true modal (Twitter's fullscreen photo/media viewer uses
      // aria-modal="true") covers the page. Any video NOT inside that
      // modal is behind it — its rect often collapses toward the
      // top-left, which would park the pill in the corner over the
      // lightbox. Hide buttons for videos the modal covers; the video
      // INSIDE the modal (the fullscreen player) still gets its button.
      const modal = document.querySelector('[aria-modal="true"]');
      const coveredByModal = !!modal && !modal.contains(video);
      // Minimum real-player size. Twitter (and others) keep collapsed
      // ~0–1px <video> ghosts in the DOM — for preloading, or the
      // element left behind when the photo/media lightbox opens. Those
      // ghosts sit at the top-left origin, so without a size floor the
      // pill glues itself to the corner over whatever's on screen. Real
      // players are always far larger than this.
      const bigEnough = r.width >= 80 && r.height >= 80;
      // Carousels: only the slide actually on screen gets a button. The
      // 0.5 floor keeps the current slide during a swipe animation while
      // dropping the neighbours the container clips away.
      const myFraction = visibleFraction(video, r, scope);
      const mostlyUnclipped = myFraction >= 0.5;
      const visible =
        !coveredByModal &&
        bigEnough &&
        mostlyUnclipped &&
        isDominantVideo(video, myFraction, scope) &&
        r.bottom > 0 &&
        r.top < window.innerHeight &&
        r.right > 0 &&
        r.left < window.innerWidth;
      // Always apply visibility from the CURRENT geometry — never gate
      // it behind a "changed" check. The button starts hidden (set at
      // attach time); a "not visible" video must explicitly KEEP it
      // hidden, otherwise it falls back to its CSS default position
      // (top-left corner) and lingers there.
      //
      // 1.13.4 — toggles a CLASS, not the inline display. The overlay
      // stylesheet sets `display: inline-flex !important`, which beats
      // an inline style, so `btn.style.display = "none"` never hid
      // anything: hidden buttons stayed rendered at their last
      // coordinates, invisible only through `opacity: 0`. When
      // .mh-visible got stuck on one (a slide leaving from under the
      // cursor fires no pointerleave) it showed up as the ghost.
      btn.classList.toggle("mh-hidden", !visible);
      if (!visible) {
        // Drop the hover-reveal too, so a stuck class can't light up a
        // button we've decided isn't showing.
        btn.classList.remove("mh-visible");
        return;
      }
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
    // Carousels move by CSS transform, which fires none of the events
    // above — so without this the button only catches up on the ~300ms
    // poll and can sit at a stale position meanwhile. Re-check the moment
    // any transition/animation on the page settles (capture: these don't
    // bubble reliably from arbitrary descendants).
    const onAnimEnd = schedule;
    document.addEventListener("transitionend", onAnimEnd, { capture: true, passive: true });
    document.addEventListener("animationend", onAnimEnd, { capture: true, passive: true });

    const ro = new ResizeObserver(schedule);
    ro.observe(video);

    const io = new IntersectionObserver(schedule, {
      threshold: [0, 0.01, 0.99, 1],
    });
    io.observe(video);

    // Idle re-check tick. A video can collapse / get covered (Twitter's
    // photo lightbox opening, then the page going quiet) without firing
    // scroll / resize / RO / IO — leaving a stale button frozen on
    // screen until some unrelated reflow (e.g. opening DevTools) clears
    // it. A slow poll re-runs the visibility check so the button hides
    // on its own. ~300ms is imperceptible; one getBoundingClientRect
    // per video is negligible.
    const tick = window.setInterval(schedule, 300);

    // Watch for video removal — site SPAs virtualize / unmount
    // <video> as the user scrolls past.
    const cleanupObs = new MutationObserver(() => {
      if (!document.body.contains(video)) {
        cleanup();
        return;
      }
      // DOM churn includes a modal (photo/media viewer) opening or
      // closing — which doesn't fire scroll/resize. Reschedule so the
      // covered-by-modal check re-runs and the button hides/shows.
      // schedule() coalesces to one reposition per frame.
      schedule();
    });
    cleanupObs.observe(document.body, { childList: true, subtree: true });

    function cleanup() {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      document.removeEventListener("transitionend", onAnimEnd, { capture: true });
      document.removeEventListener("animationend", onAnimEnd, { capture: true });
      ro.disconnect();
      io.disconnect();
      cleanupObs.disconnect();
      window.clearInterval(tick);
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
  function attachPortalButton({ video, targetUrl, source, hoverContainer, mode, mediaIndex }) {
    const btn = makeButton({ targetUrl, mode, source, mediaIndex });
    // Start hidden — trackVideo's first positionBtn() reveals it only
    // if the video is actually a visible, real-sized player. Prevents
    // the button flashing at its CSS-default corner before the first
    // geometry check runs. (Class, not inline display — see positionBtn.)
    btn.classList.add("mh-hidden");
    ensureLayer().appendChild(btn);

    // Never reveal a button geometry has ruled out — otherwise hovering
    // anywhere on a carousel lights up the off-screen slides' buttons too.
    const show = () => {
      if (!btn.classList.contains("mh-hidden")) btn.classList.add("mh-visible");
    };
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

    // Arbitration scope = the post container, so a carousel's
    // off-screen slides can't keep a button of their own.
    return trackVideo(video, btn, hoverContainer || null);
  }

  window.mhPortal = { attachPortalButton, ensureLayer };
})();
