import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../lib/icons";
import { useSettings } from "../lib/settings";
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
        Sources <span className="chip">YouTube cookies</span>
        <ResetButton
          onClick={() =>
            void save((s) => ({ ...s, cookies_source: { kind: "none" } }))
          }
        />
      </h2>
      <p className="hint">
        Some YouTube videos require sign-in (age-restricted, private,
        members-only, etc.). Point at a browser you're signed in to and
        yt-dlp will pull the cookies for you. Public videos work without
        any of this — leave at <strong>None</strong> if you don't hit
        the wall.
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
      )}
    </section>
  );
}

// =====================================================================
// Library — root override + rename template (0.8.C shipped)
// =====================================================================

function LibrarySection() {
  const { settings, save } = useSettings();
  const root = settings.library_root ?? "";
  const template = settings.rename_template;

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
        Existing files don't move — the override applies to new
        downloads. <code>library.db</code> always lives at the default
        path so it survives root changes.
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
          Empty = default. Existing files don't move.
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
        {/* Plain buttons instead of label+input radios. The original
         *  radio variant triggered a layout glitch on click (TopBar
         *  and Nav Workspace section disappeared — see NOTES.md
         *  2026-05-22 PM). Buttons sidestep whatever browser-quirk
         *  the label+input triggered. UX is identical. */}
        <div className="settings-radio-group" role="radiogroup">
          {(
            [
              { value: 0.5, label: "Coarse · 0.5×" },
              { value: 1.0, label: "Default · 1×" },
              { value: 2.0, label: "Fine · 2×" },
            ] as const
          ).map((opt) => {
            const active = Math.abs(settings.jog_sensitivity - opt.value) < 0.01;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={"settings-radio" + (active ? " active" : "")}
                onClick={(e) => {
                  e.preventDefault();
                  // Debug log — if a future layout glitch returns
                  // we can confirm the click actually fired and
                  // the save promise resolved cleanly.
                  console.debug("[settings] jog_sensitivity →", opt.value);
                  save((s) => ({ ...s, jog_sensitivity: opt.value }))
                    .catch((err) =>
                      console.warn("[settings] jog save failed:", err),
                    );
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="hint-text faint">
          Mouse-drag sensitivity on the scrubber's fine-jog disc.
          Higher = less drag needed per second of timeline.
          Frame-step keys (←/→) ignore this.
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
// Diagnostics (B)
// =====================================================================

function DiagnosticsSection() {
  const [versions, setVersions] = useState<SidecarVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const out = await invoke<SidecarVersion[]>("binaries_version");
      setVersions(out);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
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
          <dd>0.9.0-dev</dd>
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
      onClick={() => {
        if (confirm("Reset this section to defaults?")) onClick();
      }}
      title="Reset this section to defaults"
    >
      Reset
    </button>
  );
}
