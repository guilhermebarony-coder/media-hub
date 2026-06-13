# Cookies & Restricted-Video Downloads — Research

Status: research / decision doc, written 2026-06-13. Goal: figure out how
Media Hub can reliably download **restricted** videos — age-restricted,
private / login-walled, members-only, follower-only, region-locked — and
survive YouTube's bot checks. Companion to the per-site cookie work that
shipped in **1.5.0** (`cookies_source` + `cookies_overrides`, see
NOTES 2026-06-09).

TL;DR — there are **two independent problems** (authentication vs. bot
detection), the current cookie approach is hobbled by **Chrome's
App-Bound Encryption**, and the single best fix for *our* architecture is
to **harvest cookies through the browser's own API** — either via our
existing extension (`chrome.cookies`) or a built-in Tauri WebView login.
Both sidestep the encryption wall entirely. Firefox is the zero-effort
stopgap; a PO-token sidecar is a YouTube-specific add-on.

> **2026-06-13 UPDATE — we ran a live diagnostic and found the REAL
> blocker. It was NOT the cookies and NOT PO tokens. See §0.**

---

## 0. Live diagnostic (2026-06-13) — the actual root cause

We tested a real **age-restricted** YouTube video
(`EqVkMLZv2RU`) with a real exported `cookies.txt`, bundled yt-dlp
`2026.05.25`. Findings, in order:

1. **No cookies** → `ERROR: Sign in to confirm your age`. (Confirms it's
   age-gated.)
2. **With cookies, default client** → age gate **passed** (cookies work!),
   but the *only* formats returned were storyboards (`sb0/1/2`) — **no
   real audio/video.** This is the exact "no formats on restricted
   videos" symptom.
3. **With cookies + every player_client** (web, web_safari, mweb, tv,
   tv_embedded, ios, android, android_vr) → still **0 real A/V formats**.
4. **Read the warnings** → the real cause surfaced:
   > `Signature solving failed… Ensure you have a supported JavaScript
   > runtime…`
   > `n challenge solving failed…  …/wiki/EJS`

   yt-dlp **2025.11+** moved YouTube's `sig`/`nsig` cipher solving to an
   **external JavaScript runtime ("EJS")**. The bundled PyInstaller
   yt-dlp has **no JS engine**, so signature solving fails and the real
   stream URLs can't be deciphered — only storyboards (which need no
   signature) survive.
5. **With cookies + `--js-runtimes node`** (Node 24 was on the dev box) →
   `[jsc:node] Solving JS challenges using node` → **FULL format list:
   audio 140/251, video up to 1080p (137), muxed 18, etc.** ✅ Solved.

