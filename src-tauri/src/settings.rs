// Media Hub — user settings persistence.
//
// 0.8.A foundation. Everything user-tweakable that isn't already
// captured per-asset or per-project (those live in the SQLite library
// already). The struct contains all anticipated fields with serde
// `#[serde(default)]` so older settings.json files keep loading
// cleanly as we add fields in 0.8.B / 0.8.C.
//
// Storage: `<app_config_dir>/settings.json` — Tauri resolves to
// `%APPDATA%\com.guilherme.mediahub\` on Windows,
// `~/Library/Application Support/com.guilherme.mediahub/` on macOS,
// `~/.config/com.guilherme.mediahub/` on Linux.
//
// Atomic writes: we write to `settings.json.tmp` then rename, so a
// crash mid-save can't leave a half-written file. Tauri's settings
// plugin would handle this too but a 60-line hand-roll keeps the
// dep surface clean.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

// =====================================================================
// Schema
// =====================================================================

/// How yt-dlp should source cookies for age-restricted or otherwise
/// authenticated content. Defaults to `None` (skip — most public
/// videos work without).
///
/// Tagged enum: serializes as
///   { "kind": "none" }
///   { "kind": "browser", "browser": "chrome" }
///   { "kind": "file", "path": "C:\\..." }
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CookiesSource {
    #[default]
    None,
    Browser { browser: String },
    File { path: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(default)]
pub struct Settings {
    // Sources — 0.8.B will surface this in the UI.
    pub cookies_source: CookiesSource,

    // Library — 0.8.C / 0.8.B mix.
    /// Override of the default `~/Media Hub/` root. NULL = default.
    /// Phase B+ uses this in `resolve_download_dir`.
    pub library_root: Option<String>,
    /// User-defined rename template with {channel}/{title}/{date}
    /// tokens. Empty = use the existing yt-dlp template
    /// (`%(title).180B [%(id)s].%(ext)s`). Lands with 0.8.C.
    pub rename_template: String,

    // Downloads.
    /// How many yt-dlp downloads run in parallel (currently
    /// hardcoded 3 on the frontend; settings consumer migration
    /// lands with 0.8.B).
    pub download_concurrency: u32,
    /// yt-dlp `--limit-rate` in KiB/s. None = unlimited. Lands 0.8.C.
    pub bandwidth_limit_kbps: Option<u32>,

    // Transcode.
    /// Default transcode preset for new downloads. "none" / "prores_422_lt"
    /// / "dnxhr_sq" / "h264_mp4" / "h264_nvenc_mp4". Lands 0.8.B.
    pub default_transcode_preset: String,

    // Misc.
    /// Whether the onboarding tutorial has been completed. False on
    /// first launch → onboarding modal renders. Lands 0.8.D.
    pub onboarding_complete: bool,

    /// Per-platform sticky format memory (0.8.C). Key is platform name
    /// ("youtube" today; "twitter", "tiktok" etc. when 1.x platforms
    /// land). Value is the format_id the user last picked for that
    /// platform. On metadata load, the frontend tries to pre-select
    /// the sticky format from the format list if it's still present.
    /// Empty by default — first download is a regular pick.
    #[serde(default)]
    pub last_formats: HashMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cookies_source: CookiesSource::None,
            library_root: None,
            rename_template: String::new(),
            download_concurrency: 3,
            bandwidth_limit_kbps: None,
            default_transcode_preset: "none".into(),
            onboarding_complete: false,
            last_formats: HashMap::new(),
        }
    }
}

// =====================================================================
// Helpers used by other modules
// =====================================================================

/// Resolve the on-disk root for content (Library/, Projects/, _thumbnails/).
///
/// Returns the user's `library_root` override if set + non-empty + valid,
/// otherwise the default `<home>/Media Hub`. The DB intentionally stays
/// at the default path regardless — moving an open SQLite file mid-session
/// is fiddly and the user-visible win is small.
///
/// Pass-through-safe: if the override path doesn't exist yet, we still
/// return it; the caller (`std::fs::create_dir_all`) will create it.
pub fn content_root(state: &SettingsState, home: &std::path::Path) -> PathBuf {
    let guard = state.inner.lock();
    let override_path = guard
        .ok()
        .and_then(|g| g.library_root.clone())
        .filter(|s| !s.trim().is_empty());
    match override_path {
        Some(p) => PathBuf::from(p),
        None => home.join("Media Hub"),
    }
}

