import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../lib/icons";
import { useSettings } from "../lib/settings";
import { TRANSCODE_PRESETS, type CookiesSource, type SidecarVersion, type TranscodePreset } from "../lib/types";

/**
 * Settings page — 0.8 milestone.
 *
 * Sections:
 *   - Sources     → YouTube cookies (B) ✅
 *   - Library     → root override + rename template (C, scaffolded)
 *   - Downloads   → concurrency (B) ✅ + bandwidth + sticky format (C)
 *   - Transcode   → default preset (B) ✅
 *   - Diagnostics → tool versions, paths (B) ✅
 *   - About       → version, licenses (B) ✅
 */
export default function SettingsPage() {
  const { ready } = useSettings();

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Settings</div>
        <span className="ch-meta">0.8 in progress</span>
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
            On Windows, Chrome/Edge may require the browser to be closed
            (cookie SQLite is file-locked while open).
          </span>
        </div>
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
          <span className="hint-text faint">
            Netscape-format cookies.txt (export via a browser extension).
          </span>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// Library — scaffolding for 0.8.C
// =====================================================================

function LibrarySection() {
  return (
    <section className="card-box">
      <h2>
        Library <span className="chip">0.8.C</span>
      </h2>
      <p className="hint">
        Library root override (move <code>~/Media Hub</code> somewhere else).
        Rename rule with <code>&#123;channel&#125;</code> /{" "}
        <code>&#123;title&#125;</code> / <code>&#123;date&#125;</code> tokens
        plus a few preset patterns to pick from.
      </p>
      <div className="settings-placeholder">
        <Icon.settings width={18} height={18} style={{ color: "var(--text-3)" }} />
        <span className="faint mono" style={{ fontSize: 11 }}>
          Fields land with 0.8.C.
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

  function setConcurrency(n: number) {
    const clamped = Math.max(1, Math.min(6, Math.round(n)));
    void save((s) => ({ ...s, download_concurrency: clamped }));
  }

  return (
    <section className="card-box">
      <h2>
        Downloads <span className="chip">parallel workers</span>
      </h2>
      <p className="hint">
        How many yt-dlp downloads run in parallel. More = faster batch
        jobs but more bandwidth contention; the sweet spot for most
        connections is 3. Clamped 1–6.
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

      <div
        className="settings-placeholder"
        style={{ marginTop: 4 }}
      >
        <Icon.settings width={16} height={16} style={{ color: "var(--text-3)" }} />
        <span className="faint mono" style={{ fontSize: 11 }}>
          Bandwidth throttle + sticky last-format per platform → 0.8.C.
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
          <dd>0.8.0-dev</dd>
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