**Conclusion.** For this case (and the class of "restricted shows no
formats"), the problem was **two things, and PO tokens were not one of
them**:
- **(A) Cookies** — pass the age/auth gate. Our per-site cookie work
  already does this; the browser-API harvest (§4) makes it painless.
- **(C) A JavaScript runtime** — solve YouTube's sig/nsig challenges so
  the real formats appear. **This is the missing piece in Media Hub
  today**, and it affects *normal* YouTube too as YouTube hardens, not
  just restricted videos.

So the headline fix is cheaper and cleaner than the PO-token route:
**bundle a JS runtime as a sidecar** (or detect one) and pass
`--js-runtimes …`. No UI change, no workflow change — exactly the
"invisible plumbing" we wanted.

### Recommended JS-runtime approach
- **Bundle Deno** as a sidecar (the runtime yt-dlp prefers; a single
  self-contained ~40 MB binary per platform, fits our existing
  yt-dlp/ffmpeg sidecar-fetch pattern). Invoke with
  `--js-runtimes deno:<resolved-sidecar-path>`.
- *Alternative:* detect a system **Node** and use `--js-runtimes node`
  when present (free if installed, but editors often won't have it).
- *Alternative:* bundle **QuickJS** (~1 MB, much smaller than Deno) —
  yt-dlp supports it, but it's less battle-tested for the heavier
  challenges; Deno is the safe default.
- yt-dlp fetches the EJS *solver scripts* itself at runtime (worked out
  of the box once the runtime was present), so we only need to supply the
  **runtime binary**, not the solver code.

PO tokens (old §3 #8 / §4 Option D) remain a *separate, later* lever for
the "Sign in to confirm you're not a bot" wall on flagged IPs — but they
were **not** what blocked this video. Deprioritize relative to the JS
runtime.

**Revised priority:** ① bundle JS runtime (unblocks restricted *and*
hardens normal YouTube) → ② browser-API cookie harvest (§4 Option A/B,
for the auth gate) → ③ PO-token sidecar only if bot checks bite.

---

## 1. Frame the problem: two separate axes

People lump this together as "the cookies thing," but it's really two
orthogonal walls, and a download can hit either or both:

| Axis | What it gates | Fixed by |
|------|---------------|----------|
| **A. Authentication** | "Who are you?" — private posts, age-restricted, members/followers-only, your own paid content | A valid **logged-in session** (cookies, or OAuth) |
| **B. Bot detection** | "Are you a real browser?" — YouTube's *"Sign in to confirm you're not a bot"*, 403s on datacenter/flagged IPs | A **PO token** (proof-of-origin) + a believable client |

The trap: people throw cookies at a **bot-detection** problem and it
doesn't help (and vice-versa). YouTube increasingly needs *both*. Most
other sites (Instagram, X, TikTok, Patreon) only need **A**.

---

## 2. Why our current approach is limited

Today (`settings::cookies_args_for`) we support three sources per site:
`none`, `--cookies-from-browser <browser>`, `--cookies <file>`. Problems:

1. **Chrome / Chromium cookies are unreadable on Windows.** Since **Chrome
   127 (July 2024)**, Chrome uses **App-Bound Encryption (ABE)**: the
   cookie-decryption key is bound to the Chrome binary and guarded by a
   SYSTEM-privileged service. *No external process* — not yt-dlp, not a
   password manager, not even running as admin — can decrypt the cookie
   DB anymore. This is the `Failed to decrypt with DPAPI` error our
   Settings page already warns about. It affects Chrome, Edge, Brave,
   Vivaldi, Opera — every Chromium browser.
2. **Browser-lock.** `--cookies-from-browser` needs the browser *closed*
   on Windows (SQLite lock), which is terrible UX.
3. **Manual `cookies.txt` expires.** Even when exported correctly, YouTube
   cookies rot in ~2 weeks and need re-export. Easy to get wrong
   (wrong format, missing httpOnly auth tokens).
4. **No bot-detection story at all.** Nothing addresses axis B.

So in practice, today **only Firefox and a hand-exported file actually
work**, and neither addresses YouTube's bot wall.

---

## 3. Survey of every cookie-acquisition method (with verdicts)

| # | Method | Works in 2026? | Notes |
|---|--------|----------------|-------|
| 1 | `--cookies-from-browser chrome/edge/brave` (Windows) | ❌ | Blocked by ABE. The thing we warn about. |
| 2 | `--cookies-from-browser chrome` (macOS) | ⚠️ | macOS uses Keychain, not ABE — yt-dlp *can* still read it, but prompts for Keychain access and is flaky. |
| 3 | `--cookies-from-browser firefox` | ✅ | Firefox stores cookies in **unencrypted SQLite** (`cookies.sqlite`). The one browser path that just works, all OSes. Still needs Firefox closed-ish. |
| 4 | Manual `cookies.txt` (Netscape) via a trusted exporter extension | ✅ | Works but manual + expires. **Only use "Get cookies.txt LOCALLY"** (open-source). The old "Get cookies.txt" was literally malware. |
| 5 | Direct DB decrypt libs (`rookiepy`, ctypes DPAPI) | ❌ | Same ABE wall as #1. |
| 6 | **Chrome DevTools Protocol** (`Network.getAllCookies` over `--remote-debugging-port`) | ⚠️ | Works because *Chrome itself* decrypts. But requires relaunching the user's Chrome with a debug flag — hacky, fragile, scary-looking. |
| 7 | yt-dlp native **OAuth2** (YouTube TV device-code flow) | ❌ | Added 2024, since **deprecated / broken** — YouTube clamped down. Not reliable. |
| 8 | **PO token provider** (`bgutil-ytdlp-pot-provider`) | ✅ (axis B only) | Generates YouTube proof-of-origin tokens to pass the bot check. Doesn't authenticate you. Rust + Node implementations exist; runs as a small HTTP server or one-shot script. |
| 9 | **Browser-API harvest** (`chrome.cookies` / WebView cookie store) | ✅✅ | **The key insight — see §4.** The browser hands us decrypted cookies through its own API. ABE is irrelevant because we never touch the encrypted DB. |

---

## 4. The outside-the-box ideas (tailored to Media Hub's architecture)

The breakthrough: **stop trying to read the encrypted cookie database.
Ask the browser for the cookies through an API it already exposes.** ABE
only protects data *at rest on disk* — it does nothing to the browser's
own runtime cookie access. We have *two* clean ways to do this, and we're
unusually well-positioned because we already ship a browser extension and
a desktop app with a localhost bridge.

### Option A — Extension cookie-bridge ⭐ (reuses everything we have)

We already have: a cross-browser MV3 extension, an authenticated
localhost bridge (`127.0.0.1:47821`, `bridge_token`), and a "Send to
Media Hub" flow. Add cookie harvesting to it.

**Flow:**
1. Add `"cookies"` to the extension's `permissions` (it already has
   `<all_urls>` host permission).
2. When the user sends a URL (or on a new "Send with my login" action),
   the extension calls
   `chrome.cookies.getAll({ url })` → returns **all cookies for that
   site, including httpOnly auth tokens** (confirmed: extensions with the
   `cookies` permission can read httpOnly, unlike `document.cookie`).
3. Extension serializes them to **Netscape `cookies.txt`** format and
   POSTs them to the desktop app over the existing bridge (token-auth'd).
4. Desktop app writes a **temp cookies.txt**, passes `--cookies <temp>`
   to yt-dlp for that one job, then deletes it.

**Why it's great for us:**
- **Bypasses Chrome ABE completely** — the browser decrypts and hands
  them over; we never touch the encrypted store.
- **Works on every Chromium browser AND Firefox** — `browser.cookies`
  is standard WebExtensions API. Fixes our "Chromium is broken" warning
  outright.
- **Every site the user is logged into** — Instagram, YouTube, X, TikTok,
  Patreon — not just YouTube. Uses their *real* live session.
- **Per-site by construction** — we only read cookies for the *target
  URL's* domain, which is exactly the privacy posture we want and mirrors
  the per-site `cookies_overrides` model from 1.5.0.
- **No "close your browser," no manual export, no expiry surprises** —
  cookies are read live at download time.
- MV3 caveat is a non-issue: we only read on demand (user-triggered), not
  via a persistent background listener.

**Cost:** moderate. New extension message type + a bridge endpoint that
accepts a cookie blob and stashes it for the next job. Needs care around
the `cookies` permission review on the Web Store (justifiable: "send your
logged-in session to the paired desktop app for downloads").

### Option B — Built-in WebView "Connect account" ⭐ (self-contained, no extension)

Tauri 2 exposes `WebviewWindow::cookies_for_url()` (via wry 0.47), which
returns the runtime cookie store **including httpOnly + secure** cookies.
So we can do the whole thing *inside the app*, no browser or extension:

**Flow:**
1. Settings → "Connected accounts" → **Connect YouTube / Instagram /…**.
2. Opens a Tauri WebView window to that site's login page. User logs in
   normally (even 2FA) — it's a real browser engine (WebView2 on Windows,
   WKWebView on macOS).
3. On success we call `webview.cookies_for_url(site)` → harvest the
   session cookies → persist them (encrypted at rest) as that platform's
   cookie source.
4. Downloads for that platform feed the stored cookies via `--cookies`.

**Why it's great:**
- **Zero external dependencies** — no Firefox, no extension, no manual
  export. A true "Sign in to download restricted content" button.
- Works for **all platforms**, reuses our per-site model.
- Best UX of any option: one-time login, app remembers it.

**Cost / caveats:** more dev work. The wry cookie getter **deadlocks in
sync commands on Windows** — must read on an async command / separate
thread (documented limitation). Cookie *setting* isn't implemented in wry
(getters only), but we only need to *read*, so fine. We own refresh:
re-open the login WebView when cookies expire.

### Option C — Firefox / dedicated-profile path (zero-effort stopgap)

We already have a `firefox` option in the cookies picker, and it *works*
(unencrypted SQLite). Two cheap improvements:
- In the Settings cookie UI, **promote Firefox as "the one that works"**
  and de-emphasize the broken Chromium options (or hide them on Windows).
- Optionally support a **dedicated downloader Firefox profile** path so
  the user doesn't have to close their main browser.

This is the "ship today" move while A or B is built.

### Option D — PO-token sidecar (YouTube bot-check, axis B)

For YouTube's *"Sign in to confirm you're not a bot"*, cookies alone
often aren't enough — you need a **PO token**. `bgutil-ytdlp-pot-provider`
generates them; there's a **Rust** implementation that runs as a tiny
HTTP server (or one-shot script). We could **bundle it as a sidecar**
(like yt-dlp/ffmpeg) and point yt-dlp's `youtubepot-bgutilhttp` plugin at
it. Complementary to A/B — combine "real cookies + PO token + TV/web
client" for the best YouTube success rate. Heavier to bundle (it pulls a
BotGuard/JS runtime), so treat as a **YouTube-only opt-in**, not default.

---

## 5. Recommendation & phasing

1. **Now / stopgap (hours):** Reframe the Settings cookie UI around
   Firefox = works, Chromium = broken-on-Windows (we already warn; make
   it the default guidance). No new capability, just honest UX.
2. **P1 — Extension cookie-bridge (Option A):** highest leverage for the
   least new surface, because the extension + authenticated bridge already
   exist. Solves Chrome ABE, covers every logged-in site, fits the
   per-site model. **This is the recommended primary solution.**
3. **P2 — WebView "Connect account" (Option B):** the premium,
   self-contained experience for users who don't install the extension.
   More work, but it's the long-term "just log in" answer.
4. **Add-on — PO-token sidecar (Option D):** only if YouTube bot checks
   keep biting after A/B. Opt-in, YouTube-scoped.

A and B share the same back-end: both end in "we have fresh cookies for
domain X → write temp cookies.txt → `--cookies`." So the desktop-side
plumbing (a `cookies_ingest(platform, netscape_blob)` command + temp-file
handling) is shared and worth building first.

---

## 6. Security & privacy notes (cookies are credentials)

- A session cookie **is** the login. Treat the blob like a password.
- **Scope to the target domain** — never slurp the whole cookie jar; read
  only cookies for the site being downloaded (both APIs support this).
- **Bridge is already token-authed** (`bridge_token`); keep cookie
  ingestion behind it and bound to `127.0.0.1`.
- **Ephemeral temp files**: write the cookies.txt to a temp path with
  tight perms, pass to yt-dlp, delete immediately after the job. Never
  drop it in the library tree or logs.
- If we persist cookies (Option B), encrypt at rest (OS keychain /
  DPAPI-per-user) and let the user disconnect/clear per platform.
- **Never** recommend random "cookies.txt" extensions — several have been
  malware. If we suggest a manual exporter, name the audited open-source
  one only.
- Respect that this is for the **user's own logged-in sessions / content**
  — same posture as any yt-dlp front-end.

---

## 7. Sources

- yt-dlp #10927 — DPAPI / App-Bound Encryption breaks `--cookies-from-browser`: https://github.com/yt-dlp/yt-dlp/issues/10927
- yt-dlp #15401 — Chrome v20 cookie decryption on Windows: https://github.com/yt-dlp/yt-dlp/issues/15401
- yt-dlp #13445 — cookies not working for age-restricted: https://github.com/yt-dlp/yt-dlp/issues/13445
- yt-dlp #15865 — "all public videos require login / not a bot": https://github.com/yt-dlp/yt-dlp/issues/15865
- yt-dlp PO Token Guide (wiki): https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- "6 Ways to Get YouTube Cookies for yt-dlp in 2026 — Only 1 Works": https://dev.to/osovsky/6-ways-to-get-youtube-cookies-for-yt-dlp-in-2026-only-1-works-2cnb
- bgutil-ytdlp-pot-provider (Rust): https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs
- Tauri `Webview::cookies` / `cookies_for_url` API (commit): https://github.com/tauri-apps/tauri/commit/cedb24d494b84111daa3206c05196c8b89f1e994
- Tauri discussion #11655 — using the WebView cookies API: https://github.com/tauri-apps/tauri/discussions/11655
- Chrome App-Bound Encryption background: https://alternativeto.net/news/2024/8/google-enhances-chrome-security-on-windows-with-app-bound-encryption-to-fight-cookie-theft
- MDN `cookies.getAll` (httpOnly via extension API): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/getAll
- "Get cookies.txt LOCALLY" (audited exporter): https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
