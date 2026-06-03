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
 *   4. Workflow tip — segment download + NLE watch-folder pattern
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
import {
  TRANSCODE_PRESETS,
  type CookiesSource,
  type TranscodePreset,
} from "../lib/types";

type Step = 0 | 1 | 2 | 3;

const STEP_TITLES: string[] = [
  "Welcome",
  "Set up your library",
  "Browser cookies (optional)",
  "How segment downloads work",
];

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
  const [step, setStep] = useState<Step>(0);

  // Draft state — collected across screens, committed on Finish.
  // Defaults match the existing settings defaults so a user who
  // hits Next without touching anything still gets sensible config.
  const [libraryRoot, setLibraryRoot] = useState<string>("");
  const [preset, setPreset] = useState<TranscodePreset>("prores_422_lt");
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
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Media Hub">
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
            {STEP_TITLES.map((t, i) => (
              <span
                key={t}
                className={"onb-step-dot" + (i === step ? " active" : i < step ? " done" : "")}
                title={`${i + 1}. ${t}`}
              >
                {i + 1}
              </span>
            ))}
            <span className="onb-step-current">
              Step {step + 1} of 4 · {STEP_TITLES[step]}
            </span>
          </div>
          <button
            className="onb-skip"
            onClick={() => void finish({ skip: true })}
            title="Skip onboarding — you can change all of this later in Settings."
          >
            Skip
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
            Back
          </button>
          <span className="onb-foot-spacer" />
          {step < 3 ? (
            <button className="btn" onClick={next}>
              Next
            </button>
          ) : (
            <button className="btn" onClick={() => void finish()}>
              Finish
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
  return (
    <div className="onb-screen">
      <h2 className="onb-title">No bloat. Just the clip you need.</h2>
      <p className="onb-lead">
        Media Hub is a desktop sourcing tool for editors and creators.
        Paste a video URL — YouTube, Twitter/X, TikTok, Pinterest,
        Reddit, Instagram — scrub or punch in timestamps, get only the
        segment you want — transcoded into a format your NLE actually
        likes (ProRes / DNxHR / optimized MP4), filed into a tagged
        library you can search a month later.
      </p>
      <ul className="onb-bullets">
        <li>
          <strong>Segment downloads</strong> — never grab a 1-hour video
          to use 5 seconds of it.
        </li>
        <li>
          <strong>Edit-friendly transcodes</strong> — ProRes 422 LT and
          DNxHR SQ bundled. Drop straight into Resolve / Premiere / Avid.
        </li>
        <li>
          <strong>Tagged library + projects</strong> — every download
          gets a row. Search and filter by tag, channel, or source.
        </li>
        <li>
          <strong>Local-first</strong> — files live on your disk in folders
          you can poke at directly. No cloud lock-in.
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
  const presetMeta = TRANSCODE_PRESETS.find((p) => p.value === preset);
  return (
    <div className="onb-screen">
      <h2 className="onb-title">Set up your library</h2>
      <p className="onb-lead">
        Two quick decisions. You can change both later in Settings.
      </p>

      <div className="onb-field">
        <label className="onb-label">Library root</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            className="field-input"
            placeholder="(default) ~/Media Hub"
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
                  title: "Choose your library folder",
                });
                if (typeof picked === "string") setLibraryRoot(picked);
              } catch (e) {
                console.warn("folder picker failed:", e);
              }
            }}
          >
            <Icon.folder width={12} height={12} /> Browse…
          </button>
        </div>
        <p className="onb-hint">
          Where downloaded clips live on disk. Leave empty for the
          default (<code>~/Media Hub</code>).
        </p>
      </div>

      <div className="onb-field">
        <label className="onb-label">Default transcode preset</label>
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
        <p className="onb-hint">
          {presetMeta?.hint}
          <br />
          ProRes 422 LT is the editing sweet spot for most B-roll
          workflows. Pick "None" if you want files exactly as
          downloaded.
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
  return (
    <div className="onb-screen">
      <h2 className="onb-title">Browser cookies — only if you need them</h2>
      <p className="onb-lead">
        Public videos work without any of this on every supported
        source. Cookies are only needed for sign-in-walled clips —
        age-restricted YouTube, private Twitter/X posts, members-
        only content, and similar. Pick <strong>None</strong> if
        you're not sure — flip it on later when you hit the wall.
      </p>

      <div className="onb-callout onb-callout-cookies">
        <h3 className="onb-callout-title">
          Heads up — browser cookie compatibility
        </h3>

        <div className="onb-cookie-grid">
          <span className="onb-tag onb-tag-ok">Recommended</span>
          <div className="onb-cookie-body">
            <div><strong>Firefox</strong> · Safari (macOS only)</div>
            <div className="onb-cookie-why">
              Work while the browser is open. Firefox is the easiest
              path for daily use.
            </div>
          </div>

          <span className="onb-tag onb-tag-err">Currently broken</span>
          <div className="onb-cookie-body">
            <div>Chrome · Brave · Edge · Vivaldi · Opera · Chromium</div>
            <div className="onb-cookie-why">
              Chrome 127+ added "App-Bound Encryption" — yt-dlp can't
              decrypt cookies from any Chromium browser right now
              (yt-dlp issue #10927).
            </div>
          </div>
        </div>

        <div className="onb-cookie-tip">
          <strong>Tip —</strong> if your main browser is Chrome, sign
          in to YouTube in Firefox once and point Media Hub at Firefox.
          Or use a <code>cookies.txt</code> export from any browser
          (file mode below — works while everything is open).
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
                ? "None — skip cookies"
                : m === "browser"
                  ? "Read from browser"
                  : "Read from cookies.txt file"}
            </span>
          </label>
        ))}
      </div>

      {mode === "browser" && (
        <div className="onb-field">
          <label className="onb-label">Browser</label>
          <select
            className="field-select"
            value={browser}
            onChange={(e) => setBrowser(e.target.value)}
          >
            {BROWSERS.map((b) => (
              <option key={b} value={b}>
                {b[0].toUpperCase() + b.slice(1)}
                {CHROMIUM_BROWSERS.has(b) ? " (broken — DPAPI)" : ""}
              </option>
            ))}
          </select>
          {CHROMIUM_BROWSERS.has(browser) && (
            <p className="onb-hint" style={{ color: "#e0a93a" }}>
              ⚠ Chromium browsers can't decrypt cookies right now.
              Pick Firefox above, or switch to <strong>cookies.txt
              file mode</strong> below.
            </p>
          )}
        </div>
      )}

      {mode === "file" && (
        <div className="onb-field">
          <label className="onb-label">Path to cookies.txt</label>
          <input
            type="text"
            className="field-input"
            placeholder="C:\path\to\cookies.txt"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            spellCheck={false}
          />
          <p className="onb-hint">
            Netscape-format. Export from your browser with the
            free "Get cookies.txt LOCALLY" extension (Chrome /
            Firefox). Works even while the browser is open.
          </p>
        </div>
      )}
    </div>
  );
}