/// Build the yt-dlp `-o` template path from the user's rename template
/// (0.8.C). Empty template → the original default. Tokens supported:
///
///   {title}   → %(title).180B  (truncated for filesystem-safe length)
///   {channel} → %(channel)s
///   {date}    → %(upload_date)s  (YYYYMMDD)
///   {id}      → %(id)s
///
/// We always force `.%(ext)s` at the end if the user didn't include it
/// — without it yt-dlp produces extension-less files that NLEs reject.
/// `--restrict-filenames` (always on) handles unsafe character cleanup
/// downstream, so no per-token escaping needed here.
pub fn build_filename_template(user_template: &str) -> String {
    let trimmed = user_template.trim();
    if trimmed.is_empty() {
        return "%(title).180B [%(id)s].%(ext)s".to_string();
    }
    let mut out = trimmed
        .replace("{title}", "%(title).180B")
        .replace("{channel}", "%(channel)s")
        .replace("{date}", "%(upload_date)s")
        .replace("{id}", "%(id)s");
    if !out.contains("%(ext)s") {
        out.push_str(".%(ext)s");
    }
    out
}

/// Return yt-dlp argv extras for the bandwidth throttle setting.
/// None / 0 = unlimited (empty Vec). Otherwise emits `--limit-rate <N>K`.
pub fn bandwidth_args(state: &SettingsState) -> Vec<String> {
    let guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    match guard.bandwidth_limit_kbps {
        Some(n) if n > 0 => vec!["--limit-rate".into(), format!("{n}K")],
        _ => Vec::new(),
    }
}

/// Return the user's rename template (0.8.C). Cloned so the caller
/// owns the string without holding the settings lock during the
/// (potentially long) yt-dlp invocation that follows.
pub fn rename_template(state: &SettingsState) -> String {
    state
        .inner
        .lock()
        .map(|g| g.rename_template.clone())
        .unwrap_or_default()
}

/// Translate a raw yt-dlp stderr line into a friendly, actionable
/// message when we recognize it. Returns the original string
/// unchanged when nothing matches — silently passing through is
/// safer than guessing wrong.
///
/// We match on case-insensitive substrings rather than exact strings
/// because yt-dlp formats vary across versions and the same root
/// cause shows up in slightly different sentences.
///
/// Common pain points covered:
///   - Chromium-family browser cookie DB locked (browser open) →
///     the headline 0.8 friction we've been documenting
///   - Browser not found (user picked a browser they don't have)
///   - Age-restricted / private / members-only content reachable
///     only with cookies the user hasn't configured
///   - Cookies file missing / malformed
///   - Network-shaped failures we can't help with but can name
///
/// Each branch ends with the specific user action that fixes it,
/// not just a diagnosis. Don't tell the user something's broken
/// without telling them what to click.
pub fn translate_ytdlp_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    // Chromium-family cookie DB lock — the big one.
    if lower.contains("could not copy") && lower.contains("cookie") {
        return format!(
            "Couldn't read browser cookies — the browser is open and locking its cookie database. \
             Close Chrome / Brave / Edge / Vivaldi / Opera and retry, or switch to Firefox \
             (works while open) in Settings → Sources. Raw: {raw}"
        );
    }

    // Browser not installed / wrong path.
    if (lower.contains("could not find") || lower.contains("not found"))
        && (lower.contains("chrome")
            || lower.contains("firefox")
            || lower.contains("brave")
            || lower.contains("edge")
            || lower.contains("opera")
            || lower.contains("safari")
            || lower.contains("vivaldi")
            || lower.contains("chromium"))
    {
        return format!(
            "Browser not found on this machine. Pick a different browser in Settings → Sources, \
             or switch to a cookies.txt file. Raw: {raw}"
        );
    }

    // Age-gate without cookies.
    if lower.contains("sign in to confirm your age") || lower.contains("age-restricted") {
        return format!(
            "Age-restricted video — needs YouTube login. Configure cookies in Settings → Sources \
             (browser or cookies.txt file). Raw: {raw}"
        );
    }

    // Private video.
    if lower.contains("private video") || lower.contains("video is private") {
        return format!(
            "Private video — only accounts with access can fetch it. Configure cookies for that \
             account in Settings → Sources. Raw: {raw}"
        );
    }

    // Members-only content.
    if lower.contains("members-only")
        || lower.contains("join this channel")
        || lower.contains("members only")
    {
        return format!(
            "Members-only content — needs cookies for an account that's a channel member. \
             Configure in Settings → Sources. Raw: {raw}"
        );
    }

    // Generic "needs cookies" hint yt-dlp gives.
    if lower.contains("use --cookies") || lower.contains("--cookies-from-browser") {
        return format!(
            "This video needs cookies to access. Configure browser or cookies.txt in \
             Settings → Sources. Raw: {raw}"
        );
    }

    // cookies.txt file missing or malformed (when user picked file mode).
    if lower.contains("cookies file") && (lower.contains("not found") || lower.contains("invalid"))
    {
        return format!(
            "cookies.txt file missing or unreadable. Re-export it from your browser via the \
             'Get cookies.txt LOCALLY' extension and update the path in Settings → Sources. \
             Raw: {raw}"
        );
    }

    // Network failures — can't fix it but at least name it.
    if lower.contains("unable to download")
        && (lower.contains("connection") || lower.contains("timed out") || lower.contains("network"))
    {
        return format!(
            "Network problem — check your connection and try again. Raw: {raw}"
        );
    }

    // Unknown — pass through.
    raw.to_string()
}

