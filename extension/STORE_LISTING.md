# Chrome Web Store listing — Media Hub: Send to App

Paste-ready copy for the Developer Dashboard.

## Item name
Media Hub — Send to App

## Summary (132 chars max)
Send the current tab, link, or detected video to the Media Hub desktop app's download queue — one click, straight to your library.

## Category
Productivity

## Language
English (United States)

## Detailed description
Media Hub — Send to App is the browser companion for the Media Hub desktop
application (a download manager + media library built for video editors).

Found a clip you want? Click once and it lands in Media Hub's download
queue — no copy-pasting URLs.

Features:
• One-click send from the toolbar button, right-click menu, or keyboard
  shortcut (Ctrl+Shift+Y for video, Ctrl+Shift+M for MP3).
• On-page overlay buttons on YouTube, X / Twitter, Reddit, Pinterest,
  Instagram, and TikTok — send a specific post or video without leaving
  the page.
• Detects the media on the page so you grab exactly the right item.
• Forwards your existing login session to the desktop app so it can fetch
  media you're already signed in to view.
• Talks only to the Media Hub app on your own computer (localhost). Nothing
  is sent to any external server.

Requires the free Media Hub desktop app:
https://github.com/guilhermebarony-coder/media-hub/releases/latest

## Single purpose (required field)
Send the current tab, link, or detected video/audio to the Media Hub
desktop app's download queue over localhost.

## Permission justifications
- cookies: Reads the user's login cookies for the current site and forwards
  them to the user's locally-running Media Hub app (127.0.0.1) so it can
  download media the user is authorized to view. Never sent to any remote
  server.
- webRequest: Detects media (video/audio) stream URLs on supported sites so
  the user can send them to the app. Observation only — no blocking.
- host permissions (supported sites + 127.0.0.1): Inject the on-page "send"
  overlay on the supported sites and deliver items to the local app.
- activeTab: Read the current tab when the user clicks the button / menu.
- tabs: Read the active tab's URL and title to queue the correct item.
- notifications: Confirm to the user when an item was sent.
- storage: Save the local app address/port and user preferences.
- contextMenus: Add the right-click "Send to Media Hub" entry.

## Privacy practices
- Collects user data: No data is sent to the developer or any third party;
  data goes only to the user's own machine (127.0.0.1).
- Not sold to third parties: confirmed.
- Not used for unrelated purposes: confirmed.
- Privacy policy URL:
  https://github.com/guilhermebarony-coder/media-hub/blob/main/extension/PRIVACY.md

## Screenshots needed (1280×800 or 640×400, at least one)
1. The extension popup open, showing the "Send to Media Hub" action +
   detected media. Caption: "Send any video to your queue in one click."
2. The on-page overlay button on a YouTube video. Caption: "Send buttons
   right where you browse — YouTube, X, Reddit, TikTok & more."
3. (Optional) The desktop app's queue receiving the item. Caption: "Lands
   straight in the Media Hub desktop app."

## Notes
- Icons (16/48/128) ship inside the zip; the 128px is used as the store
  icon automatically.
- A small promo tile (440×280) is optional but recommended for visibility.
