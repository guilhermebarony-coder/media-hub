import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Icon } from "../lib/icons";
import { alertDialog, confirmDialog } from "../lib/dialog";
import { HelpHint } from "../components/HelpHint";
import { useSettings } from "../lib/settings";
import { useRtxEnhance } from "../lib/rtxEnhance";
import { useT } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import {
  RENAME_PRESETS,
  TRANSCODE_PRESETS,
  type CookiesSource,
  type SidecarVersion,
  type TranscodePreset,
} from "../lib/types";

/**
 * Settings page — 0.8 shipped, 0.9 polish in flight.
 *
 * Sections:
 *   - Sources     → YouTube cookies + Chrome DPAPI warning ✅
 *   - Library     → root override + rename template + folder picker ✅
 *   - Downloads   → concurrency + bandwidth + sticky format ✅
 *   - Transcode   → default preset ✅
 *   - Diagnostics → tool versions, paths ✅
 *   - About       → version, licenses ✅
 */
export default function SettingsPage() {
  const { ready } = useSettings();
  const t = useT();

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">{t("set.title")}</div>
        <span className="ch-meta">0.8 shipped · 0.9 polish in flight</span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          {ready ? "settings.json live" : "loading…"}
        </span>
      </div>

      <div className="content-body">
        <div className="stack" style={{ maxWidth: 760 }}>
          <SourcesSection />
          <LibrarySection />
          <DownloadsSection />
          <TranscodeSection />
          <RtxSection />
          <BridgeSection />
          <DiagnosticsSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Sources — YouTube cookies (0.8.B)
// =====================================================================

const BROWSERS = ["chrome", "firefox", "edge", "brave", "vivaldi", "opera", "chromium", "safari"] as const;

function SourcesSection() {
  const { settings, save } = useSettings();
  const t = useT();
  const src = settings.cookies_source;

  function setMode(kind: CookiesSource["kind"]) {
    void save((s) => {
      if (kind === "none") return { ...s, cookies_source: { kind: "none" } };
      if (kind === "browser")
        return { ...s, cookies_source: { kind: "browser", browser: BROWSERS[0] } };
      return { ...s, cookies_source: { kind: "file", path: "" } };
    });
  }
  function setBrowser(browser: string) {
    void save((s) => ({ ...s, cookies_source: { kind: "browser", browser } }));
  }
  function setPath(path: string) {
    void save((s) => ({ ...s, cookies_source: { kind: "file", path } }));
  }

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.sources")} <span className="chip">{t("set.chip.cookies")}</span>
        <HelpHint id="set-sources" title="Sources (cookies / login)">
          Some videos only play if you're signed in — age-restricted,
          members-only, that kind of thing. This lets Media Hub borrow your
          browser's login so it can grab those too. You only need it if a
          download complains about signing in or "not a bot".
        </HelpHint>
        <ResetButton
          onClick={() =>
            void save((s) => ({ ...s, cookies_source: { kind: "none" } }))
          }
        />
      </h2>
      <p className="hint">{t("set.src.intro")}</p>

      {/* 1.8.x — master consent switch for the automatic browser-login
          cookie system (extension harvest → cache → use). Off by default;
          this is the always-available on/off control + the "lose faith,
          flip it off" lever. */}
      <div className="bar">
        <span className="settings-label">{t("set.src.browserLogin")}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.cookies_enabled}
            onChange={(e) =>
              void save((s) => ({
                ...s,
                cookies_enabled: e.target.checked,
                cookies_consent_seen: true,
              }))
            }
          />
          <span className="switch-slider" />
        </label>
        <span className="hint-text">
          {settings.cookies_enabled ? t("set.src.loginOn") : t("set.src.loginOff")}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.src.mode")}</span>
        <div className="settings-radio-group">
          {(["none", "browser", "file"] as const).map((m) => (
            <label key={m} className={"settings-radio" + (src.kind === m ? " active" : "")}>
              <input
                type="radio"
                name="cookies-mode"
                value={m}
                checked={src.kind === m}
                onChange={() => setMode(m)}
              />
              <span>
                {m === "none"
                  ? t("set.opt.none")
                  : m === "browser"
                    ? t("set.opt.fromBrowser")
                    : t("set.opt.fromFile")}
              </span>
            </label>
          ))}
        </div>
      </div>

      {src.kind === "browser" && (
        <>
          <div className="settings-row">
            <span className="settings-label">{t("set.src.browser")}</span>
            <select
              className="field-select"
              value={src.browser}
              onChange={(e) => setBrowser(e.target.value)}
            >
              {BROWSERS.map((b) => (
                <option key={b} value={b}>
                  {b[0].toUpperCase() + b.slice(1)}
                </option>
              ))}
            </select>
            <span className="hint-text faint">{t("set.src.closedRule")}</span>
          </div>
          {src.browser !== "firefox" && src.browser !== "safari" && (
            <div className="settings-warn">
              <strong>{t("set.src.warnTitle")}</strong>
              <div>{t("set.src.warnBody1")}</div>
              <div>{t("set.src.warnBody2")}</div>
            </div>
          )}
        </>
      )}

      {src.kind === "file" && (
        <>
          <div className="settings-row">
            <span className="settings-label">{t("set.src.path")}</span>
            <input
              className="field-input"
              type="text"
              placeholder="C:\path\to\cookies.txt"
              value={src.path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  const picked = await openDialog({
                    directory: false,
                    multiple: false,
                    title: "Choose your cookies.txt file",
                    filters: [
                      { name: "cookies.txt", extensions: ["txt"] },
                      { name: "All files", extensions: ["*"] },
                    ],
                  });
                  if (typeof picked === "string") setPath(picked);
                } catch (e) {
                  console.warn("file picker failed:", e);
                }
              }}
            >
              <Icon.folder width={12} height={12} /> {t("set.browse")}
            </button>
            <span className="hint-text faint">{t("set.src.pathHint")}</span>
          </div>
          <CookiesFileStatus path={src.path} />
        </>
      )}

      <div className="settings-divider" />
      <OverridesEditor />
    </section>
  );
}

// =====================================================================
// Per-site cookie overrides (1.4.x)
// =====================================================================
//
// The default cookie source above applies to every site. That's a
// problem when one site NEEDS cookies (Instagram login) and another
// BREAKS with the wrong ones (a logged-in YouTube jar trips "Sign in
// to confirm you're not a bot"). These per-platform rules let the user
// scope a cookie source to a specific site; the backend matches the
// download/fetch URL's host (settings::detect_platform) and uses the
// override instead of the default.

