import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../lib/icons";
import { alertDialog, confirmDialog } from "../lib/dialog";
import { useSettings } from "../lib/settings";
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

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Settings</div>
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
        Sources <span className="chip">browser cookies</span>
        <ResetButton
          onClick={() =>
            void save((s) => ({ ...s, cookies_source: { kind: "none" } }))
          }
        />
      </h2>
      <p className="hint">
        Some videos require sign-in — age-restricted YouTube, private
        Twitter/X posts, members-only content on any platform. Point
        at a browser you're signed in to and yt-dlp will pull the
        cookies for you. Public videos work without any of this —
        leave at <strong>None</strong> if you don't hit the wall.
      </p>

      <div className="settings-row">
        <span className="settings-label">Mode</span>
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
              <span>{m === "none" ? "None" : m === "browser" ? "From browser" : "From file"}</span>
            </label>
          ))}
        </div>
      </div>

      {src.kind === "browser" && (
        <>
          <div className="settings-row">
            <span className="settings-label">Browser</span>
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
            <span className="hint-text faint">
              Closed-browser rule applies on Windows — Chromium locks
              the cookie SQLite while running.
            </span>
          </div>
          {src.browser !== "firefox" && src.browser !== "safari" && (
            <div className="settings-warn">
              <strong>⚠ Chromium browsers are currently broken</strong>
              <div>
                As of Chrome 127+ (Aug 2024), yt-dlp can't decrypt
                cookies from Chrome / Brave / Edge / Vivaldi / Opera
                due to Google's "App-Bound Encryption" change
                (yt-dlp issue #10927). You'll get a{" "}
                <code>Failed to decrypt with DPAPI</code> error even
                with the browser closed.
              </div>
              <div>
                <strong>Working alternatives:</strong> switch to{" "}
                <strong>Firefox</strong> above, or use the{" "}
                <strong>cookies.txt file mode</strong> instead.
              </div>
            </div>
          )}
        </>
      )}

      {src.kind === "file" && (
        <>
          <div className="settings-row">
            <span className="settings-label">Path</span>
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
              <Icon.folder width={12} height={12} /> Browse…
            </button>
            <span className="hint-text faint">
              Netscape-format cookies.txt. Tip: avoid paths with
              non-ASCII characters (e.g. "Área de Trabalho") — they
              can break yt-dlp file access. Try{" "}
              <code>C:\cookies.txt</code> as a test.
            </span>
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
        <span className="settings-label">Per-site rules</span>
        <span className="hint-text faint">
          Override the default for specific platforms. Typical setup:
          default <strong>None</strong>, then add{" "}
          <strong>Instagram → From browser</strong> — Instagram uses
          your login, YouTube stays cookie-free (logged-in cookies often
          break YouTube). The right cookies go to the right site
          automatically, based on the URL.
        </span>
      </div>

      {active.length === 0 && (
        <p className="hint faint" style={{ margin: "2px 0 8px" }}>
          No per-site rules yet — every site uses the default above.
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
              <option value="none">None</option>
              <option value="browser">From browser</option>
              <option value="file">From file</option>
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
                  <Icon.folder width={12} height={12} /> Browse…
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
            <option value="">+ Add site rule…</option>
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
        <span className="hint-text faint">Checking file…</span>
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
          ✓ {status.youtube_cookies} youtube.com cookies, auth token detected.
          Should work for age-restricted videos.
        </span>
      </div>
    );
  }

  // Unhealthy file — surface the warning prominently using the same
  // visual treatment as the Chromium DPAPI warning above. Same look =
  // same urgency in the user's mental model.
  return (
    <div className="settings-warn">
      <strong>⚠ This cookies file is missing YouTube login</strong>
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
        Library <span className="chip">root + rename</span>
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
      <p className="hint">
        Override where Media Hub stores downloads. Pick a rename
        pattern (or write your own) for how files land on disk.
        Editing the path here only redirects <em>future</em> downloads;
        use the <strong>Move library</strong> button below if you also
        want to relocate everything you've already downloaded.{" "}
        <code>library.db</code> always lives at <code>~/Media Hub/</code>{" "}
        so it survives root changes.
      </p>

      <div className="settings-row">
        <span className="settings-label">Library root</span>
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
          <Icon.folder width={12} height={12} /> Browse…
        </button>
        <span className="hint-text faint">
          Empty = default. Editing here only affects new downloads.
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Move library</span>
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
          {migrating ? "Moving…" : "Move existing library to…"}
        </button>
        <span className="hint-text faint">
          Physically moves Library/, Projects/, _thumbnails/ and
          rewrites every asset's file path. Refuses if any download
          is in flight.
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Rename preset</span>
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
        <span className="settings-label">Template</span>
        <input
          className="field-input"
          type="text"
          placeholder="{title} [{id}]"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          spellCheck={false}
        />
        <span className="hint-text faint">
          Tokens: <code>&#123;title&#125;</code> ·{" "}
          <code>&#123;channel&#125;</code> · <code>&#123;date&#125;</code> ·{" "}
          <code>&#123;id&#125;</code>. Empty = legacy default. Extension
          appended automatically.
        </span>
      </div>
    </section>
  );
}

// =====================================================================
// Downloads — concurrency (B) + bandwidth/format (C scaffolded)
// =====================================================================

function DownloadsSection() {
  const { settings, save } = useSettings();
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
        Downloads <span className="chip">workers + throttle</span>
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
      <p className="hint">
        How many yt-dlp downloads run in parallel, optional bandwidth
        ceiling, and per-platform format memory. Concurrency × throttle
        is the effective ceiling — yt-dlp's <code>--limit-rate</code> is
        per-process.
      </p>

      <div className="settings-row">
        <span className="settings-label">Parallel workers</span>
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
        <span className="hint-text faint">
          Applies to the batch queue. Single-URL downloads ignore this.
        </span>
      </div>

      {/* 1.3.x — Preferred max video quality. Applies to queue jobs
          and extension/bridge sends — anywhere a download happens
          WITHOUT an explicit format pick on the Download page. */}
      <div className="settings-row">
        <span className="settings-label">Preferred quality</span>
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
          <option value="">Source (no cap)</option>
        </select>
        <span className="hint-text faint">
          Cap for batch queue + extension sends. Picks the highest
          variant ≤ cap; falls back to source if the video doesn't
          go that high. The Download page's format picker overrides
          this — it stays explicit.
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Bandwidth</span>
        <label className="settings-radio" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={limited}
            onChange={(e) => toggleLimit(e.target.checked)}
          />
          <span>Throttle</span>
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
        <span className="hint-text faint">
          KiB/s per worker. Off = unlimited. e.g. <code>5000</code> ≈ 5
          MB/s per parallel download.
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Sticky formats</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {stickyEntries.length === 0 ? (
            <span className="faint mono" style={{ fontSize: 11 }}>
              none yet — first downloaded format per platform is
              remembered automatically
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
                  Forget
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
            Forget all
          </button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-label">Scrubber jog</span>
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
        <span className="hint-text faint">
          Mouse-drag sensitivity on the scrubber's fine-jog disc.
          Higher = less drag needed per second of timeline.
          Frame-step keys (←/→) ignore this. Default 1.00×.
        </span>
      </div>
    </section>
  );
}

// =====================================================================
// Transcode default (B)
// =====================================================================

function TranscodeSection() {
  const { settings, save } = useSettings();
  const preset = settings.default_transcode_preset as TranscodePreset;

  function setPreset(p: TranscodePreset) {
    void save((s) => ({ ...s, default_transcode_preset: p }));
  }

  return (
    <section className="card-box">
      <h2>
        Transcode <span className="chip">default preset</span>
        <ResetButton
          onClick={() =>
            void save((s) => ({ ...s, default_transcode_preset: "none" }))
          }
        />
      </h2>
      <p className="hint">
        New downloads default to this preset. You can still pick a
        different preset per-download from the Download page. ProRes
        422 LT is the editing sweet spot for most NLEs.
      </p>

      <div className="settings-row">
        <span className="settings-label">Default preset</span>
        <select
          className="field-select"
          value={preset}
          onChange={(e) => setPreset(e.target.value as TranscodePreset)}
        >
          {TRANSCODE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="hint-text faint">
          {TRANSCODE_PRESETS.find((p) => p.value === preset)?.hint}
        </span>
      </div>
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
        Browser bridge <span className="chip">extension + scripts</span>
      </h2>
      <p className="hint">
        Media Hub runs a tiny HTTP server on <code>127.0.0.1</code> so the
        browser extension (or any local script) can send URLs straight
        into the download queue. Loopback only — never exposed to the
        network. Paste the token + URL below into the extension's
        settings to pair it once.
      </p>

      <div className="bar">
        <span className="settings-label">Enabled</span>
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
          {enabled
            ? "server starts on next launch"
            : "server is off — extension can't reach the app"}
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
          {copied === "url" ? "✓ Copied" : "Copy"}
        </button>
      </div>

      <div className="bar">
        <span className="settings-label">Port</span>
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
        <span className="hint-text">change requires app restart</span>
      </div>

      <div className="bar">
        <span className="settings-label">Token</span>
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
          {copied === "token" ? "✓ Copied" : "Copy"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => void regenerate()}
          title="Generate a new token (invalidates the current pairing)"
        >
          Regenerate
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
        Diagnostics <span className="chip">read-only</span>
      </h2>
      <p className="hint">
        Quick sanity check on bundled tools + on-disk paths. If something
        feels broken, this is the first place to look.
      </p>

      <div className="settings-row">
        <span className="settings-label">Bundled tools</span>
        <button className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Checking…" : "Re-check versions"}
        </button>
      </div>

      <div className="settings-row">
        <span className="settings-label">
          yt-dlp engine
          {engine && (
            <span className="chip" style={{ marginLeft: 8 }}>
              {engine.managed ? "auto-updated" : "bundled"}
            </span>
          )}
        </span>
        <button className="btn btn-secondary" onClick={() => void updateEngine()} disabled={updating}>
          {updating ? "Updating…" : "Update engine now"}
        </button>
      </div>
      <p className="hint">
        The download engine (yt-dlp) auto-updates silently on launch so
        sites that change frequently keep working. Use this if something
        breaks mid-session and you want the latest build immediately.
      </p>
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
        <span className="settings-label">Media Hub app</span>
        <button
          className="btn btn-secondary"
          onClick={() => void checkAndInstallAppUpdate()}
          disabled={appUpdating}
        >
          {appUpdating ? "Working…" : "Check for app updates"}
        </button>
      </div>
      <p className="hint">
        Updates the whole app to the latest signed release. The installer
        verifies the signature, runs silently, then relaunches Media Hub.
      </p>
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
          <dt>Library</dt>
          <dd>{libraryDir}</dd>
        </div>
        <div>
          <dt>Thumbnails</dt>
          <dd>{thumbsDir}</dd>
        </div>
        <div>
          <dt>Settings</dt>
          <dd>%APPDATA%\com.guilherme.mediahub\settings.json</dd>
        </div>
      </dl>
    </section>
  );
}

// =====================================================================
// About (B)
// =====================================================================

function AboutSection() {
  return (
    <section className="card-box">
      <h2>
        About <span className="chip">media-hub</span>
      </h2>
      <p className="hint">
        Desktop sourcing + organizing tool for video editors. Built with
        Tauri 2 + React + Rust. Bundles yt-dlp + ffmpeg.
      </p>

      <dl className="settings-kv">
        <div>
          <dt>Version</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        <div>
          <dt>Identifier</dt>
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
  return (
    <button
      type="button"
      className="settings-reset"
      onClick={async () => {
        const ok = await confirmDialog("Reset this section to defaults?", {
          title: "Reset section?",
          kind: "warning",
        });
        if (ok) onClick();
      }}
      title="Reset this section to defaults"
    >
      Reset
    </button>
  );
}
