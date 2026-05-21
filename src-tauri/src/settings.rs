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
        }
    }
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
