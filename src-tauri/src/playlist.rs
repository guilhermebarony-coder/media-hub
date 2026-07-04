//! Playlist enumeration (1.1) — extracted from lib.rs (1.12.1 monolith
//! split). `yt-dlp --flat-playlist -J <url>` lists a playlist's videos
//! without per-video format extraction (fast); the UI renders a multi-
//! select picker, and each chosen entry then runs the normal
//! yt_fetch_metadata + yt_download pipeline as its own job.

use serde::Serialize;
use tauri::AppHandle;

use crate::settings;
use crate::{js_runtime_args, resolve_cookie_args, yt_dlp_capture};

#[derive(Serialize, Debug, Clone)]
pub struct PlaylistInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub entry_count: u32,
    pub entries: Vec<PlaylistEntry>,
    /// True when we truncated the result. Frontend should surface a
    /// "showing first N of M" notice + an option to load more (later).
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    /// The per-video URL the queue should enqueue. yt-dlp's
    /// `--flat-playlist` populates `url` (canonical watch URL) or
    /// `webpage_url`; we prefer the former, fall back to the latter,
    /// or synthesize from `id` as last resort.
    pub url: String,
    /// True when yt-dlp marked the entry as unavailable (private,
    /// deleted, region-blocked). UI grays these out and skips them
    /// from default selection.
    pub unavailable: bool,
}

const PLAYLIST_CAP: usize = 500;

#[derive(serde::Deserialize, Debug)]
struct RawPlaylist {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    entries: Vec<RawPlaylistEntry>,
    /// yt-dlp's `playlist_count` when present is the authoritative
    /// total. Fall back to entries.len() when missing.
    #[serde(default)]
    playlist_count: Option<u32>,
}

#[derive(serde::Deserialize, Debug)]
struct RawPlaylistEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnails: Vec<RawThumbnail>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    /// yt-dlp sets `availability` to e.g. "private", "unlisted",
    /// "needs_subscription". Anything not None and not "public" we
    /// flag as potentially unavailable.
    #[serde(default)]
    availability: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct RawThumbnail {
    #[serde(default)]
    url: Option<String>,
}

#[tauri::command]
pub async fn yt_fetch_playlist(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
) -> Result<PlaylistInfo, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    // Same cookies + extractor-args plumbing as the metadata fetch so
    // private / members-only / region-flavored playlists work the same
    // way as the rest of the app. cookies_args_for applies the per-site
    // rule; yt_dlp_capture adds the retry-without-cookies fallback.
    let cookies = resolve_cookie_args(&app, &settings, trimmed);
    let yt_args = settings::youtube_extractor_args();
    let mut opts: Vec<String> = vec![
        "-J".into(),             // dump as single JSON object (playlist + entries)
        "--flat-playlist".into(),// skip per-video format extraction (huge speedup)
        "--no-warnings".into(),
        "--no-call-home".into(),
        "--socket-timeout".into(), "30".into(),
    ];
    opts.extend(yt_args.iter().cloned());
    opts.extend(js_runtime_args(&app)); // Deno JS runtime for sig/nsig solving

    let out = yt_dlp_capture(&app, &opts, &cookies, trimmed).await?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr
            .lines()
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("(no stderr)")
            .to_string();
        return Err(settings::translate_ytdlp_error(&tail));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let raw: RawPlaylist = serde_json::from_str(&stdout)
        .map_err(|e| format!("playlist JSON parse failed: {e}"))?;

    let total = raw.playlist_count.unwrap_or(raw.entries.len() as u32);
    let truncated = raw.entries.len() > PLAYLIST_CAP;
    let take_n = raw.entries.len().min(PLAYLIST_CAP);

    let entries: Vec<PlaylistEntry> = raw
        .entries
        .into_iter()
        .take(take_n)
        .map(|e| {
            let id = e.id.clone().unwrap_or_default();
            // Prefer the flat-playlist `url` (canonical watch URL),
            // then `webpage_url`, then synthesize from id.
            let url = e
                .url
                .clone()
                .or(e.webpage_url.clone())
                .unwrap_or_else(|| {
                    if id.is_empty() {
                        String::new()
                    } else {
                        format!("https://www.youtube.com/watch?v={id}")
                    }
                });
            // Pick the largest-looking thumbnail when an array was
            // provided (yt-dlp orders smallest-first usually, but we
            // just take the last one — last-is-largest is the
            // long-standing yt-dlp convention).
            let thumbnail = e
                .thumbnail
                .clone()
                .or_else(|| e.thumbnails.last().and_then(|t| t.url.clone()));
            let unavailable = e
                .availability
                .as_deref()
                .map(|a| !matches!(a, "public" | ""))
                .unwrap_or(false);
            PlaylistEntry {
                id,
                title: e.title.unwrap_or_else(|| "(no title)".to_string()),
                channel: e.channel.or(e.uploader),
                duration_sec: e.duration,
                thumbnail,
                url,
                unavailable,
            }
        })
        // Drop entries with no usable URL — they'd just fail at queue time.
        .filter(|e| !e.url.is_empty())
        .collect();

    Ok(PlaylistInfo {
        id: raw.id.unwrap_or_default(),
        title: raw
            .title
            .or(raw.uploader.clone())
            .or(raw.channel)
            .unwrap_or_else(|| "(untitled playlist)".to_string()),
        uploader: raw.uploader,
        entry_count: total,
        entries,
        truncated,
    })
}