const PLATFORMS = [
  ["youtube", "YouTube"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["twitter", "Twitter / X"],
  ["reddit", "Reddit"],
  ["pinterest", "Pinterest"],
  ["facebook", "Facebook"],
] as const;

function OverridesEditor() {
  const { settings, save } = useSettings();
  const t = useT();
  const overrides = settings.cookies_overrides ?? {};
  const used = new Set(Object.keys(overrides));
  const available = PLATFORMS.filter(([id]) => !used.has(id));
  const active = PLATFORMS.filter(([id]) => used.has(id));

  function setOverride(platform: string, source: CookiesSource) {
    void save((s) => ({
      ...s,
      cookies_overrides: { ...s.cookies_overrides, [platform]: source },
    }));
  }
  function removeOverride(platform: string) {
    void save((s) => {
      const next = { ...s.cookies_overrides };
      delete next[platform];
      return { ...s, cookies_overrides: next };
    });
  }

  return (
    <div className="settings-subsection">
      <div className="settings-row">
        <span className="settings-label">{t("set.src.perSite")}</span>
        <span className="hint-text faint">{t("set.src.perSiteHint")}</span>
      </div>

      {active.length === 0 && (
        <p className="hint faint" style={{ margin: "2px 0 8px" }}>
          {t("set.src.noRules")}
        </p>
      )}

      {active.map(([id, label]) => {
        const ov = overrides[id];
        return (
          <div key={id} className="cookie-override-row">
            <span className="cookie-override-platform">{label}</span>
            <select
              className="field-select"
              value={ov.kind}
              onChange={(e) => {
                const k = e.target.value as CookiesSource["kind"];
                if (k === "none") setOverride(id, { kind: "none" });
                else if (k === "browser")
                  setOverride(id, { kind: "browser", browser: BROWSERS[0] });
                else setOverride(id, { kind: "file", path: "" });
              }}
            >
              <option value="none">{t("set.opt.none")}</option>
              <option value="browser">{t("set.opt.fromBrowser")}</option>
              <option value="file">{t("set.opt.fromFile")}</option>
            </select>

            {ov.kind === "browser" && (
              <select
                className="field-select"
                value={ov.browser}
                onChange={(e) =>
                  setOverride(id, { kind: "browser", browser: e.target.value })
                }
              >
                {BROWSERS.map((b) => (
                  <option key={b} value={b}>
                    {b[0].toUpperCase() + b.slice(1)}
                  </option>
                ))}
              </select>
            )}

            {ov.kind === "file" && (
              <>
                <input
                  className="field-input"
                  type="text"
                  placeholder="C:\path\to\cookies.txt"
                  value={ov.path}
                  onChange={(e) =>
                    setOverride(id, { kind: "file", path: e.target.value })
                  }
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      const picked = await openDialog({
                        directory: false,
                        multiple: false,
                        title: `Choose cookies.txt for ${label}`,
                        filters: [
                          { name: "cookies.txt", extensions: ["txt"] },
                          { name: "All files", extensions: ["*"] },
                        ],
                      });
                      if (typeof picked === "string")
                        setOverride(id, { kind: "file", path: picked });
                    } catch (e) {
                      console.warn("file picker failed:", e);
                    }
                  }}
                >
                  <Icon.folder width={12} height={12} /> {t("set.browse")}
                </button>
              </>
            )}

            <button
              type="button"
              className="btn btn-ghost cookie-override-remove"
              onClick={() => removeOverride(id)}
              title={`Remove ${label} rule`}
            >
              <Icon.x width={13} height={13} />
            </button>
          </div>
        );
      })}

      {available.length > 0 && (
        <div className="cookie-override-add">
          <select
            className="field-select"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              // New rules default to "From browser" — the reason you add
              // a rule is almost always to supply cookies for a site.
              if (id) setOverride(id, { kind: "browser", browser: BROWSERS[0] });
            }}
          >
            <option value="">{t("set.src.addRule")}</option>
            {available.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 1.0.3 — Cookies file validator chip
// =====================================================================
//
// Renders right under the file path input. Re-runs the Rust
// `cookies_validate` command whenever the path changes (300ms debounce
// so typing isn't spammy). Surfaces a red warning when the file is
// missing YouTube auth cookies — the exact failure mode that bit the
// owner on 2026-05-23 where a "logged in to google.com" Firefox
// profile produced a cookies.txt with zero `.youtube.com` auth tokens.
//
// The Rust side returns a structured CookiesFileStatus; we trust its
// `warning` string for display so the messaging stays in one place.

type CookiesFileStatusPayload = {
  exists: boolean;
  total_cookies: number;
  youtube_cookies: number;
  has_youtube_login: boolean;
  warning: string;
};

function CookiesFileStatus({ path }: { path: string }) {
  const t = useT();
  const [status, setStatus] = useState<CookiesFileStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path.trim()) {
      setStatus(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const s = await invoke<CookiesFileStatusPayload>("cookies_validate", {
          path,
        });
        setStatus(s);
      } catch (e) {
        console.warn("[cookies_validate] failed:", e);
        setStatus(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [path]);

  if (!path.trim()) return null;
  if (loading && !status) {
    return (
      <div className="settings-row">
        <span className="settings-label" />
        <span className="hint-text faint">{t("set.src.checking")}</span>
      </div>
    );
  }
  if (!status) return null;

  // Healthy file — show a quiet green confirmation, not the warning style.
  if (status.has_youtube_login) {
    return (
      <div className="settings-row">
        <span className="settings-label" />
        <span className="hint-text" style={{ color: "var(--accent)" }}>
          {t("set.src.fileOk").replace("{n}", String(status.youtube_cookies))}
        </span>
      </div>
    );
  }

  // Unhealthy file — surface the warning prominently using the same
  // visual treatment as the Chromium DPAPI warning above. Same look =
  // same urgency in the user's mental model.
  return (
    <div className="settings-warn">
      <strong>{t("set.src.fileWarnTitle")}</strong>
      <div style={{ marginTop: 4 }}>{status.warning}</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Found: {status.total_cookies} total cookies,{" "}
        {status.youtube_cookies} on youtube.com, 0 auth tokens
        (LOGIN_INFO / __Secure-*PSID).
      </div>
    </div>
  );
}

// =====================================================================
// Library — root override + rename template (0.8.C shipped)
// =====================================================================

// 1.0.5 — shape returned by the Rust library_migrate_root command.
type MigrateResult = {
  old_root: string;
  new_root: string;
  moved_dirs: string[];
  skipped_dirs: string[];
  asset_rows_updated: number;
  warnings: string[];
};

function LibrarySection() {
  const { settings, save } = useSettings();
  const t = useT();
  const root = settings.library_root ?? "";
  const template = settings.rename_template;
  const [migrating, setMigrating] = useState(false);

  // The rename preset dropdown matches the current template value
  // against the built-in patterns. If the user typed something custom
  // we still match on string equality — same value, same preset.
  // Anything else lands in the "custom" pseudo-option.
  const matchedPreset =
    RENAME_PRESETS.find((p) => p.value === template)?.value ?? "__custom__";

  function setRoot(value: string) {
    void save((s) => ({
      ...s,
      library_root: value.trim() === "" ? null : value,
    }));
  }

  function setTemplate(value: string) {
    void save((s) => ({ ...s, rename_template: value }));
  }

  function pickPreset(value: string) {
    // The synthetic "__custom__" entry is only the display option
    // when the current template doesn't match a built-in. Picking
    // it from the dropdown is a no-op; the user has to edit the
    // freeform input to make a real change.
    if (value === "__custom__") return;
    setTemplate(value);
  }

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.library")} <span className="chip">{t("set.chip.library")}</span>
        <ResetButton
          onClick={() =>
            void save((s) => ({
              ...s,
              library_root: null,
              rename_template: "",
            }))
          }
        />
      </h2>
      <p className="hint">{t("set.lib.intro")}</p>

      <div className="settings-row">
        <span className="settings-label">{t("set.lib.root")}</span>
        <input
          className="field-input"
          type="text"
          placeholder="(default) ~/Media Hub"
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            try {
              const picked = await openDialog({
                directory: true,
                multiple: false,
                title: "Choose your library folder",
              });
              if (typeof picked === "string") setRoot(picked);
            } catch (e) {
              console.warn("folder picker failed:", e);
            }
          }}
        >
          <Icon.folder width={12} height={12} /> {t("set.browse")}
        </button>
        <span className="hint-text faint">{t("set.lib.rootHint")}</span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.lib.move")}</span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={migrating}
          onClick={async () => {
            // 1.0.5 — full physical migration: pick destination, confirm,
            // run Rust library_migrate_root, surface result. The Rust
            // side validates everything (refuses cycles, conflicting
            // content, in-flight downloads). We just orchestrate UX.
            let picked: string | string[] | null;
            try {
              picked = await openDialog({
                directory: true,
                multiple: false,
                title: "Pick a destination folder for your library",
              });
            } catch (e) {
              console.warn("folder picker failed:", e);
              return;
            }
            if (typeof picked !== "string") return;

            const ok = await confirmDialog(
              `Move your entire library to:\n\n${picked}\n\n` +
                `This will physically move all downloaded files AND rewrite every ` +
                `database row to point at the new location. The migration is atomic ` +
                `at the database level — if it fails partway, nothing in your ` +
                `library.db gets corrupted.\n\n` +
                `Make sure: (1) no downloads are running, (2) the destination has ` +
                `enough free space, (3) you have a backup if this is your only copy.\n\n` +
                `Continue?`,
              { title: "Move library?", kind: "warning" },
            );
            if (!ok) return;

            setMigrating(true);
            try {
              const result = await invoke<MigrateResult>("library_migrate_root", {
                newRoot: picked,
              });
              const lines = [
                `Migration complete.`,
                ``,
                `Old root: ${result.old_root}`,
                `New root: ${result.new_root}`,
                ``,
                `Moved: ${result.moved_dirs.join(", ") || "(none)"}`,
                result.skipped_dirs.length > 0
                  ? `Skipped (didn't exist): ${result.skipped_dirs.join(", ")}`
                  : "",
                `Database rows updated: ${result.asset_rows_updated}`,
                result.warnings.length > 0
                  ? `\nWarnings:\n- ${result.warnings.join("\n- ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n");
              await alertDialog(lines, {
                title: "Library moved",
                kind: result.warnings.length > 0 ? "warning" : "info",
              });
            } catch (e) {
              await alertDialog(`Migration failed:\n\n${String(e)}`, {
                title: "Couldn't move library",
                kind: "error",
              });
            } finally {
              setMigrating(false);
            }
          }}
        >
          <Icon.folder width={12} height={12} />
          {migrating ? t("set.lib.moving") : t("set.lib.moveBtn")}
        </button>
        <span className="hint-text faint">{t("set.src.lib.moveHint")}</span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.lib.renamePreset")}</span>
        <select
          className="field-select"
          value={matchedPreset}
          onChange={(e) => pickPreset(e.target.value)}
        >
          {RENAME_PRESETS.map((p) => (
            <option key={p.value || "_default_"} value={p.value}>
              {p.label}
            </option>
          ))}
          {matchedPreset === "__custom__" && (
            <option value="__custom__">Custom — see template below</option>
          )}
        </select>
        <span className="hint-text faint">
          {RENAME_PRESETS.find((p) => p.value === matchedPreset)?.hint ??
            "custom pattern below"}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.lib.template")}</span>
        <input
          className="field-input"
          type="text"
          placeholder="{title} [{id}]"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          spellCheck={false}
        />
        <span className="hint-text faint">{t("set.lib.templateHint")}</span>
      </div>
    </section>
  );
}

// =====================================================================
// Downloads — concurrency (B) + bandwidth/format (C scaffolded)
// =====================================================================

function DownloadsSection() {
  const { settings, save } = useSettings();
  const t = useT();
  const concurrency = settings.download_concurrency;
  const limit = settings.bandwidth_limit_kbps;
  const limited = limit != null && limit > 0;
  // Local input mirror so the user can type freely (including blanking
  // the field) without persisting "0" on every keystroke. Pushed to
  // settings on blur or when the checkbox toggles.
  const [limitDraft, setLimitDraft] = useState<string>(limited ? String(limit) : "");

  useEffect(() => {
    setLimitDraft(limited ? String(limit) : "");
  }, [limit, limited]);

  // 1.10.0 — aria2c external downloader. The binary is lazy-downloaded
  // on first enable, so the toggle has a "fetching…" state and can fail
  // (no internet, unsupported OS) — in which case we revert it.
  const [aria2Busy, setAria2Busy] = useState(false);
  const [aria2Installed, setAria2Installed] = useState<boolean | null>(null);
  useEffect(() => {
    invoke<boolean>("aria2_status")
      .then(setAria2Installed)
      .catch(() => setAria2Installed(false));
  }, []);

  async function toggleAria2(on: boolean) {
    if (!on) {
      void save((s) => ({ ...s, use_aria2c: false }));
      return;
    }
    // Turning on: make sure the binary is present first.
    if (aria2Installed) {
      void save((s) => ({ ...s, use_aria2c: true }));
      return;
    }
    setAria2Busy(true);
    try {
      await invoke<string>("aria2_ensure");
      setAria2Installed(true);
      void save((s) => ({ ...s, use_aria2c: true }));
    } catch (e) {
      // Leave the toggle off and explain — never a blocker.
      await alertDialog(
        `Couldn't set up the faster downloader:\n\n${String(e)}\n\n` +
          `Downloads will keep using the built-in engine.`,
        { title: "aria2c unavailable", kind: "warning" },
      );
    } finally {
      setAria2Busy(false);
    }
  }

  function setConcurrency(n: number) {
    const clamped = Math.max(1, Math.min(6, Math.round(n)));
    void save((s) => ({ ...s, download_concurrency: clamped }));
  }

  function commitLimit(raw: string) {
    const n = Math.max(0, Math.floor(Number(raw)));
    void save((s) => ({
      ...s,
      bandwidth_limit_kbps: Number.isFinite(n) && n > 0 ? n : null,
    }));
  }

  function toggleLimit(on: boolean) {
    if (on) {
      // Bring back the last-typed value (or default to 5000 KiB/s
      // which is "fast home connection minus headroom").
      const fallback = Number(limitDraft) > 0 ? Number(limitDraft) : 5000;
      setLimitDraft(String(fallback));
      void save((s) => ({ ...s, bandwidth_limit_kbps: fallback }));
    } else {
      void save((s) => ({ ...s, bandwidth_limit_kbps: null }));
    }
  }

  // Per-platform format memory display (read-only — we clear them via
  // a "Forget" link to keep this card decision-light). The Hash of
  // remembered platforms is small (1-2 entries today).
  const stickyEntries = Object.entries(settings.last_formats ?? {});

  // Preview cache size + path readout (refreshed after clear).
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; path: string } | null>(
    null,
  );
  function refreshCacheInfo() {
    invoke<{ bytes: number; path: string }>("preview_cache_info")
      .then(setCacheInfo)
      .catch(() => setCacheInfo(null));
  }
  useEffect(() => {
    refreshCacheInfo();
  }, []);

  async function clearPreviewCache() {
    try {
      const freed = await invoke<number>("preview_cache_clear");
      refreshCacheInfo();
      await alertDialog(
        `Removed ${(freed / 1048576).toFixed(0)} MB of cached preview proxies.`,
        { title: "Preview cache cleared", kind: "info" },
      );
    } catch (e) {
      await alertDialog(`Couldn't clear preview cache: ${String(e)}`, {
        title: "Preview cache",
        kind: "error",
      });
    }
  }

  function clearSticky(platform?: string) {
    void save((s) => {
      const next = { ...(s.last_formats ?? {}) };
      if (platform) delete next[platform];
      else for (const k of Object.keys(next)) delete next[k];
      return { ...s, last_formats: next };
    });
  }

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.downloads")} <span className="chip">{t("set.chip.downloads")}</span>
        <HelpHint id="set-downloads" title="Downloads (speed)">
          Controls how fast things download. "Workers" is how many videos
          download at the same time. "Speed limit" slows downloads so they
          don't hog your whole internet. "Fast downloads" is a turbo mode for
          big files. If you're not sure, the defaults are fine.
        </HelpHint>
        <ResetButton
          onClick={() =>
            void save((s) => ({
              ...s,
              download_concurrency: 3,
              preferred_max_quality: "1080",
              bandwidth_limit_kbps: null,
              last_formats: {},
              jog_sensitivity: 1.0,
            }))
          }
        />
      </h2>
      <p className="hint">{t("set.dl.intro")}</p>

      <div className="settings-row">
        <span className="settings-label">{t("set.dl.workers")}</span>
        <input
          type="number"
          className="field-input"
          style={{ width: 80, flex: "0 0 80px" }}
          min={1}
          max={6}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
        />
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span className="hint-text faint">{t("set.dl.workersHint")}</span>
      </div>

      {/* 1.3.x — Preferred max video quality. Applies to queue jobs
          and extension/bridge sends — anywhere a download happens
          WITHOUT an explicit format pick on the Download page. */}
      <div className="settings-row">
        <span className="settings-label">{t("set.dl.quality")}</span>
        <select
          className="field-input"
          style={{ width: 130, flex: "0 0 130px" }}
          value={settings.preferred_max_quality}
          onChange={(e) =>
            void save((s) => ({ ...s, preferred_max_quality: e.target.value }))
          }
        >
          <option value="2160">2160p (4K)</option>
          <option value="1440">1440p (QHD)</option>
          <option value="1080">1080p (FHD)</option>
          <option value="720">720p (HD)</option>
          <option value="480">480p (SD)</option>
          <option value="">{t("set.dl.qualitySource")}</option>
        </select>
        <span className="hint-text faint">
          {t("set.dl.qualityHint")}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.dl.bandwidth")}</span>
        <label className="settings-radio" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={limited}
            onChange={(e) => toggleLimit(e.target.checked)}
          />
          <span>{t("set.dl.throttle")}</span>
        </label>
        <input
          type="number"
          className="field-input"
          style={{ width: 110, flex: "0 0 110px" }}
          min={0}
          step={100}
          placeholder="KiB/s"
          value={limitDraft}
          disabled={!limited}
          onChange={(e) => setLimitDraft(e.target.value)}
          onBlur={(e) => commitLimit(e.target.value)}
        />
        <span className="hint-text faint">{t("set.dl.bandwidthHint")}</span>
      </div>

      {/* 1.10.0 — aria2c external downloader. Opt-in; the binary is
          fetched on first enable. Off by default. */}
      <div className="settings-row">
        <span className="settings-label">{t("set.dl.fast")}</span>
        <label className="switch" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={settings.use_aria2c}
            disabled={aria2Busy}
            onChange={(e) => void toggleAria2(e.target.checked)}
          />
          <span className="switch-slider" />
        </label>
        <span className="hint-text faint">
          {aria2Busy
            ? t("set.dl.fastFetching")
            : settings.use_aria2c
              ? t("set.dl.fastOn")
              : t("set.dl.fastOff")}
        </span>
      </div>

      {/* EXPERIMENT (exp/preview-proxy) — scrubber preview quality +
          cache control. */}
      <div className="settings-row">
        <span className="settings-label">{t("set.dl.preview")}</span>
        <select
          className="field-input"
          style={{ width: 160, flex: "0 0 160px" }}
          value={settings.preview_quality}
          onChange={(e) =>
            void save((s) => ({ ...s, preview_quality: e.target.value }))
          }
        >
          <option value="auto">{t("set.dl.previewAuto")}</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="360">360p</option>
          <option value="off">{t("set.dl.previewStreaming")}</option>
        </select>
        <span className="mono faint" style={{ flex: "0 0 auto", fontSize: 11 }}>
          {cacheInfo ? `${(cacheInfo.bytes / 1048576).toFixed(0)} MB` : "—"}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ flex: "0 0 auto" }}
          onClick={() => void clearPreviewCache()}
        >
          {t("set.dl.clearCache")}
        </button>
        {cacheInfo && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flex: "0 0 auto" }}
            title={cacheInfo.path}
            onClick={() => void openPath(cacheInfo.path).catch(() => {})}
          >
            {t("set.dl.openFolder")}
          </button>
        )}
        <span className="hint-text faint">{t("set.dl.previewHint")}</span>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.dl.sticky")}</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {stickyEntries.length === 0 ? (
            <span className="faint mono" style={{ fontSize: 11 }}>
              {t("set.dl.stickyNone")}
            </span>
          ) : (
            stickyEntries.map(([platform, fmt]) => (
              <div
                key={platform}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <code style={{ flex: 1 }}>
                  {platform} → format <strong>{fmt}</strong>
                </code>
                <button
                  className="btn btn-secondary"
                  onClick={() => clearSticky(platform)}
                  style={{ fontSize: 10, padding: "2px 8px" }}
                >
                  {t("set.dl.forget")}
                </button>
              </div>
            ))
          )}
        </div>
        {stickyEntries.length > 1 && (
          <button
            className="btn btn-secondary"
            onClick={() => clearSticky()}
            style={{ flex: "0 0 auto" }}
          >
            {t("set.dl.forgetAll")}
          </button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("set.dl.jog")}</span>
        {/* Continuous slider (0.9.D, requested 2026-05-22 PM).
         *  Range 0.25× → 2.5× in 0.25 steps. The user can pick
         *  any granularity they like instead of 3 fixed presets. */}
        <input
          type="range"
          min={0.25}
          max={2.5}
          step={0.25}
          value={settings.jog_sensitivity}
          onChange={(e) => {
            const v = Number(e.target.value);
            console.debug("[settings] jog_sensitivity →", v);
            save((s) => ({ ...s, jog_sensitivity: v })).catch((err) =>
              console.warn("[settings] jog save failed:", err),
            );
          }}
          style={{ flex: 1 }}
        />
        <span
          className="mono"
          style={{
            flex: "0 0 auto",
            minWidth: 48,
            textAlign: "center",
            color: "var(--accent)",
            fontSize: 12,
          }}
        >
          {settings.jog_sensitivity.toFixed(2)}×
        </span>
        <span className="hint-text faint">{t("set.dl.jogHint")}</span>
      </div>
    </section>
  );
}

