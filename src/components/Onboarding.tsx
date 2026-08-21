/**
 * First-run onboarding modal (0.8.D).
 *
 * Shown when `settings.onboarding_complete === false` (the default for
 * fresh installs). The modal sits as an overlay on top of whatever
 * route the user lands on; nothing else is interactive until they
 * finish or skip.
 *
 * Flow:
 *   1. Welcome      — what Media Hub is, one-paragraph pitch
 *   2. Configure    — pick library root + default transcode preset
 *   3. Cookies      — heads-up about the closed-browser requirement;
 *                     "skip for now" leaves cookies disabled
 *   4. Workflow tip — segment download + NLE watch-folder pattern,
 *                     plus the RTX enhancer offer on machines that
 *                     have a capable GPU (optional, never blocking)
 *
 * On Finish, the draft state writes to settings.json in one save:
 *   - library_root         (only if non-empty + differs from default)
 *   - default_transcode_preset
 *   - cookies_source       (from the user's pick, or kept "none")
 *   - onboarding_complete  (true — won't show again)
 *
 * "Skip onboarding" still flips onboarding_complete so we don't
 * harass the user; they can always edit defaults in Settings.
 */

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../lib/icons";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import { RtxInstallCard } from "./RtxInstallCard";
import {
  TRANSCODE_PRESETS,
  type CookiesSource,
  type TranscodePreset,
} from "../lib/types";

type Step = 0 | 1 | 2 | 3;

// Firefox first since it's the only browser whose cookies yt-dlp can
// actually still read (Chrome 127+ DPAPI breakage — see yt-dlp/yt-dlp#10927).
// Chromium-family options are kept for completeness but flagged in the
// UI as currently-broken.
const BROWSERS = ["firefox", "chrome", "brave", "edge", "vivaldi", "opera"] as const;
const CHROMIUM_BROWSERS = new Set(["chrome", "brave", "edge", "vivaldi", "opera"]);

/**
 * Public entry point. Renders the modal when settings are loaded
 * and onboarding hasn't been completed. Once finished/skipped, the
 * onboarding_complete flag persists in settings.json so this is a
 * one-time experience per install.
 */
export function OnboardingGate() {
  const { settings, ready } = useSettings();
  if (!ready) return null;
  if (settings.onboarding_complete) return null;
  return <OnboardingModal />;
}

