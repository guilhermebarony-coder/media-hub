//! Single-URL metadata fetch (0.2) — extracted from lib.rs (1.12.1 monolith
//! split). `yt-dlp -j` dumps one fat JSON object per video; we project it to
//! the ~10 fields the UI renders (+ a filtered format list, chapters, and a
//! storyboard for the scrubber). The shared yt-dlp invocation helpers
//! (yt_dlp_capture / js_runtime_args / resolve_cookie_args) still live in
//! lib.rs and are used here via `crate::`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::settings;
use crate::{js_runtime_args, resolve_cookie_args, yt_dlp_capture};

#[derive(Serialize)]
pub struct VideoMetadata {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    pub upload_date: Option<String>, // yt-dlp gives YYYYMMDD
    pub webpage_url: String,
    pub view_count: Option<u64>,
    pub formats: Vec<FormatOption>,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
    pub storyboard: Option<Storyboard>,
    /// 1.13.4 — every media item of a multi-item post (Instagram
    /// carousel, tweet carrying several videos). Empty for ordinary
    /// single-video URLs; the UI only shows a picker when len() > 1.
    /// The fields above describe items[0] so the card renders the same
    /// way it always has before the user picks something else.
    #[serde(default)]
    pub items: Vec<PostItem>,
}

/// One selectable media item of a multi-item post. `index` is yt-dlp's
/// 1-based `playlist_index`, which is what `--playlist-items` takes —
/// and it counts PHOTOS too, so a carousel of 10 slides whose #6 is a
/// still yields indices 1-5,7-10. Never renumber it.
#[derive(Serialize)]
pub struct PostItem {
    pub index: u32,
    pub id: String,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    pub formats: Vec<FormatOption>,
}

#[derive(Serialize, Clone)]
pub struct FormatOption {
    pub id: String,
    pub ext: String,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub filesize_bytes: Option<u64>,
    pub note: Option<String>, // yt-dlp format_note ("1080p", "tiny", etc.)
    pub has_video: bool,
    pub has_audio: bool,
}

/// A YouTube chapter / marker. Times in seconds.
#[derive(Serialize)]
pub struct Chapter {
    pub start_sec: f64,
    pub end_sec: f64,
    pub title: String,
}

/// Storyboard manifest — sprite sheets of thumbnails for hover-scrubbing.
/// Each fragment is one sprite image holding rows*cols tiles, each
/// `tile_w`x`tile_h`, covering `duration` seconds of the timeline.
#[derive(Serialize)]
pub struct Storyboard {
    pub tile_w: u32,
    pub tile_h: u32,
    pub rows: u32,
    pub cols: u32,
    pub fragments: Vec<StoryFragment>,
}

#[derive(Serialize)]
pub struct StoryFragment {
    pub url: String,
    pub duration: f64,
}

/// Raw yt-dlp -j shape, deserialized partially. We only declare fields we
/// read; serde_json ignores the rest.
#[derive(Deserialize)]
struct RawYtDlp {
    id: String,
    title: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    upload_date: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    #[serde(default)]
    view_count: Option<u64>,
    #[serde(default)]
    formats: Vec<RawFormat>,
    #[serde(default, deserialize_with = "null_default")]
    chapters: Vec<RawChapter>,
    /// Present only when the URL resolved to several entries (carousel /
    /// multi-video post). Gaps are normal — see PostItem::index.
    #[serde(default)]
    playlist_index: Option<u32>,
}

/// Deserialize a Vec field that yt-dlp may emit as JSON `null` rather than
/// omitting it (e.g. `"chapters": null` for videos with no chapters, or a
/// null `fragments`). Plain `#[serde(default)]` only covers a *missing*
/// key — an explicit `null` still errors with "invalid type: null,
/// expected a sequence". This maps null (and missing) to the default.
fn null_default<'de, D, T>(de: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(de)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct RawChapter {
    #[serde(default)]
    start_time: Option<f64>,
    #[serde(default)]
    end_time: Option<f64>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
