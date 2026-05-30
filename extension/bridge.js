// Media Hub — extension bridge client.
//
// Shared helper used by popup.js + background.js (service worker).
// Wraps:
//   - reading the configured URL + token from chrome.storage.local
//   - POST /enqueue with the bearer header
//   - GET /health for the popup status pill
//   - building a mediahub:// fallback URL for the "app not running"
//     case (tab.open redirect lets the OS launch the app)
//
// No dependencies — runs identically in MV3 service workers (no DOM)
// and in popup pages (DOM available). Everything async, no top-level
// state; the popup re-fetches settings on each open so live edits in
// the options page take effect immediately.

export const DEFAULT_URL = "http://127.0.0.1:47821";

/** Load { url, token } from extension storage. Token may be empty
 *  on first run — the popup prompts the user to open Options. */
export async function loadConfig() {
  const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken"]);
  return {
    url: (stored.bridgeUrl || DEFAULT_URL).replace(/\/+$/, ""),
    token: stored.bridgeToken || "",
  };
}

export async function saveConfig({ url, token }) {
  await chrome.storage.local.set({
    bridgeUrl: (url || DEFAULT_URL).trim(),
    bridgeToken: (token || "").trim(),
  });
}

/** Ping /health. Returns { ok: true, version } on success, or
 *  { ok: false, error } on any failure (network, non-2xx, etc.).
 *  Used by the popup to show a connection indicator. */
export async function pingHealth(url) {
  try {
    const res = await fetch(`${url}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, version: json.version || "?" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** POST a URL into the queue. Returns { ok: true } on 2xx, or
 *  { ok: false, error, status } on anything else. Caller decides
 *  what to do — popup shows toast, background shows a notification. */
export async function enqueue({ url, token, target, audioFormat, projectId, source }) {
  if (!url) return { ok: false, error: "bridge URL not configured" };
  if (!token) return { ok: false, error: "bridge token not configured" };
  if (!target) return { ok: false, error: "no URL to send" };

  const body = {
    url: target,
    source: source || "extension",
  };
  if (audioFormat) body.audio_format = audioFormat;
  if (projectId) body.project_id = projectId;

  try {
    const res = await fetch(`${url}/enqueue`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) detail = j.error;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, error: detail, status: res.status };
  } catch (e) {
    // Most common reason: app not running. The popup catches this
    // and offers the mediahub:// deep-link fallback which the OS
    // resolves even when the app is offline.
    return { ok: false, error: String(e?.message || e), offline: true };
  }
}

/** Build a mediahub:// deep-link URL the OS can launch even when the
 *  app isn't running. Same query-param shape the Rust deep-link
 *  parser expects (lib.rs::parse_deeplink_url). */
export function buildDeepLink({ token, target, audioFormat, projectId }) {
  const params = new URLSearchParams();
  params.set("url", target);
  params.set("token", token || "");
  if (audioFormat) params.set("audio_format", audioFormat);
  if (projectId) params.set("project_id", projectId);
  return `mediahub://enqueue?${params.toString()}`;
}