// =====================================================================
// Transcode default (B)
// =====================================================================

function TranscodeSection() {
  const { settings, save } = useSettings();
  const t = useT();
  const preset = settings.default_transcode_preset as TranscodePreset;

  function setPreset(p: TranscodePreset) {
    void save((s) => ({ ...s, default_transcode_preset: p }));
  }

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.transcode")} <span className="chip">{t("set.chip.transcode")}</span>
        <HelpHint id="set-transcode" title="Transcode (convert)">
          Transcoding converts a video into a format editing apps handle more
          smoothly. Keep this on "None" unless your editor struggles with the
          downloaded file — converting makes the files much bigger and takes
          extra time, so it's off by default.
        </HelpHint>
        <ResetButton
          onClick={() =>
            void save((s) => ({ ...s, default_transcode_preset: "none" }))
          }
        />
      </h2>
      <p className="hint">{t("set.tr.intro")}</p>

      <div className="settings-row">
        <span className="settings-label">{t("set.tr.default")}</span>
        <select
          className="field-select"
          value={preset}
          onChange={(e) => setPreset(e.target.value as TranscodePreset)}
        >
          {TRANSCODE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(`preset.${p.value}`)}
            </option>
          ))}
        </select>
        <span className="hint-text faint">{t(`preset.${preset}.hint`)}</span>
      </div>
    </section>
  );
}