struct RawFragment {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
}

#[derive(Deserialize)]
struct RawFormat {
    format_id: String,
    #[serde(default)]
    ext: Option<String>,
    #[serde(default)]
    vcodec: Option<String>,
    #[serde(default)]
    acodec: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    filesize: Option<u64>,
    #[serde(default)]
    filesize_approx: Option<u64>,
    #[serde(default)]
    format_note: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
    // Storyboard-only fields (present when protocol == "mhtml").
    #[serde(default)]
    rows: Option<u32>,
    #[serde(default)]
    columns: Option<u32>,
    #[serde(default, deserialize_with = "null_default")]
    fragments: Vec<RawFragment>,
}

fn project_format(f: RawFormat) -> Option<FormatOption> {
    // Skip storyboard / mhtml previews — not real media.
    if matches!(f.protocol.as_deref(), Some("mhtml")) {
        return None;
    }
    let has_video = f.vcodec.as_deref().map_or(false, |v| v != "none");
    let has_audio = f.acodec.as_deref().map_or(false, |a| a != "none");
    // Drop pure-storyboard formats (no audio + no video usually means "thumbnails").
    if !has_video && !has_audio {
        return None;
    }
    Some(FormatOption {
        id: f.format_id,
        ext: f.ext.unwrap_or_default(),
        vcodec: f.vcodec,
        acodec: f.acodec,
        width: f.width,
        height: f.height,
        fps: f.fps,
        filesize_bytes: f.filesize.or(f.filesize_approx),
        note: f.format_note,
        has_video,
        has_audio,
    })
}

/// Pick the best storyboard from the raw format list for hover-scrubbing.
/// Storyboards are mhtml formats with rows/cols/fragments. We want the
/// sharpest tiles that aren't absurdly large, so we choose the largest
/// tile width <= 240px, falling back to the largest available.
fn pick_storyboard(formats: &[RawFormat]) -> Option<Storyboard> {
    let mut boards: Vec<&RawFormat> = formats
        .iter()
        .filter(|f| {
            matches!(f.protocol.as_deref(), Some("mhtml"))
                && f.rows.unwrap_or(0) > 0
                && f.columns.unwrap_or(0) > 0
                && !f.fragments.is_empty()
                && f.width.unwrap_or(0) > 0
                && f.height.unwrap_or(0) > 0
        })
        .collect();
    if boards.is_empty() {
        return None;
    }
    // Largest tile width first.
    boards.sort_by_key(|f| std::cmp::Reverse(f.width.unwrap_or(0)));
    let best = boards
        .iter()
        .find(|f| f.width.unwrap_or(0) <= 240)
        .copied()
        .unwrap_or(boards[boards.len() - 1]);

    let fragments: Vec<StoryFragment> = best
        .fragments
        .iter()
        .filter_map(|fr| {
            let url = fr.url.clone()?;
            Some(StoryFragment {
                url,
                // yt-dlp gives a per-fragment duration; default to 0 (the
                // frontend treats a 0 as "split evenly" via total dur).
                duration: fr.duration.unwrap_or(0.0),
            })
        })
        .collect();
    if fragments.is_empty() {
        return None;
    }
    Some(Storyboard {
        tile_w: best.width.unwrap_or(0),
        tile_h: best.height.unwrap_or(0),
        rows: best.rows.unwrap_or(0),
        cols: best.columns.unwrap_or(0),
        fragments,
    })
}

