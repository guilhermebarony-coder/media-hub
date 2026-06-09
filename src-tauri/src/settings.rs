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
    /// Default cookie source, applied to any site without a specific
    /// override below. Most users leave this `None` (most public videos
    /// work without cookies, and the WRONG cookies — e.g. a logged-in
    /// YouTube jar — often break sites that would otherwise succeed).
    pub cookies_source: CookiesSource,

    /// 1.4.x — Per-platform cookie overrides. Key is the platform name
    /// from `detect_platform` ("youtube", "instagram", "tiktok",
    /// "twitter", "reddit", "pinterest", "facebook"). When a download/
    /// fetch URL matches a platform with an entry here, that source is
    /// used INSTEAD of `cookies_source`. This is the fix for "I need
    /// Instagram cookies but they break YouTube" — set the default to
    /// None and add instagram -> browser. Empty by default.
    #[serde(default)]
    pub cookies_overrides: HashMap<String, CookiesSource>,

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

    /// 1.3.x — Preferred max video height for downloads that DON'T
    /// have an explicit format picked (queue rows, extension/bridge
    /// sends, etc.). Stored as a numeric height ("1080", "720",
    /// "480") OR the empty string meaning "no cap, use source".
    /// Doesn't override the Download page's format picker — that
    /// stays explicit. Default: "1080" (most testers want NLE-
    /// friendly sizes; cinema 4K rarely useful for B-roll).
    #[serde(default = "default_preferred_max_quality")]
    pub preferred_max_quality: String,

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

    /// Scrubber jog/fine-scrub sensitivity multiplier (0.9.D UX
    /// polish). Default is 1.0 = 80 pixels per second of drag (the
    /// original tuned value). 0.5 = half-as-sensitive (160 px/sec,
    /// requires more drag), 2.0 = twice-as-sensitive (40 px/sec,
    /// reacts faster). Frame-step keyboard shortcuts ignore this —
    /// they're always exactly 1 frame.
    #[serde(default = "default_jog_sensitivity")]
    pub jog_sensitivity: f32,

    // 1.2.2 — Browser-extension bridge.
    /// Shared secret the extension presents in the
    /// `Authorization: Bearer <token>` header. Empty = unconfigured;
    /// `init()` generates one on first run if so. Regeneratable from
    /// the Settings UI (invalidates the previously-paired extension).
    #[serde(default)]
    pub bridge_token: String,
    /// TCP port the bridge HTTP server binds on (127.0.0.1 only).
    /// 47821 by default — chosen out of the IANA-unassigned range
    /// so it doesn't collide with common dev servers.
    #[serde(default = "default_bridge_port")]
    pub bridge_port: u16,
    /// Master switch — false = don't start the server. Default true.
    /// Power-user opt-out for users who don't want a listening socket
    /// even on loopback.
    #[serde(default = "default_bridge_enabled")]
    pub bridge_enabled: bool,
}

fn default_jog_sensitivity() -> f32 {
    1.0
}

fn default_preferred_max_quality() -> String {
    "1080".into()
}

fn default_bridge_port() -> u16 {
    47821
}

fn default_bridge_enabled() -> bool {
    true
}