// =====================================================================
// RTX Video enhance (Phase 2) — optional NVIDIA upscale / decompress
// =====================================================================
//
// Reads/writes the same context-backed defaults the enhance window uses
// (localStorage: mh.rtx.quality / mh.rtx.scale / mh.rtx.hdr), so this page
// and the window stay in lockstep. These defaults are what a right-click →
// "Upscale (NVIDIA RTX Video)" uses. The whole section hides on machines
// without a capable RTX GPU (nothing to configure there).

function RtxSection() {
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerErr, setWorkerErr] = useState<string | null>(null);
  const {
    capability,
    workerReady,
    workerOutdated,
    ensureWorker,
    defaultQuality,
    setDefaultQuality,
    defaultScale,
    setDefaultScale,
    defaultCc,
    setDefaultCc,
    defaultCcStrength,
    setDefaultCcStrength,
    defaultEncPreset,
    setDefaultEncPreset,
    defaultHdr,
    setDefaultHdr,
    openWindow,
  } = useRtxEnhance();

  // Still probing — render nothing rather than flicker a disabled card.
  if (capability === null) return null;
  // No capable GPU → nothing to configure; keep Settings uncluttered.
  if (!capability.supported) return null;

  return (
    <section className="card-box">
      <h2>
        RTX Video <span className="chip">enhance</span>
        <HelpHint id="set-rtx" title="RTX Video (NVIDIA upscale)">
          Uses your NVIDIA RTX GPU to clean up compression and (optionally)
          double a clip's resolution. Pick a quality and whether to upscale or
          just decompress; those choices become the default for right-click →
          Upscale. Only clips under 1440p can be enhanced.
        </HelpHint>
      </h2>
      <p className="hint">
        Right-click a clip → “Upscale (NVIDIA RTX Video)”, or open the review
        window to drop clips in and compare before/after. These are the
        defaults applied to new jobs.
      </p>

      <div className="settings-row">
        <span className="settings-label">Quality</span>
        <select
          className="field-select"
          value={defaultQuality}
          onChange={(e) => setDefaultQuality(Number(e.target.value))}
        >
          <option value={4}>Ultra (best)</option>
          <option value={3}>High</option>
          <option value={2}>Medium</option>
          <option value={1}>Low (fastest)</option>
        </select>
        <span className="hint-text faint">Higher = cleaner, a little slower.</span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Scale</span>
        <select
          className="field-select"
          value={defaultScale}
          onChange={(e) => setDefaultScale(Number(e.target.value))}
        >
          <option value={4}>4× upscale</option>
          <option value={2}>2× upscale</option>
          <option value={1}>Decompress only (1×)</option>
        </select>
        <span className="hint-text faint">
          {defaultScale <= 1
            ? "Cleans compression, keeps the original resolution."
            : defaultScale >= 4
              ? "Quadruples resolution (best for small/SD clips) and cleans compression."
              : "Doubles resolution and cleans compression."}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Compression filter</span>
        <label className="switch" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={defaultCc}
            onChange={(e) => setDefaultCc(e.target.checked)}
          />
          <span className="switch-slider" />
        </label>
        <span className="hint-text faint">
          Removes compression artifacts before upscaling. Costs ~30% more time.
        </span>
      </div>

      {defaultCc && (
        <div className="settings-row">
          <span className="settings-label">Filter strength</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={defaultCcStrength}
            onChange={(e) => setDefaultCcStrength(Number(e.target.value))}
            style={{ flex: "0 0 auto", width: 160 }}
          />
          <span className="hint-text faint">
            {Math.round(defaultCcStrength * 100)}% —{" "}
            {defaultCcStrength >= 0.999
              ? "the tuned dose."
              : defaultCcStrength <= 0.001
                ? "no change at all (exact bypass)."
                : "lighter than tuned."}
          </span>
        </div>
      )}

      <div className="settings-row">
        <span className="settings-label">Output</span>
        <select
          className="field-select"
          value={defaultEncPreset}
          onChange={(e) => setDefaultEncPreset(e.target.value)}
        >
          <option value="lossless">Lossless</option>
          <option value="master">Master</option>
          <option value="entrega">Delivery</option>
          <option value="previa">Preview</option>
        </select>
        <span className="hint-text faint">
          {defaultEncPreset === "lossless"
            ? "Enormous files (~2 GB/min). For judging quality, not for keeping."
            : defaultEncPreset === "master"
              ? "Near-lossless, large. For finishing."
              : defaultEncPreset === "previa"
                ? "Small and soft. For checking a cut."
                : "The balanced default. Encode time is the same either way — only size changes."}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">SDR → HDR</span>
        <label className="switch" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={defaultHdr}
            onChange={(e) => setDefaultHdr(e.target.checked)}
          />
          <span className="switch-slider" />
        </label>
        <span className="hint-text faint">
          Expand SDR footage to HDR (TrueHDR). Leave off for normal clips.
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Review window</span>
        <button className="btn btn-secondary" onClick={() => openWindow()}>
          <Icon.video width={12} height={12} /> Open enhance window
        </button>
        <span className="hint-text faint">
          Drop clips in, compare before/after, manage the queue.
        </span>
      </div>

      <dl className="settings-kv">
        <div>
          <dt>GPU</dt>
          <dd>{capability.gpu_name || "—"}</dd>
        </div>
        <div>
          <dt>Driver</dt>
          <dd>{capability.driver_version || "—"}</dd>
        </div>
        <div>
          <dt>Enhancer</dt>
          {/* 1.14.0 — three states, not two. An enhancer installed before
              the CodecClean build accepts the filter and ignores it, so
              "installed" alone was a misleading green light. */}
          <dd className={workerReady && !workerOutdated ? "" : "err"}>
            {!workerReady
              ? "not installed yet"
              : workerOutdated
                ? "update available"
                : "installed"}
            {(!workerReady || workerOutdated) && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: 8 }}
                disabled={workerBusy}
                onClick={() => {
                  setWorkerBusy(true);
                  setWorkerErr(null);
                  void ensureWorker()
                    .catch((e) => setWorkerErr(String(e)))
                    .finally(() => setWorkerBusy(false));
                }}
              >
                {workerBusy ? "installing…" : workerReady ? "Update" : "Install"}
              </button>
            )}
            {workerErr && <div className="hint-text err">{workerErr}</div>}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// =====================================================================
