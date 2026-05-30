# Media Hub — Browser Extension

Send videos from your browser straight into Media Hub with one click.

> 🇧🇷 **Versão em português:** [README.pt-br.md](./README.pt-br.md)

---

## ✅ Before you start

1. **Media Hub desktop app must be installed and OPEN.** The extension
   talks to the app — if the app is closed, nothing happens.
2. You'll need the **pairing token** from the app. We'll grab it in
   Step 3 below. Don't worry, it's one copy-paste.

---

## 📦 Step 1 — Install the extension (Chrome / Edge / Brave)

1. Open a new tab and type this in the address bar, then press Enter:
   ```
   chrome://extensions
   ```
   *(On Edge use `edge://extensions`, on Brave use `brave://extensions`.)*

2. Find the **"Developer mode"** switch in the **top-right corner** and
   turn it **ON**.

3. A new row of buttons appears. Click **"Load unpacked"**.

4. A file picker opens. Navigate to and select the **`extension` folder**
   (the folder this README is inside). Click **"Select Folder"**.

5. Done — you'll see a **"Media Hub"** card appear, and a new icon in
   your browser's toolbar (top-right, may be hidden under the little
   puzzle-piece 🧩 icon — click it and pin Media Hub).

---

## 🔑 Step 2 — Open the app and find your token

1. Open the **Media Hub desktop app**.
2. Go to **Settings** (gear icon, top-right).
3. Scroll to the **"Browser bridge"** section.
4. You'll see a **Token** field with a long string of letters/numbers.
   Click the **"Copy"** button next to it.

---

## 🔗 Step 3 — Pair the extension with the app

1. Click the **Media Hub extension icon** in your browser toolbar.
2. Click **"Options"** at the bottom of the little popup.
3. A settings tab opens. **Paste your token** into the **"Bridge token"**
   box (Ctrl+V).
4. Click **"Save"**.
5. Click **"Test connection"**. You should see a **green message**:
   *"Connected · Media Hub v1.2.15"*. 🎉

   ❌ If it says "couldn't reach app" — make sure the **desktop app is
   open** and try again.

---

## 🚀 How to use it

You've got **four ways** to send a video. Use whichever feels natural:

### 1. The toolbar button (works everywhere)
- Click the **Media Hub icon** in your toolbar.
- Pick a format: **Video / MP3 / M4A / FLAC**.
- Click **"Send to Media Hub"**. Done — it's downloading in the app.

### 2. The button on the video (Twitter/X and Reddit)
- On **x.com** or **reddit.com**, hover your mouse over any video.
- A little lime **"● Media Hub"** button appears in the corner.
- Click it. That exact video goes to the app.

### 3. Right-click
- Right-click on a video, link, or page → **"Send to Media Hub"**.
- ⚠️ On YouTube/Twitter this might not show (those sites block
  right-click). Use method 1 or 4 there instead.

### 4. Keyboard shortcuts (fastest)
- **Ctrl + Shift + Y** → send the current tab as **video**
- **Ctrl + Shift + M** → send the current tab as **MP3**
- These work even on YouTube where right-click is blocked.

---

## 🌐 What works where

| Site | Best way to send |
|------|------------------|
| **YouTube** | Toolbar button, or `Ctrl+Shift+Y` |
| **Twitter / X** | Hover the video → click the lime button |
| **Reddit** | Hover the video → click the lime button |
| **Instagram** | Toolbar button (their player blocks the in-video button) |
| **Any other site** | Toolbar button, or the "Detected" list in the popup |

**"Detected on this tab" list:** when you open the popup, it also shows
any videos it spotted loading on the page (great for tricky sites with
multiple videos). Click 👁 to preview one, or click the row to send it.

---

## ❓ Troubleshooting

**The button on the video doesn't show up.**
→ Refresh the page (**Ctrl+F5**). The button only appears on freshly
loaded pages.

**"Media Hub offline" / can't connect.**
→ The desktop app isn't running. Open it, then try again. The popup has
a **"Try launching app"** button that can open it for you.

**Right-click menu is missing on YouTube/Twitter.**
→ Those sites block right-click. Use the toolbar button or the keyboard
shortcut (`Ctrl+Shift+Y`) instead.

**I changed the token / port in the app.**
→ Re-open the extension's **Options**, paste the new token, Save.
(If you changed the **port**, also restart the desktop app.)

**Updated the extension files?**
→ Go to `chrome://extensions` and click the **🔄 reload icon** on the
Media Hub card.

---

## 🔒 Is this safe / private?

Yes.

- The extension **only talks to your own computer** (`127.0.0.1`,
  the local loopback address). It never sends anything to the internet
  or to us.
- It only sends a video URL when **you click a button** — it never
  downloads or transmits anything on its own.
- The pairing token lives in your browser's private storage and acts
  as a password so random websites can't fire downloads at your app.
- The "Detected" list reads video URLs as the page loads them, but
  keeps them **in memory only** and forgets them when you close the tab.

---

## 🦊 Firefox note

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on…"**.
3. Select the **`manifest.json`** file inside the extension folder.
4. Then follow Step 2 + Step 3 above to pair it.

⚠️ Firefox forgets temporary add-ons when you close the browser — you'd
re-add it each session. For daily use, Chrome/Edge/Brave is smoother
right now.

---

## 🛠 For developers

```
extension/
├─ manifest.json        ← MV3 manifest (+ Firefox compat)
├─ bridge.js            ← Shared HTTP client (popup + background)
├─ popup.html/css/js    ← Toolbar popup
├─ options.html/css/js  ← Pairing / settings page
├─ background.js        ← Service worker: context menu, hotkeys, msg router
├─ sniffer.js           ← Passive per-tab stream detector
├─ content-twitter.js   ← In-page button on x.com / twitter.com
├─ content-reddit.js    ← In-page button on reddit.com
├─ content-overlay.css  ← Shared overlay-button styling
└─ icons/
```

No build step — plain ES modules served from disk. Edit a file, hit the
reload icon on `chrome://extensions`, done. All traffic is loopback-only
(`127.0.0.1:47821` by default); the bridge token (in `chrome.storage.local`)
is the auth.