// =====================================================================
// State + IO
// =====================================================================

/// Held in Tauri's State<>. Behind a Mutex because we mutate from
/// multiple command handlers and the writes are infrequent (user
/// changes a field, click) so contention isn't a concern.
pub struct SettingsState {
    pub inner: Mutex<Settings>,
    pub path: PathBuf,
}

/// Resolve the settings file path. Created on first save if missing.
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Load settings from disk, falling back to defaults on absence or
/// corruption. We DON'T fail to start when settings.json is malformed
/// — the user's library/projects are way more important than their
/// preferences. Log + use defaults.
pub fn init(app: &AppHandle) -> Result<SettingsState, String> {
    let path = settings_path(app)?;
    let settings = match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Settings>(&s) {
            Ok(s) => s,
            Err(e) => {
                eprintln!(
                    "settings.json malformed ({e}) — using defaults. Original at {}",
                    path.display()
                );
                Settings::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(e) => {
            eprintln!("settings.json read error ({e}) — using defaults");
            Settings::default()
        }
    };
    Ok(SettingsState {
        inner: Mutex::new(settings),
        path,
    })
}

/// Atomic write: serialize to tmp, then rename over the target.
/// Avoids the "crashed mid-save, file is now half a JSON object"
/// pathology.
fn save_to_disk(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("serialize settings: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write tmp settings: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename settings: {e}"))?;
    Ok(())
}

// =====================================================================
// Tauri commands
// =====================================================================

/// Build the yt-dlp argv extras for the current cookies setting.
/// Returns an empty Vec when source is None — callers can extend()
/// their args vector unconditionally.
///
/// `--cookies-from-browser <name>` reads cookies directly from the
/// browser's profile (requires the browser to be installed; on
/// Chrome family Windows wants the browser closed because of the
/// file lock on Cookies SQLite). `--cookies <path>` reads a
/// Netscape-format cookies.txt the user exported manually.
///
/// We allowlist the browser names yt-dlp supports — slipping an
/// arbitrary string through could shell-quote-injection territory
/// (yt-dlp uses argv so it's safer than a shell command line, but
/// still: defense in depth).
pub fn cookies_args(state: &SettingsState) -> Vec<String> {
    let guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    match &guard.cookies_source {
        CookiesSource::None => Vec::new(),
        CookiesSource::Browser { browser } => {
            const ALLOWED: &[&str] = &[
                "brave", "chrome", "chromium", "edge", "firefox",
                "opera", "safari", "vivaldi",
            ];
            let b = browser.trim().to_ascii_lowercase();
            if ALLOWED.contains(&b.as_str()) {
                vec!["--cookies-from-browser".to_string(), b]
            } else {
                eprintln!("cookies_args: unknown browser {browser:?}, skipping");
                Vec::new()
            }
        }
        CookiesSource::File { path } => {
            // Path is a string the user typed/picked. yt-dlp will
            // error cleanly if the file doesn't exist or is malformed
            // — we don't need to pre-validate.
            vec!["--cookies".to_string(), path.clone()]
        }
    }
}

#[tauri::command]
pub fn settings_get(state: State<'_, SettingsState>) -> Result<Settings, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|e| format!("settings lock: {e}"))?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|e| format!("settings lock: {e}"))?;
        save_to_disk(&state.path, &settings)?;
        *guard = settings;
    }
    // Emit so subscribers (Download page concurrency, Library route
    // settings, etc.) refresh their copies.
    let _ = app.emit("settings:changed", ());
    Ok(())
}
