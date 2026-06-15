# Privacy Policy — Media Hub: Send to App

_Last updated: 2026-06-15_

**Media Hub — Send to App** ("the extension") is a companion to the Media
Hub desktop application. It lets you send the current tab, a link, or a
detected video/audio stream to the Media Hub desktop app's download queue.

## The short version

The extension sends data **only to the Media Hub desktop app running on
your own computer** (`http://127.0.0.1`). It does **not** send your data to
us, to any remote server, or to any third party. There is no analytics, no
tracking, and no account.

## What the extension accesses, and why

- **The active tab's URL and title** — to know which page/video you want to
  queue. Read only when you click the toolbar button, use the context menu,
  or press the keyboard shortcut.
- **Media stream URLs on supported sites** (YouTube, X/Twitter, Reddit,
  Pinterest, Instagram, TikTok) — detected on the page so you can pick the
  right item to download.
- **Login cookies for the site you are on** — read and forwarded to your
  local desktop app so it can download media you are already signed in to
  view (e.g. an account-restricted video). Cookies are sent **only** to
  `127.0.0.1` and are never transmitted anywhere else.
- **Local extension storage** — stores your preferences and the local app's
  address/port. Stays on your device.

## What we do NOT do

- We do not collect, store, or transmit your data to our servers — we
  operate no servers that receive your data.
- We do not sell or share your data with third parties.
- We do not use your data for advertising or any purpose unrelated to the
  extension's single function (sending media to your local app).

## Data retention

The extension keeps no history of what you send. Cookies and page data are
read transiently at the moment you trigger an action and passed straight to
your local app; they are not retained by the extension.

## Open source

The extension's full source code is public and auditable:
https://github.com/guilhermebarony-coder/media-hub/tree/main/extension

## Contact

Questions or concerns: open an issue at
https://github.com/guilhermebarony-coder/media-hub/issues