/// 1.2.2 — Generate a 32-byte hex token for browser-extension auth.
/// Uses OS rng via `rand::random` so each call is independent and
/// cryptographically suitable. 64 hex chars is overkill for a
/// localhost-only secret but cheap and reads as "real auth" to anyone
/// inspecting the settings file.
pub fn generate_bridge_token() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cookies_source: CookiesSource::None,
            cookies_overrides: HashMap::new(),
            library_root: None,
            rename_template: String::new(),
            download_concurrency: 3,
            bandwidth_limit_kbps: None,
            default_transcode_preset: "none".into(),
            preferred_max_quality: default_preferred_max_quality(),
            onboarding_complete: false,
            last_formats: HashMap::new(),
            jog_sensitivity: 1.0,
            bridge_token: String::new(),
            bridge_port: default_bridge_port(),
            bridge_enabled: default_bridge_enabled(),
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

    // Chromium-family cookie DB lock — the original 0.8 friction.
    if lower.contains("could not copy") && lower.contains("cookie") {
        return format!(
            "Couldn't read browser cookies — the browser is open and locking its cookie database. \
             Close Chrome / Brave / Edge / Vivaldi / Opera and retry, or switch to Firefox \
             (works while open) in Settings → Sources. Raw: {raw}"
        );
    }

    // Chrome 127+ "App-Bound Encryption" DPAPI failure — yt-dlp can't
    // decrypt cookies from any Chromium browser since this Chrome
    // release. Tracked at yt-dlp/yt-dlp#10927. There's no workaround
    // we can implement; the user has to switch.
    if lower.contains("failed to decrypt with dpapi") || lower.contains("dpapi") {
        return format!(
            "Chrome / Chromium-family cookie decryption is broken in recent Chrome \
             versions (yt-dlp issue #10927 — Chrome 127+ moved to App-Bound \
             Encryption). This affects Chrome, Brave, Edge, Vivaldi, Opera. \
             • Switch to Firefox in Settings → Sources (Firefox cookies still work). \
             • Or export a cookies.txt via the \"Get cookies.txt LOCALLY\" extension \
             and use File mode. Raw: {raw}"
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

    // Age-gate. As of 1.0.3 we ALSO pass --extractor-args
    // youtube:player_client=tv,web on every call — meaning by the
    // time we see this error, both the TV client (no-cookies bypass)
    // AND the web client (cookies path) have failed. That narrows
    // the diagnosis significantly: it's no longer "you forgot to set
    // cookies," it's specifically "your cookies don't authenticate
    // you as a logged-in YouTube user."
    //
    // The owner's 2026-05-23 case turned out to be exactly this:
    // cookies.txt had full google.com auth but ZERO `.youtube.com`
    // auth cookies (LOGIN_INFO etc.) — because the source Firefox
    // profile had signed into google.com but never actually loaded
    // youtube.com. The cookies-validator chip in Settings catches
    // this proactively now; this message is the reactive backstop.
    if lower.contains("sign in to confirm your age") || lower.contains("age-restricted") {
        return format!(
            "Age-restricted video — we tried both the TV client (no-cookies bypass) \
             AND your configured cookies, and YouTube rejected both. \
             • Most likely: your cookies.txt is missing youtube.com auth tokens. \
             Check Settings → Sources for the cookies-file warning chip. The fix \
             is to re-export from a browser where you're signed in directly on \
             youtube.com (not just google.com — they're separate sessions). \
             • If using browser cookies on Chrome/Brave/Edge: the DPAPI bug \
             silently breaks cookie reads — switch to Firefox. \
             • If using Firefox: open Firefox, go to youtube.com, click your \
             avatar to confirm you're signed in (not just google.com), \
             then retry. YouTube rotates auth cookies every few days. \
             • Last resort: your Google account isn't fully age-verified \
             (some regions require ID verification at google.com/account). Raw: {raw}"
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

    // "Requested format is not available" / "No video formats found"
    // — yt-dlp's way of saying it extracted ZERO formats. yt-dlp
    // prefixes errors with `[ExtractorName]`, so we branch the
    // user-facing message on the extractor instead of assuming
    // YouTube. Pre-1.3.x this was YouTube-only and Pinterest /
    // Reddit / TikTok errors got dumped with text about Chrome
    // DPAPI bugs and YouTube watch history — actively wrong and
    // confused testers.
    if lower.contains("requested format is not available")
        || lower.contains("no video formats found")
    {
        // Pinterest: not all /pin/<id>/ URLs are videos (image pins
        // share the URL shape), the pin may be private/removed, or
        // yt-dlp's Pinterest extractor needs an upstream fix.
        if lower.contains("[pinterest]") {
            return format!(
                "yt-dlp's Pinterest extractor couldn't find any video on this pin. \
                 Likely causes: \
                 • The pin is image-only (Pinterest mixes images and videos under the same /pin/<id>/ URL shape — not every pin has a video). \
                 • The pin was deleted or made private. \
                 • An embed type our bundled yt-dlp doesn't recognize yet — try another pin to check whether it's all of Pinterest or just this one. \
                 Workaround: open the pin in your browser and save the video manually, then drop the file into the Library folder. Raw: {raw}"
            );
        }
        // Other non-YouTube sources: same family of causes, different
        // extractor. Generic friendly message.
        if lower.contains("[reddit]")
            || lower.contains("[twitter]")
            || lower.contains("[tiktok]")
            || lower.contains("[instagram]")
        {
            return format!(
                "yt-dlp couldn't find any downloadable video at this URL. \
                 Likely causes: \
                 • The post was deleted, made private, or is geo-restricted. \
                 • The post is image / text only (no video to fetch). \
                 • The site's extractor needs an upstream fix — try a different post to confirm. \
                 Workaround: download via your browser and drop the file into the Library folder. Raw: {raw}"
            );
        }
        // Default: YouTube. Original message kept verbatim because
        // it's been battle-tested against real YouTube auth failures.
        return format!(
            "yt-dlp got zero formats for this video. This means YouTube refused to \
             serve format manifests for this URL with the auth (or lack of auth) \
             we presented. \
             • If the cookies-file validator in Settings → Sources shows GREEN \
             but you still see this: it's a hard-age-gated video that YT \
             refuses even to logged-in accounts unless certain extra account \
             conditions are met (region-specific age verification, account \
             age, watch history, etc.). yt-dlp can't fix this — try a \
             different video to confirm your cookies work elsewhere, or \
             download via your browser directly and drop the file into the \
             Library folder. \
             • If the validator shows RED: fix the cookies file first (see \
             the warning chip's instructions). \
             • If using browser cookies on Chrome / Brave / Edge: the DPAPI \
             bug is silently breaking cookie reads — switch to Firefox or \
             file mode. \
             • If using browser cookies and the browser is open: close it \
             completely so yt-dlp can read the cookie DB. \
             • Public-video edge case: the format genuinely isn't offered for \
             this content (rare, e.g. livestream archives). Raw: {raw}"
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
    let mut settings = match std::fs::read_to_string(&path) {
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
    // 1.2.2 — Generate the bridge token on first ever launch (and
    // on launches after the user reset to defaults). Persist immediately
    // so the same token survives across runs — the browser extension
    // pairs once and remembers. Skipped if a token already exists.
    if settings.bridge_token.trim().is_empty() {
        settings.bridge_token = generate_bridge_token();
        if let Err(e) = save_to_disk(&path, &settings) {
            eprintln!("could not persist generated bridge_token: {e}");
        }
    }
    Ok(SettingsState {
        inner: Mutex::new(settings),
        path,
    })
}

/// 1.0.5 — set `library_root` from non-command code (e.g. the
/// library-root migration in library.rs). Mutates the in-memory state,
/// persists to disk, emits `settings:changed` so the renderer refreshes
/// its copy. Returns the old root value so callers can rollback /
/// report it.
///
/// We expose this rather than have callers reach in via the State
/// directly because (a) the save+emit pattern is easy to forget and
/// (b) keeping the serde/save logic owned by settings.rs avoids
/// duplication.
pub fn set_library_root(
    app: &AppHandle,
    state: &SettingsState,
    new_root: Option<String>,
) -> Result<Option<String>, String> {
    let old = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|e| format!("settings lock: {e}"))?;
        let old = guard.library_root.clone();
        guard.library_root = new_root;
        save_to_disk(&state.path, &guard)?;
        old
    };
    let _ = app.emit("settings:changed", ());
    Ok(old)
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
/// 1.0.3 (added) / 1.0.4 (revert) / 1.1 (dropped) — YouTube extractor args.
///
/// **Now returns an empty Vec.** History of why, so future-us doesn't
/// re-add the TV client thinking it's safe:
///
/// - 1.0.3 added `player_client=tv,web` to bypass age-gate via the TV
///   InnerTube client (which historically enforces age-gate less
///   strictly than web).
/// - 1.0.4 reverted ordering to `web,tv` after TV-first broke metadata
///   fetch on hard-age-gated videos ("Requested format is not available").
/// - 1.1 dropped TV entirely after upstream issue #12563 confirmed
///   YouTube is running an experiment where the TV (TVHTML5) client
///   returns **all videos** as DRM-protected, not just actual DRM
///   content. When the experiment is active on your account/IP, every
///   yt-dlp call that includes `tv` in player_client fails with
///   "This video is DRM protected." Even non-age-restricted public
///   videos. We hit this on 2026-05-23 PM.
///
/// The lesson: yt-dlp's default client list is the tested baseline.
/// Forcing extractor-args defaults is fragile because YouTube can
/// (and does) silently weaponize specific clients via A/B tests.
/// If a future hard-age-gate workaround needs a non-default client,
/// make it OPT-IN via a Settings toggle, never the default.
pub fn youtube_extractor_args() -> Vec<String> {
    Vec::new()
}

/// 1.0.3 — diagnostic snapshot of a cookies.txt file.
///
/// Returned by `cookies_validate` so the UI can warn the user when
/// their picked file doesn't actually contain a YouTube login. The
/// owner hit this exact failure mode on 2026-05-23: full google.com
/// auth but zero `.youtube.com`-scoped auth cookies, because the
/// Firefox profile that produced the file never had an active
/// youtube.com session. The warning lets us flag the file before the
/// user wastes a download attempt on it.
#[derive(Serialize, Debug, Clone)]
pub struct CookiesFileStatus {
    pub exists: bool,
    pub total_cookies: u32,
    pub youtube_cookies: u32,
    /// True if at least one of the auth cookies YouTube actually
    /// reads is present on `.youtube.com`. LOGIN_INFO is the
    /// definitive signal; the __Secure-*PSID variants are also
    /// auth-critical and worth checking as a fallback.
    pub has_youtube_login: bool,
    /// Human-readable summary safe to drop directly into a UI chip.
    /// Empty string when the file is healthy.
    pub warning: String,
}

/// Parse a Netscape-format cookies.txt and report whether it actually
/// looks like it could authenticate a YouTube request. Tolerant of
/// malformed lines (returns 0 counts rather than erroring) — we'd
/// rather surface a "no YT auth" warning than refuse to look.
pub fn validate_cookies_file(path: &str) -> CookiesFileStatus {
    use std::fs;

    if !std::path::Path::new(path).exists() {
        return CookiesFileStatus {
            exists: false,
            total_cookies: 0,
            youtube_cookies: 0,
            has_youtube_login: false,
            warning: format!("File not found: {path}"),
        };
    }

    let contents = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            return CookiesFileStatus {
                exists: true,
                total_cookies: 0,
                youtube_cookies: 0,
                has_youtube_login: false,
                warning: format!("Couldn't read file: {e}"),
            };
        }
    };

    // Netscape format: 7 tab-separated fields per line, header lines
    // start with `#`. Field 1 is the domain, field 6 is the cookie
    // name. Anything else we skip — including blank lines and lines
    // with fewer fields (some exporters add extra junk).
    let mut total = 0u32;
    let mut yt = 0u32;
    let mut has_login = false;

    // Auth cookies that prove a real YT login. LOGIN_INFO is the gold
    // standard; the __Secure-*PSID variants come along when the user
    // has a fully-verified Google account session active on YT.
    const YT_AUTH_NAMES: &[&str] = &[
        "LOGIN_INFO",
        "__Secure-1PSID",
        "__Secure-3PSID",
        "SAPISID",
        "__Secure-1PAPISID",
        "__Secure-3PAPISID",
    ];

    for line in contents.lines() {
        let line = line.trim_end();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 7 {
            continue;
        }
        let domain = fields[0];
        let name = fields[5];

        total += 1;

        // Match `.youtube.com` and `youtube.com` (some exporters drop
        // the leading dot). Doesn't match `www.youtube.com`-specific
        // entries but those are rare and never carry auth.
        let is_yt = domain == ".youtube.com" || domain == "youtube.com";
        if is_yt {
            yt += 1;
            if YT_AUTH_NAMES.contains(&name) {
                has_login = true;
            }
        }
    }

    let warning = if !has_login {
        if yt == 0 {
            "No YouTube cookies at all — file likely exported from the wrong domain. \
             Re-export with the \"Get cookies.txt LOCALLY\" extension while youtube.com is the active tab."
                .to_string()
        } else {
            format!(
                "Cookies for youtube.com are present ({yt}) but none of them are auth tokens \
                 (LOGIN_INFO / __Secure-*PSID missing). You're probably signed into google.com \
                 but not youtube.com in the source browser. Open youtube.com directly, sign in \
                 with your avatar, then re-export."
            )
        }
    } else {
        String::new()
    };

    CookiesFileStatus {
        exists: true,
        total_cookies: total,
        youtube_cookies: yt,
        has_youtube_login: has_login,
        warning,
    }
}

/// Tauri command wrapper for `validate_cookies_file`. The Settings UI
/// calls this whenever the user picks a new cookies path, so the
/// warning chip can render before any download is attempted.
#[tauri::command]
pub fn cookies_validate(path: String) -> CookiesFileStatus {
    validate_cookies_file(&path)
}

/// Map a URL to a coarse platform name used to look up a per-platform
/// cookie override. Returns None for anything we don't have a bucket
/// for (those fall through to the default `cookies_source`).
///
/// Substring match on the host is deliberately loose — it has to catch
/// `youtu.be`, `m.youtube.com`, `x.com`, regional Pinterest TLDs, etc.
/// without a brittle exact-host list.
pub fn detect_platform(url: &str) -> Option<&'static str> {
    // Lowercase host (or the whole string if URL parsing is overkill).
    let u = url.trim().to_ascii_lowercase();
    let host = u
        .split("://")
        .nth(1)
        .unwrap_or(&u)
        .split('/')
        .next()
        .unwrap_or(&u);
    // Order matters only where one token is a substring of another;
    // none of these collide, so first match wins.
    const TABLE: &[(&str, &str)] = &[
        ("youtube", "youtube"),
        ("youtu.be", "youtube"),
        ("instagram", "instagram"),
        ("tiktok", "tiktok"),
        ("twitter", "twitter"),
        ("x.com", "twitter"),
        ("reddit", "reddit"),
        ("redd.it", "reddit"),
        ("pinterest", "pinterest"),
        ("pin.it", "pinterest"),
        ("facebook", "facebook"),
        ("fb.watch", "facebook"),
        ("fb.com", "facebook"),
    ];
    for (needle, platform) in TABLE {
        if host.contains(needle) {
            return Some(platform);
        }
    }
    None
}

/// Turn one `CookiesSource` into the yt-dlp arg pair (or empty for
/// None / invalid). All the validation that used to live in
/// `cookies_args` now lives here so both the default source and every
/// per-platform override get the same guards.
fn source_to_args(source: &CookiesSource) -> Vec<String> {
    match source {
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
                eprintln!("[cookies] unknown browser {browser:?}, skipping");
                Vec::new()
            }
        }
        CookiesSource::File { path } => {
            // 1.2.14 — guard against empty / whitespace-only path.
            // Was passing `--cookies ""` to yt-dlp, which crashes
            // its PyInstaller bootloader with the cryptic
            // `[PYI-...:ERROR] Failed to execute script '__main__'`
            // (no Python traceback because the bootloader dies
            // before Python init completes). Real-world cause:
            // user picks "File" in the Settings cookies picker but
            // hasn't selected a path yet. Treat as No cookies.
            let trimmed = path.trim();
            if trimmed.is_empty() {
                eprintln!("[cookies] file mode with empty path — treating as None");
                return Vec::new();
            }
            // File-path sanity check — yt-dlp would also fail, but we
            // log here so the dev console shows the actual issue
            // (file missing? non-ASCII path the shell mangled?).
            if !std::path::Path::new(trimmed).exists() {
                eprintln!("[cookies] WARN file mode but path doesn't exist: {trimmed:?} — treating as None");
                return Vec::new();
            }
            vec!["--cookies".to_string(), trimmed.to_string()]
        }
    }
}

/// Resolve the cookie args for a SPECIFIC url: a per-platform override
/// if one is configured for the URL's platform, otherwise the default
/// `cookies_source`. This is the fix for cross-site cookie bleed
/// (Instagram cookies breaking YouTube downloads, etc.).
pub fn cookies_args_for(state: &SettingsState, url: &str) -> Vec<String> {
    let guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let platform = detect_platform(url);
    let (source, origin): (&CookiesSource, String) = match platform
        .and_then(|p| guard.cookies_overrides.get(p).map(|s| (s, p)))
    {
        Some((s, p)) => (s, format!("override:{p}")),
        None => (&guard.cookies_source, "default".to_string()),
    };
    let args = source_to_args(source);
    // Diagnostic — shows which rule won and what we're passing.
    // Visible in the `npm run tauri dev` terminal.
    if args.is_empty() {
        eprintln!("[cookies] {origin} -> none; yt-dlp runs without cookies");
    } else {
        eprintln!("[cookies] {origin} -> {args:?}");
    }
    args
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