function ScreenWorkflow() {
  return (
    <div className="onb-screen">
      <h2 className="onb-title">The 30-second workflow</h2>
      <p className="onb-lead">
        Here's the loop most editors run a hundred times a week:
      </p>

      <ol className="onb-steps-list">
        <li>
          <strong>Paste a URL</strong> on the Download page. Metadata
          + scrubber load in a second or two.
        </li>
        <li>
          <strong>Scrub to mark segments.</strong> Hit <kbd>I</kbd>{" "}
          at the in point, scrub forward, hit <kbd>O</kbd> at the
          out point. Repeat for multiple cuts from the same source.
        </li>
        <li>
          <strong>Pick a format + transcode preset</strong>, then
          download. yt-dlp pulls the source once and ffmpeg trims
          each segment locally — bandwidth saved.
        </li>
        <li>
          <strong>Files land in your library</strong>, tagged with
          the channel + source URL. Open them straight in your NLE.
        </li>
      </ol>

      <div className="onb-callout onb-callout-pro">
        <Icon.folder width={14} height={14} />
        <div>
          <strong>Pro tip — watch folder integration.</strong> Point
          your NLE's media browser at{" "}
          <code>~/Media Hub/Library/raw/</code> (or your project's{" "}
          <code>raw/</code> folder). Every clip you download
          auto-imports. Resolve calls it "Auto-Sync Bin"; Premiere
          has Media Browser; FCP uses watched event folders.
        </div>
      </div>
    </div>
  );
}