// Bridge (1.2.2)
// =====================================================================
//
// Surfaces the localhost HTTP bridge: shows the token + port so the
// user can paste them into the browser-extension settings, plus an
// enable/disable toggle and a regenerate-token button. All changes
// require an app restart to take effect (the server is spawned once
// at startup with a snapshot of these values).

function BridgeSection() {
  const { settings, save } = useSettings();
  const t = useT();
  const [copied, setCopied] = useState<"" | "token" | "port" | "url">("");

  async function copy(kind: "token" | "port" | "url", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      /* user can still select+copy manually */
    }
  }

  async function regenerate() {
    const ok = await confirmDialog(
      "Generate a new bridge token?\n\nThe previously paired browser extension will stop working until you paste the new token into its settings.",
      { title: "Regenerate bridge token?", kind: "warning" },
    );
    if (!ok) return;
    // 64 hex chars to match the Rust generator. We do it client-side
    // here for the instant-feedback feel; the value gets persisted
    // through normal settings save.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await save((s) => ({ ...s, bridge_token: token }));
    await alertDialog(
      "New token saved. Restart Media Hub for the bridge server to pick it up.",
      { title: "Restart required", kind: "info" },
    );
  }

  const enabled = settings.bridge_enabled;
  const token = settings.bridge_token;
  const port = settings.bridge_port;
  const url = `http://127.0.0.1:${port}`;

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.bridge")} <span className="chip">{t("set.chip.bridge")}</span>
        <HelpHint id="set-bridge" title="Browser bridge (extension)">
          This connects the Media Hub browser add-on so a button in your web
          browser can send videos straight to the app. You pair them once
          using the code here. If you don't use the browser add-on, you can
          ignore this whole section.
        </HelpHint>
      </h2>
      <p className="hint">{t("set.br.intro")}</p>

      <div className="bar">
        <span className="settings-label">{t("set.br.enabled")}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              void save((s) => ({ ...s, bridge_enabled: e.target.checked }))
            }
          />
          <span className="switch-slider" />
        </label>
        <span className="hint-text">
          {enabled ? t("set.br.enabledOn") : t("set.br.enabledOff")}
        </span>
      </div>

      <div className="bar">
        <span className="settings-label">URL</span>
        <code className="settings-mono settings-grow">{url}</code>
        <button
          className="btn btn-secondary"
          onClick={() => void copy("url", url)}
          title="Copy URL"
        >
          {copied === "url" ? t("set.br.copied") : t("set.br.copy")}
        </button>
      </div>

      <div className="bar">
        <span className="settings-label">{t("set.br.port")}</span>
        <input
          type="number"
          className="field-input"
          style={{ width: 100 }}
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isFinite(n) || n < 1024 || n > 65535) return;
            void save((s) => ({ ...s, bridge_port: n }));
          }}
        />
        <span className="hint-text">{t("set.br.portHint")}</span>
      </div>

      <div className="bar">
        <span className="settings-label">{t("set.br.token")}</span>
        <code
          className="settings-mono settings-grow"
          style={{ fontSize: 11, wordBreak: "break-all" }}
        >
          {token || "(no token yet — restart the app to generate one)"}
        </code>
        <button
          className="btn btn-secondary"
          onClick={() => void copy("token", token)}
          disabled={!token}
          title="Copy token"
        >
          {copied === "token" ? t("set.br.copied") : t("set.br.copy")}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => void regenerate()}
          title="Generate a new token (invalidates the current pairing)"
        >
          {t("set.br.regenerate")}
        </button>
      </div>

      <details className="settings-details">
        <summary>Test it from a terminal</summary>

        <p className="hint" style={{ fontSize: 11, margin: "8px 0 4px" }}>
          <strong>PowerShell</strong> (Windows — use <code>curl.exe</code> not{" "}
          <code>curl</code>; the bare alias maps to Invoke-WebRequest with
          incompatible flags):
        </p>
        <pre className="settings-pre">
          {`curl.exe -X POST ${url}/enqueue -H "Authorization: Bearer ${token || "<TOKEN>"}" -H "Content-Type: application/json" -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}'`}
        </pre>

        <p className="hint" style={{ fontSize: 11, margin: "8px 0 4px" }}>
          <strong>PowerShell native</strong> (no curl needed):
        </p>
        <pre className="settings-pre">
          {`Invoke-RestMethod -Uri ${url}/enqueue -Method POST \`
  -Headers @{Authorization="Bearer ${token || "<TOKEN>"}"} \`
  -ContentType "application/json" \`
  -Body '{"url":"https://youtu.be/dQw4w9WgXcQ"}'`}
        </pre>

        <p className="hint" style={{ fontSize: 11, margin: "8px 0 4px" }}>
          <strong>bash / zsh</strong> (macOS / Linux / Git Bash):
        </p>
        <pre className="settings-pre">
          {`curl -X POST ${url}/enqueue \\
  -H "Authorization: Bearer ${token || "<TOKEN>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}'`}
        </pre>

        <p className="hint" style={{ fontSize: 11 }}>
          Add <code>"audio_format": "mp3"</code> to download as audio.
          Add <code>"project_id": "&lt;id&gt;"</code> to route to a specific
          project.
        </p>

        <p className="hint" style={{ fontSize: 11, margin: "12px 0 4px" }}>
          <strong>Deep link</strong> (works even when the app isn't running
          — the OS will launch Media Hub):
        </p>
        <pre className="settings-pre">
          {`mediahub://enqueue?url=${encodeURIComponent("https://youtu.be/dQw4w9WgXcQ")}&token=${token || "<TOKEN>"}`}
        </pre>
        <p className="hint" style={{ fontSize: 11 }}>
          Paste that into your browser's address bar (or click an{" "}
          <code>&lt;a&gt;</code> tag with that href). Same token + same
          query-param shape as the POST endpoint.
        </p>
      </details>
    </section>
  );
}