#[tauri::command]
pub async fn yt_fetch_metadata(
    app: AppHandle,
    settings: tauri::State<'_, settings::SettingsState>,
    url: String,
) -> Result<VideoMetadata, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    // Cookies extras (0.8.B / 1.4.x per-site): empty when the resolved
    // source is None, otherwise --cookies-from-browser <name> or
    // --cookies <path>. cookies_args_for picks a per-platform override
    // (e.g. instagram) if configured, else the default source.
    let cookies = resolve_cookie_args(&app, &settings, trimmed);
    // 1.0.3 — TV client first, web fallback. Lets a chunk of
    // age-restricted videos resolve metadata without cookies at all.
    let yt_args = settings::youtube_extractor_args();
    let mut opts: Vec<String> = vec![
        "-j".into(),             // dump single JSON object, no download
        "--no-playlist".into(),  // never expand playlists at this stage
        "--no-warnings".into(),  // keep stderr clean
        "--no-call-home".into(), // be polite, skip telemetry
        "--socket-timeout".into(), "15".into(),
    ];
    opts.extend(yt_args.iter().cloned());
    opts.extend(js_runtime_args(&app)); // Deno JS runtime for sig/nsig solving

    // 1.4.x — auto-retry without cookies if the cookie'd attempt fails.
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
    // 1.2.7 — yt-dlp's `-j` flag emits ONE JSON object per video,
    // newline-separated. For multi-video tweets (e.g. an X post
    // containing 3 videos), stdout is 3 JSON objects in a row;
    // serde_json::from_str only consumes the first and errors out
    // with "trailing characters at line N column 1" on the rest.
    //
    // Streaming parser to the rescue — serde only consumes the first
    // value, so we iterate to collect every entry.
    //
    // 1.13.4 — we used to keep entry 1 and drop the rest, which made the
    // card lie about Instagram carousels: it showed one video while the
    // download (yt-dlp enumerates the whole post — `--no-playlist` does
    // NOT collapse a carousel) pulled all 10 slides. Now every entry
    // becomes a selectable item and the UI sends `--playlist-items`.
    // Costs nothing extra: this same call already extracted them all.
    let mut raws: Vec<RawYtDlp> = Vec::new();
    for parsed in serde_json::Deserializer::from_str(&stdout).into_iter::<RawYtDlp>() {
        match parsed {
            Ok(r) => raws.push(r),
            // A malformed FIRST value is fatal; later ones we keep what
            // we have (a photo slide or a geo-blocked entry shouldn't
            // sink the whole fetch).
            Err(e) if raws.is_empty() => return Err(format!("JSON parse failed: {e}")),
            Err(_) => break,
        }
    }
    if raws.is_empty() {
        return Err("yt-dlp returned no JSON".to_string());
    }
    let rest = raws.split_off(1);
    let raw = raws.pop().expect("checked non-empty above");
    let first_index = raw.playlist_index.unwrap_or(1);

    // Extract storyboards + chapters before raw.formats is consumed.
    let storyboard = pick_storyboard(&raw.formats);
    let chapters: Vec<Chapter> = raw
        .chapters
        .into_iter()
        .filter_map(|c| {
            let start = c.start_time?;
            Some(Chapter {
                start_sec: start,
                end_sec: c.end_time.unwrap_or(start),
                title: c.title.unwrap_or_else(|| "Chapter".into()),
            })
        })
        .collect();
    let formats: Vec<FormatOption> = raw.formats.into_iter().filter_map(project_format).collect();

    // Single-video URLs keep an empty `items` so the UI stays untouched.
    let items: Vec<PostItem> = if rest.is_empty() {
        Vec::new()
    } else {
        let mut v = Vec::with_capacity(rest.len() + 1);
        v.push(PostItem {
            index: first_index,
            id: raw.id.clone(),
            title: raw.title.clone(),
            duration_sec: raw.duration,
            thumbnail: raw.thumbnail.clone(),
            formats: formats.clone(),
        });
        for (i, r) in rest.into_iter().enumerate() {
            v.push(PostItem {
                // Fall back to positional numbering only if yt-dlp gave
                // us no index at all (shouldn't happen for real posts).
                index: r.playlist_index.unwrap_or((i + 2) as u32),
                id: r.id,
                title: r.title,
                duration_sec: r.duration,
                thumbnail: r.thumbnail,
                formats: r.formats.into_iter().filter_map(project_format).collect(),
            });
        }
        v
    };

    Ok(VideoMetadata {
        id: raw.id,
        title: raw.title,
        channel: raw.channel.or(raw.uploader).unwrap_or_else(|| "(unknown)".into()),
        duration_sec: raw.duration,
        thumbnail: raw.thumbnail,
        upload_date: raw.upload_date,
        webpage_url: raw.webpage_url.unwrap_or(trimmed.to_string()),
        view_count: raw.view_count,
        formats,
        chapters,
        storyboard,
        items,
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 1.13.4 — an Instagram carousel comes back as one JSON object per
    /// slide, each carrying its own `playlist_index`. We used to keep
    /// the first and drop the rest, so the card showed one video while
    /// the download pulled the whole post. Locks both the streaming
    /// parse and the field name `--playlist-items` is fed from.
    #[test]
    fn metadata_collects_every_entry_of_a_multi_item_post() {
        let stdout = concat!(
            r#"{"id":"a","title":"t","playlist_index":1,"duration":2.3}"#,
            "\n",
            r#"{"id":"b","title":"t","playlist_index":2,"duration":1.4}"#,
            "\n",
            // Index 3 is a photo slide: yt-dlp errors on stderr and emits
            // no object, so indices legitimately skip.
            r#"{"id":"c","title":"t","playlist_index":4,"duration":13.25}"#,
            "\n",
        );
        let raws: Vec<RawYtDlp> = serde_json::Deserializer::from_str(stdout)
            .into_iter::<RawYtDlp>()
            .map(|r| r.expect("each entry must parse"))
            .collect();
        assert_eq!(raws.len(), 3, "all entries must survive, not just the first");
        let idx: Vec<Option<u32>> = raws.iter().map(|r| r.playlist_index).collect();
        assert_eq!(idx, vec![Some(1), Some(2), Some(4)], "gaps must be preserved");
    }

    /// A plain single-video URL has no playlist_index — that's what makes
    /// `items` stay empty and the UI skip the picker entirely.
    #[test]
    fn metadata_single_video_has_no_playlist_index() {
        let raw: RawYtDlp = serde_json::from_str(r#"{"id":"a","title":"t"}"#).unwrap();
        assert_eq!(raw.playlist_index, None);
    }

    #[test]
    fn metadata_tolerates_null_chapters() {
        let json = r#"{"id":"abc","title":"t","chapters":null}"#;
        let raw: RawYtDlp = serde_json::from_str(json).expect("null chapters must parse");
        assert!(raw.chapters.is_empty());
    }

    #[test]
    fn metadata_handles_missing_and_present_chapters() {
        let missing: RawYtDlp = serde_json::from_str(r#"{"id":"a","title":"t"}"#).unwrap();
        assert!(missing.chapters.is_empty());
        let present: RawYtDlp = serde_json::from_str(
            r#"{"id":"a","title":"t","chapters":[{"start_time":0.0,"end_time":5.0,"title":"Intro"}]}"#,
        )
        .unwrap();
        assert_eq!(present.chapters.len(), 1);
    }

    #[test]
    fn metadata_tolerates_null_fragments_in_formats() {
        let json = r#"{"id":"a","title":"t","formats":[
            {"format_id":"18","fragments":null},
            {"format_id":"sb0","protocol":"mhtml","rows":10,"columns":10,
             "width":160,"height":90,
             "fragments":[{"url":"http://x/0.jpg","duration":10.0}]}
        ]}"#;
        let raw: RawYtDlp = serde_json::from_str(json).expect("null fragments must parse");
        let sb = pick_storyboard(&raw.formats).expect("should pick the mhtml board");
        assert_eq!((sb.tile_w, sb.rows, sb.cols), (160, 10, 10));
        assert_eq!(sb.fragments.len(), 1);
    }

    #[test]
    fn storyboard_absent_when_no_mhtml_format() {
        let raw: RawYtDlp = serde_json::from_str(
            r#"{"id":"a","title":"t","formats":[{"format_id":"18","vcodec":"avc1","acodec":"mp4a"}]}"#,
        )
        .unwrap();
        assert!(pick_storyboard(&raw.formats).is_none());
    }
}
