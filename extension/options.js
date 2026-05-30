// Media Hub — options page script.
// Save URL + token to chrome.storage.local, test connection via /health.

import { DEFAULT_URL, loadConfig, saveConfig, pingHealth } from "./bridge.js";

const $ = (id) => document.getElementById(id);

async function init() {
  const cfg = await loadConfig();
  $("url").value = cfg.url || DEFAULT_URL;
  $("token").value = cfg.token || "";

  $("save-btn").addEventListener("click", async () => {
    await saveConfig({ url: $("url").value, token: $("token").value });
    setStatus("Saved.", "ok");
    setTimeout(() => setStatus("", ""), 1500);
  });

  $("test-btn").addEventListener("click", async () => {
    setStatus("Testing…", "");
    const url = ($("url").value || DEFAULT_URL).replace(/\/+$/, "");
    const r = await pingHealth(url);
    if (r.ok) setStatus(`Connected · Media Hub v${r.version}`, "ok");
    else setStatus(`Couldn't reach app: ${r.error}`, "err");
  });
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

init().catch((e) => {
  console.error("options init failed:", e);
  setStatus(String(e?.message || e), "err");
});