function OnboardingModal() {
  const { save } = useSettings();
  const t = useT();
  const [step, setStep] = useState<Step>(0);
  const stepTitles = [
    t("onb.step.welcome"),
    t("onb.step.library"),
    t("onb.step.cookies"),
    t("onb.step.segments"),
  ];

  // Draft state — collected across screens, committed on Finish.
  // Defaults match the existing settings defaults so a user who
  // hits Next without touching anything still gets sensible config.
  // Transcode defaults to "none" ON PURPOSE — people click through the
  // wizard without reading, and a non-none default silently transcodes
  // every download (slow + huge files). Opt in, don't opt out.
  const [libraryRoot, setLibraryRoot] = useState<string>("");
  const [preset, setPreset] = useState<TranscodePreset>("none");
  const [cookies, setCookies] = useState<CookiesSource>({ kind: "none" });
  const [filePath, setFilePath] = useState<string>("");
  const [browser, setBrowser] = useState<string>(BROWSERS[0]);

  function next() {
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }
  function back() {
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  }

  async function finish(opts: { skip?: boolean } = {}) {
    // Compose final cookies source from the local sub-fields so the
    // shape is always valid (e.g. "file" mode without a path would
    // store empty string).
    let finalCookies: CookiesSource = { kind: "none" };
    if (!opts.skip) {
      if (cookies.kind === "browser") {
        finalCookies = { kind: "browser", browser };
      } else if (cookies.kind === "file") {
        finalCookies = { kind: "file", path: filePath };
      }
    }
    try {
      await save((s) => ({
        ...s,
        library_root: opts.skip
          ? s.library_root
          : libraryRoot.trim() === ""
            ? null
            : libraryRoot.trim(),
        default_transcode_preset: opts.skip ? s.default_transcode_preset : preset,
        cookies_source: opts.skip ? s.cookies_source : finalCookies,
        onboarding_complete: true,
      }));
    } catch (e) {
      console.warn("onboarding save failed:", e);
      // Don't trap the user — flip onboarding_complete so they can
      // move on and configure manually if needed.
      try {
        await save((s) => ({ ...s, onboarding_complete: true }));
      } catch {
        /* swallow */
      }
    }
  }

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label={t("onb.aria")}>
      <div className="onb-card">
        <header className="onb-head">
          <div className="onb-brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">Media Hub</span>
          </div>
          {/* Compact stepper: 4 numbered dots + the active step's
              label only. Showing all four labels overflowed the
              header on standard window widths and clipped both ends. */}
          <div className="onb-steps">
            {stepTitles.map((title, i) => (
              <span
                key={title}
                className={"onb-step-dot" + (i === step ? " active" : i < step ? " done" : "")}
                title={`${i + 1}. ${title}`}
              >
                {i + 1}
              </span>
            ))}
            <span className="onb-step-current">
              {t("onb.stepper.current")
                .replace("{n}", String(step + 1))
                .replace("{title}", stepTitles[step])}
            </span>
          </div>
          <button
            className="onb-skip"
            onClick={() => void finish({ skip: true })}
            title={t("onb.skip.title")}
          >
            {t("onb.skip")}
          </button>
        </header>

        <div className="onb-body">
          {step === 0 && <ScreenWelcome />}
          {step === 1 && (
            <ScreenConfigure
              libraryRoot={libraryRoot}
              setLibraryRoot={setLibraryRoot}
              preset={preset}
              setPreset={setPreset}
            />
          )}
          {step === 2 && (
            <ScreenCookies
              mode={cookies.kind}
              setMode={(k) => setCookies({ kind: k } as CookiesSource)}
              browser={browser}
              setBrowser={setBrowser}
              filePath={filePath}
              setFilePath={setFilePath}
            />
          )}
          {step === 3 && <ScreenWorkflow />}
        </div>

        <footer className="onb-foot">
          <button className="btn btn-secondary" onClick={back} disabled={step === 0}>
            {t("onb.back")}
          </button>
          <span className="onb-foot-spacer" />
          {step < 3 ? (
            <button className="btn" onClick={next}>
              {t("onb.next")}
            </button>
          ) : (
            <button className="btn" onClick={() => void finish()}>
              {t("onb.finish")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// =====================================================================
// Screens
// =====================================================================

function ScreenWelcome() {
  const t = useT();
  return (
    <div className="onb-screen">
      <h2 className="onb-title">{t("onb.welcome.title")}</h2>
      <p className="onb-lead">{t("onb.welcome.lead")}</p>
      <ul className="onb-bullets">
        <li>
          <strong>{t("onb.welcome.b1.t")}</strong> — {t("onb.welcome.b1.d")}
        </li>
        <li>
          <strong>{t("onb.welcome.b2.t")}</strong> — {t("onb.welcome.b2.d")}
        </li>
        <li>
          <strong>{t("onb.welcome.b3.t")}</strong> — {t("onb.welcome.b3.d")}
        </li>
        <li>
          <strong>{t("onb.welcome.b4.t")}</strong> — {t("onb.welcome.b4.d")}
        </li>
      </ul>
    </div>
  );
}

function ScreenConfigure(props: {
  libraryRoot: string;
  setLibraryRoot: (s: string) => void;
  preset: TranscodePreset;
  setPreset: (p: TranscodePreset) => void;
}) {
  const { libraryRoot, setLibraryRoot, preset, setPreset } = props;
  const t = useT();
  return (
    <div className="onb-screen">
      <h2 className="onb-title">{t("onb.cfg.title")}</h2>
      <p className="onb-lead">{t("onb.cfg.lead")}</p>

      <div className="onb-field">
        <label className="onb-label">{t("onb.cfg.rootLabel")}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            className="field-input"
            placeholder={t("onb.cfg.rootPlaceholder")}
            value={libraryRoot}
            onChange={(e) => setLibraryRoot(e.target.value)}
            spellCheck={false}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              try {
                const picked = await openDialog({
                  directory: true,
                  multiple: false,
                  title: t("onb.cfg.pickTitle"),
                });
                if (typeof picked === "string") setLibraryRoot(picked);
              } catch (e) {
                console.warn("folder picker failed:", e);
              }
            }}
          >
            <Icon.folder width={12} height={12} /> {t("onb.cfg.browse")}
          </button>
        </div>
        <p className="onb-hint">
          {t("onb.cfg.rootHintPre")}
          <code>~/Media Hub</code>
          {t("onb.cfg.rootHintPost")}
        </p>
      </div>

      <div className="onb-field">
        <label className="onb-label">{t("onb.cfg.presetLabel")}</label>
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
        <p className="onb-hint">
          {t(`preset.${preset}.hint`)}
          <br />
          {t("onb.cfg.presetHint2")}
        </p>
      </div>
    </div>
  );
}

function ScreenCookies(props: {
  mode: CookiesSource["kind"];
  setMode: (k: CookiesSource["kind"]) => void;
  browser: string;
  setBrowser: (b: string) => void;
  filePath: string;
  setFilePath: (p: string) => void;
}) {
  const { mode, setMode, browser, setBrowser, filePath, setFilePath } = props;
  const t = useT();
  return (
    <div className="onb-screen">
      <h2 className="onb-title">{t("onb.ck.title")}</h2>
      <p className="onb-lead">{t("onb.ck.lead")}</p>

      <div className="onb-callout onb-callout-cookies">
        <h3 className="onb-callout-title">{t("onb.ck.calloutTitle")}</h3>

        <div className="onb-cookie-grid">
          <span className="onb-tag onb-tag-ok">{t("onb.ck.recommended")}</span>
          <div className="onb-cookie-body">
            <div><strong>Firefox</strong> · Safari ({t("onb.ck.macOnly")})</div>
            <div className="onb-cookie-why">{t("onb.ck.recWhy")}</div>
          </div>

          <span className="onb-tag onb-tag-err">{t("onb.ck.broken")}</span>
          <div className="onb-cookie-body">
            <div>Chrome · Brave · Edge · Vivaldi · Opera · Chromium</div>
            <div className="onb-cookie-why">{t("onb.ck.brokenWhy")}</div>
          </div>
        </div>

        <div className="onb-cookie-tip">
          <strong>{t("onb.ck.tipLabel")}</strong> {t("onb.ck.tip")}
        </div>
      </div>

      <div className="onb-radio-group">
        {(["none", "browser", "file"] as const).map((m) => (
          <label key={m} className={"settings-radio" + (mode === m ? " active" : "")}>
            <input
              type="radio"
              name="onb-cookies-mode"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span>
              {m === "none"
                ? t("onb.ck.optNone")
                : m === "browser"
                  ? t("onb.ck.optBrowser")
                  : t("onb.ck.optFile")}
            </span>
          </label>
        ))}
      </div>

      {mode === "browser" && (
        <div className="onb-field">
          <label className="onb-label">{t("onb.ck.browserLabel")}</label>
          <select
            className="field-select"
            value={browser}
            onChange={(e) => setBrowser(e.target.value)}
          >
            {BROWSERS.map((b) => (
              <option key={b} value={b}>
                {b[0].toUpperCase() + b.slice(1)}
                {CHROMIUM_BROWSERS.has(b) ? t("onb.ck.brokenSuffix") : ""}
              </option>
            ))}
          </select>
          {CHROMIUM_BROWSERS.has(browser) && (
            <p className="onb-hint" style={{ color: "#e0a93a" }}>
              {t("onb.ck.chromiumWarn")}
            </p>
          )}
        </div>
      )}

      {mode === "file" && (
        <div className="onb-field">
          <label className="onb-label">{t("onb.ck.fileLabel")}</label>
          <input
            type="text"
            className="field-input"
            placeholder="C:\path\to\cookies.txt"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            spellCheck={false}
          />
          <p className="onb-hint">{t("onb.ck.fileHint")}</p>
        </div>
      )}
    </div>
  );
}

function ScreenWorkflow() {
  const t = useT();
  return (
    <div className="onb-screen">
      <h2 className="onb-title">{t("onb.wf.title")}</h2>
      <p className="onb-lead">{t("onb.wf.lead")}</p>

      <ol className="onb-steps-list">
        <li>
          <strong>{t("onb.wf.s1.t")}</strong>{t("onb.wf.s1.d")}
        </li>
        <li>
          <strong>{t("onb.wf.s2.t")}</strong>{t("onb.wf.s2.d1")}<kbd>I</kbd>
          {t("onb.wf.s2.d2")}<kbd>O</kbd>{t("onb.wf.s2.d3")}
        </li>
        <li>
          <strong>{t("onb.wf.s3.t")}</strong>{t("onb.wf.s3.d")}
        </li>
        <li>
          <strong>{t("onb.wf.s4.t")}</strong>{t("onb.wf.s4.d")}
        </li>
      </ol>

      <div className="onb-callout onb-callout-pro">
        <Icon.folder width={14} height={14} />
        <div>
          <strong>{t("onb.wf.proLabel")}</strong> {t("onb.wf.proBody")}
        </div>
      </div>

      {/* 1.15.0 — renders itself only on a machine with a capable RTX GPU
          and no sidecar yet. Deliberately NOT a wizard step: it is optional,
          it is a 28 MB download, and "Finish" must stay one click away for
          everyone who does not want it. */}
      <RtxInstallCard showLater />
    </div>
  );
}