// =====================================================================
// Diagnostics (B)
// =====================================================================

interface EngineInfo {
  version: string | null;
  managed: boolean;
}

function DiagnosticsSection() {
  const t = useT();
  const [versions, setVersions] = useState<SidecarVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  // 1.3.0 — app auto-updater (distinct from the yt-dlp engine updater
  // above). Checks GitHub Releases for a signed installer, downloads +
  // installs + relaunches. See updater.rs for the backend wiring.
  const [appUpdating, setAppUpdating] = useState(false);
  const [appUpdateMsg, setAppUpdateMsg] = useState<string | null>(null);

  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const out = await invoke<SidecarVersion[]>("binaries_version");
      setVersions(out);
      setEngine(await invoke<EngineInfo>("yt_dlp_engine_info"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // 1.12.0 — re-download ffmpeg/deno if they're missing or broken. Safe to
  // run anytime (idempotent); mostly a recovery path if first-run setup
  // failed or a file got deleted.
  async function repairTools() {
    setRepairing(true);
    setRepairMsg(t("set.diag.toolsDownloading"));
    try {
      await invoke("tools_ensure");
      setRepairMsg(t("set.diag.toolsReady"));
      await refresh();
    } catch (e) {
      setRepairMsg(`Setup failed: ${String(e)}`);
    } finally {
      setRepairing(false);
    }
  }

  // Check + (optionally) install an app update from GitHub Releases.
  // One button does both: first click checks; if there's an update,
  // second click downloads + verifies + installs (app relaunches).
  async function checkAndInstallAppUpdate() {
    if (appUpdating) return;
    setAppUpdating(true);
    setAppUpdateMsg("Checking…");
    try {
      const status = await invoke<{
        available: boolean;
        remote_version: string;
        current_version: string;
        notes: string | null;
      }>("check_for_app_update");
      if (!status.available) {
        setAppUpdateMsg(`Up to date (${status.current_version})`);
      } else {
        setAppUpdateMsg(
          `Installing ${status.current_version} → ${status.remote_version}…`,
        );
        const installed = await invoke<string>("install_app_update");
        setAppUpdateMsg(`Installed ${installed} — relaunching…`);
      }
    } catch (e) {
      setAppUpdateMsg(`Update failed: ${String(e)}`);
    } finally {
      setAppUpdating(false);
    }
  }

  // Manual "update now" — bypasses the silent 24h throttle. The app
  // already auto-updates the yt-dlp engine on launch; this is for when a
  // site breaks mid-session and the user wants the freshest build now.
  async function updateEngine() {
    setUpdating(true);
    setUpdateMsg(null);
    try {
      setUpdateMsg(await invoke<string>("yt_dlp_update_now"));
      await refresh();
    } catch (e) {
      setUpdateMsg(`Update failed: ${String(e)}`);
    } finally {
      setUpdating(false);
    }
  }

  // 1.11.3 — diagnostics log. On a failure (esp. transcode) the app now
  // writes the full ffmpeg command, full stderr, and the input's real
  // streams to a log file. This opens the folder so a tester can grab it.
  const [logMsg, setLogMsg] = useState<string | null>(null);
  async function openLogs() {
    try {
      await invoke("diag_snapshot"); // freshen the version header first
      await invoke("diag_open_logs");
      setLogMsg(null);
    } catch (e) {
      setLogMsg(`Couldn't open logs: ${String(e)}`);
    }
  }

  // Auto-load on mount — diagnostics are read-only and useful at a
  // glance. User can re-check via the button if they update sidecars.
  useEffect(() => {
    void refresh();
  }, []);

  // Library DB path is the canonical "~/Media Hub/library.db" — we
  // could expose a real resolver via a Rust command but hardcoding
  // matches what the user sees on disk, which is the point of a
  // diagnostics field.
  const libraryDir = "~/Media Hub";
  const thumbsDir = "~/Media Hub/_thumbnails";

  return (
    <section className="card-box">
      <h2>
        {t("set.sec.diag")} <span className="chip">{t("set.chip.diag")}</span>
      </h2>
      <p className="hint">{t("set.diag.intro")}</p>

      <div className="settings-row">
        <span className="settings-label">{t("set.diag.tools")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => void repairTools()}
            disabled={repairing}
            title="Re-download ffmpeg + deno if they're missing or broken"
          >
            {repairing ? t("set.diag.repairing") : t("set.diag.repair")}
          </button>
          <button className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? t("set.diag.checking") : t("set.diag.recheck")}
          </button>
        </div>
      </div>
      {repairMsg && (
        <div className="msg-row">
          <span className="label">tools</span>
          <code>{repairMsg}</code>
        </div>
      )}

      <div className="settings-row">
        <span className="settings-label">
          {t("set.diag.engine")}
          {engine && (
            <span className="chip" style={{ marginLeft: 8 }}>
              {engine.managed ? "auto-updated" : "bundled"}
            </span>
          )}
        </span>
        <button className="btn btn-secondary" onClick={() => void updateEngine()} disabled={updating}>
          {updating ? t("set.diag.updating") : t("set.diag.updateEngine")}
        </button>
      </div>
      <p className="hint">{t("set.diag.engineHint")}</p>
      {updateMsg && (
        <div className="msg-row">
          <span className="label">engine</span>
          <code>{updateMsg}</code>
        </div>
      )}

      {/* 1.3.0 — app auto-updater. Single button: checks the GitHub
          Releases manifest, and if there's a newer signed build,
          downloads + verifies + installs (the installer relaunches the
          app on success). */}
      <div className="settings-row">
        <span className="settings-label">{t("set.diag.app")}</span>
        <button
          className="btn btn-secondary"
          onClick={() => void checkAndInstallAppUpdate()}
          disabled={appUpdating}
        >
          {appUpdating ? t("set.diag.working") : t("set.diag.checkUpdates")}
        </button>
      </div>
      <p className="hint">{t("set.diag.appHint")}</p>
      {appUpdateMsg && (
        <div className="msg-row">
          <span className="label">app</span>
          <code>{appUpdateMsg}</code>
        </div>
      )}

      {err && (
        <div className="msg-row err">
          <span className="label">error</span>
          <code>{err}</code>
        </div>
      )}

      {versions && (
        <dl className="settings-kv">
          {versions.map((v) => (
            <div key={v.name}>
              <dt>{v.name}</dt>
              <dd className={v.ok ? "" : "err"}>{v.ok ? v.version : v.error ?? "fail"}</dd>
            </div>
          ))}
        </dl>
      )}

      <dl className="settings-kv">
        <div>
          <dt>{t("set.diag.dtLibrary")}</dt>
          <dd>{libraryDir}</dd>
        </div>
        <div>
          <dt>{t("set.diag.dtThumbnails")}</dt>
          <dd>{thumbsDir}</dd>
        </div>
        <div>
          <dt>{t("set.diag.dtSettings")}</dt>
          <dd>%APPDATA%\com.guilherme.mediahub\settings.json</dd>
        </div>
      </dl>

      {/* 1.11.3 — diagnostics log. Every download/transcode failure now
          records the full command + ffmpeg stderr + the input's actual
          streams here, so bug reports are self-contained. */}
      <div className="settings-row">
        <span className="settings-label">{t("set.diag.log")}</span>
        <button className="btn btn-secondary" onClick={() => void openLogs()}>
          {t("set.diag.openLogs")}
        </button>
      </div>
      <p className="hint">{t("set.diag.logHint")}</p>
      {logMsg && (
        <div className="msg-row err">
          <span className="label">logs</span>
          <code>{logMsg}</code>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// About (B)
// =====================================================================

function AboutSection() {
  const t = useT();
  return (
    <section className="card-box">
      <h2>
        {t("set.sec.about")} <span className="chip">media-hub</span>
      </h2>
      <p className="hint">{t("set.about.intro")}</p>

      <dl className="settings-kv">
        <div>
          <dt>{t("set.about.version")}</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        <div>
          <dt>{t("set.about.identifier")}</dt>
          <dd>com.guilherme.mediahub</dd>
        </div>
        <div>
          <dt>yt-dlp</dt>
          <dd>
            <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">
              github.com/yt-dlp/yt-dlp
            </a>{" "}
            · The Unlicense
          </dd>
        </div>
        <div>
          <dt>ffmpeg</dt>
          <dd>
            <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer">
              ffmpeg.org
            </a>{" "}
            · LGPL / GPL components
          </dd>
        </div>
      </dl>
    </section>
  );
}

// =====================================================================
// Reset button — small per-section "back to defaults" affordance (0.9 UX win #10)
// =====================================================================

/**
 * Sits in the section header next to the chip. Click → confirm →
 * reset that section's fields via the save callback the parent
 * provides. Intentionally minimal styling so it doesn't distract;
 * the user has to be looking for it.
 *
 * Why per-section instead of "reset all":
 *   - Per-section is safer (user only loses one slice of state at a
 *     time)
 *   - Per-section is more discoverable (sits inline with what it
 *     resets, no separate dialog)
 *   - A user can still effectively "reset all" by clicking each
 *     section's button — same number of confirms, no nuke option
 *     that wipes settings.json
 */
function ResetButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="settings-reset"
      onClick={async () => {
        const ok = await confirmDialog(t("set.reset.confirm"), {
          title: t("set.reset.title"),
          kind: "warning",
        });
        if (ok) onClick();
      }}
      title={t("set.reset.confirm")}
    >
      {t("set.reset.label")}
    </button>
  );
}
