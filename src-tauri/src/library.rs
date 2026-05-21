// Media Hub — library persistence layer.
//
// SQLite-backed asset metadata via sqlx. Single `assets` table for now;
// tags / projects / FTS search come in later migrations. Schema lives
// in `migrations/001_initial.sql` and is embedded into the binary at
// compile time via include_str! so we don't need to ship the .sql file
// separately at runtime.
//
// DB path: ~/Media Hub/library.db — alongside the Downloads dir to
// keep all owner data under a single rooted folder the user can back
// up or relocate as a unit.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

// =====================================================================
// Types
// =====================================================================

/// Input payload for inserting a new asset. The renderer fills as much
/// as it knows; missing fields land as NULL.
#[derive(Deserialize, Debug, Clone)]
pub struct AssetInput {
    pub source_url: String,
    pub platform: String,
    pub video_id: Option<String>,
    pub channel: Option<String>,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub in_sec: Option<f64>,
    pub out_sec: Option<f64>,
    pub file_path: String,
    pub file_size: Option<i64>,
    pub container: Option<String>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub transcoded_to: Option<String>,
    pub thumbnail_url: Option<String>,
    /// Scope this asset to a project. NULL = Library. Phase A: the
    /// Download flow doesn't pass this yet (always Library); Phase B
    /// wires it to the active-project picker.
    pub project_id: Option<String>,
}

/// 1:1 with the `assets` table — what sqlx::FromRow can directly decode.
#[derive(Debug, Clone, sqlx::FromRow)]
struct AssetRow {
    pub id: String,
    pub source_url: String,
    pub platform: String,
    pub video_id: Option<String>,
    pub channel: Option<String>,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub in_sec: Option<f64>,
    pub out_sec: Option<f64>,
    pub file_path: String,
    pub file_size: Option<i64>,
    pub container: Option<String>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub transcoded_to: Option<String>,
    pub thumbnail_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub project_id: Option<String>,
    pub downloaded_at: i64,
}

/// What we serialize to the renderer — AssetRow + denormalized tag list
/// (loaded via a second query in library_list so we don't need GROUP_CONCAT
/// gymnastics in SQL).
#[derive(Serialize, Debug, Clone)]
pub struct Asset {
    pub id: String,
    pub source_url: String,
    pub platform: String,
    pub video_id: Option<String>,
    pub channel: Option<String>,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub in_sec: Option<f64>,
    pub out_sec: Option<f64>,
    pub file_path: String,
    pub file_size: Option<i64>,
    pub container: Option<String>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub transcoded_to: Option<String>,
    pub thumbnail_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub project_id: Option<String>,
    pub downloaded_at: i64,
    pub tags: Vec<String>,
}

impl From<AssetRow> for Asset {
    fn from(r: AssetRow) -> Self {
        Self {
            id: r.id,
            source_url: r.source_url,
            platform: r.platform,
            video_id: r.video_id,
            channel: r.channel,
            title: r.title,
            duration_sec: r.duration_sec,
            in_sec: r.in_sec,
            out_sec: r.out_sec,
            file_path: r.file_path,
            file_size: r.file_size,
            container: r.container,
            codec_video: r.codec_video,
            codec_audio: r.codec_audio,
            width: r.width,
            height: r.height,
            fps: r.fps,
            transcoded_to: r.transcoded_to,
            thumbnail_url: r.thumbnail_url,
            thumbnail_path: r.thumbnail_path,
            project_id: r.project_id,
            downloaded_at: r.downloaded_at,
            tags: Vec::new(),
        }
    }
}

#[derive(Serialize, Debug, Clone, sqlx::FromRow)]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

/// What we serialize to the renderer — a project row + denormalized asset
/// count. The count drives the UI "(N clips)" hint without a separate
/// round-trip per project.
#[derive(Serialize, Debug, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: i64,
    pub asset_count: i64,
}

/// Scope filter for `library_list` and `library_count`. Tagged enum
/// keeps the JSON shape unambiguous from the renderer's side.
///
///   { kind: "any" }                 → no filter, all rows
///   { kind: "library" }             → project_id IS NULL
///   { kind: "project", id: "..." }  → project_id = id
///
/// Defaults to Any when omitted — matches the pre-projects behavior so
/// older callers (and the Download page, which doesn't care about
/// scope) keep working.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryScope {
    Any,
    Library,
    Project { id: String },
}

impl Default for LibraryScope {
    fn default() -> Self {
        LibraryScope::Any
    }
}

/// Held in Tauri's State<>. Single SqlitePool, shared across commands.
pub struct LibraryState {
    pub pool: SqlitePool,
}

// =====================================================================
// Init — runs once at app startup
// =====================================================================

/// Split a multi-statement SQL blob into individual statements.
///
/// Strips `--` line comments BEFORE splitting on `;` — without this,
/// a semicolon inside a comment (e.g. `-- size; not updated`) would
/// chop the comment in half and feed the second piece to the parser
/// as SQL, producing a syntax error.
///
/// Doesn't handle `--` inside string literals — our schema doesn't
/// have any, and supporting that would require a real tokenizer.
fn split_sql_statements(sql: &str) -> Vec<String> {
    let stripped: String = sql
        .lines()
        .map(|line| match line.find("--") {
            Some(idx) => &line[..idx],
            None => line,
        })
        .collect::<Vec<&str>>()
        .join("\n");
    stripped
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Open (or create) the library DB at the canonical path and run the
/// initial migration. Idempotent — safe to call on every launch.
pub async fn init(app: &AppHandle) -> Result<LibraryState, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let dir = home.join("Media Hub");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create library dir: {e}"))?;
    let db_path: PathBuf = dir.join("library.db");

    // WAL mode + busy_timeout makes concurrent reads (e.g. UI listing
    // while a download finishes and inserts) non-blocking.
    // foreign_keys=on enables the CASCADE delete on asset_tags when
    // an asset is removed; SQLite leaves FKs off by default.
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| format!("open library db: {e}"))?;

    // Migrations are idempotent (CREATE ... IF NOT EXISTS) so we just
    // run all of them every time. When migrations need to alter data,
    // we'll switch to a real migrations table.
    for schema in [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_tags.sql"),
        include_str!("../migrations/003_thumbnails.sql"),
        include_str!("../migrations/004_projects.sql"),
    ] {
        for stmt in split_sql_statements(schema) {
            if let Err(e) = sqlx::query(&stmt).execute(&pool).await {
                let s = e.to_string();
                // SQLite's `ALTER TABLE ADD COLUMN` has no IF NOT EXISTS.
                // The migration loop is idempotent for CREATE statements
                // but ALTER errors on second launch. Until we adopt a
                // real migrations table, swallow that specific error.
                if s.contains("duplicate column name") {
                    continue;
                }
                return Err(format!("apply schema: {s}"));
            }
        }
    }

    Ok(LibraryState { pool })
}

// =====================================================================
// Tauri commands
// =====================================================================

/// Fetch tags for a set of asset ids in one query, returning a map.
/// Keeps `library_list` to two queries regardless of asset count.
async fn load_tags_for(
    pool: &SqlitePool,
    ids: &[String],
) -> Result<std::collections::HashMap<String, Vec<String>>, sqlx::Error> {
    use std::collections::HashMap;
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    // Build an `IN (?, ?, ?...)` clause dynamically — sqlx doesn't have
    // first-class support for binding a Vec to a single placeholder.
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        r#"SELECT at.asset_id, t.name
           FROM asset_tags at
           JOIN tags t ON t.id = at.tag_id
           WHERE at.asset_id IN ({})
           ORDER BY t.name COLLATE NOCASE"#,
        placeholders
    );
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(pool).await?;
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (asset_id, name) in rows {
        out.entry(asset_id).or_default().push(name);
    }
    Ok(out)
}

#[tauri::command]
pub async fn library_insert(
    app: AppHandle,
    state: State<'_, LibraryState>,
    input: AssetInput,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    sqlx::query(
        r#"INSERT INTO assets
           (id, source_url, platform, video_id, channel, title,
            duration_sec, in_sec, out_sec,
            file_path, file_size, container,
            codec_video, codec_audio, width, height, fps,
            transcoded_to, thumbnail_url, project_id, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(&input.source_url)
    .bind(&input.platform)
    .bind(&input.video_id)
    .bind(&input.channel)
    .bind(&input.title)
    .bind(input.duration_sec)
    .bind(input.in_sec)
    .bind(input.out_sec)
    .bind(&input.file_path)
    .bind(input.file_size)
    .bind(&input.container)
    .bind(&input.codec_video)
    .bind(&input.codec_audio)
    .bind(input.width)
    .bind(input.height)
    .bind(input.fps)
    .bind(&input.transcoded_to)
    .bind(&input.thumbnail_url)
    .bind(&input.project_id)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("library_insert: {e}"))?;

    let _ = app.emit("library:changed", ());
    Ok(id)
}

/// Filters supported by library_list. All optional; ANDed together.
#[derive(Deserialize, Debug, Default)]
#[serde(default)]
pub struct LibraryFilters {
    /// Free-text query — matches against title and channel via LIKE.
    /// Case-insensitive. NULL/empty means "no filter."
    pub query: Option<String>,
    /// Asset must have ALL of these tag names (AND semantics, matches
    /// the typical "narrow down by adding more chips" UX).
    pub tags: Option<Vec<String>>,
    /// Project scope filter. Defaults to Any (no filter) when omitted.
    pub scope: Option<LibraryScope>,
    pub limit: Option<i64>,
}

#[tauri::command]
pub async fn library_list(
    state: State<'_, LibraryState>,
    filters: Option<LibraryFilters>,
) -> Result<Vec<Asset>, String> {
    let filters = filters.unwrap_or_default();
    let limit = filters.limit.unwrap_or(500).clamp(1, 5000);

    // Build the WHERE clause dynamically. Each filter is an optional
    // AND. We bind values in the same order we push them, so the
    // placeholder count always matches.
    let mut where_clauses: Vec<String> = Vec::new();
    let mut bindings: Vec<String> = Vec::new();

    if let Some(q) = filters.query.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        // ESCAPE '\' lets the user search literal % and _ if they want;
        // we don't expose that affordance yet but the foundation is here.
        where_clauses.push(
            "(LOWER(a.title) LIKE ? OR LOWER(COALESCE(a.channel,'')) LIKE ?)".into(),
        );
        let needle = format!("%{}%", q.to_lowercase());
        bindings.push(needle.clone());
        bindings.push(needle);
    }

    let tag_filter = filters
        .tags
        .as_ref()
        .map(|v| v.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .filter(|v| !v.is_empty());
    if let Some(tags) = tag_filter.as_ref() {
        // For each required tag, EXISTS a join match. ANDs all of them.
        for tag in tags {
            where_clauses.push(
                "EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id = a.id AND t.name = ? COLLATE NOCASE)".into(),
            );
            bindings.push(tag.clone());
        }
    }

    // Scope filter. `Any` adds no clause; `Library` and `Project` are
    // mutually exclusive predicates on assets.project_id.
    match filters.scope.unwrap_or_default() {
        LibraryScope::Any => {}
        LibraryScope::Library => {
            where_clauses.push("a.project_id IS NULL".into());
        }
        LibraryScope::Project { id } => {
            where_clauses.push("a.project_id = ?".into());
            bindings.push(id);
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let sql = format!(
        r#"SELECT a.* FROM assets a {} ORDER BY a.downloaded_at DESC LIMIT ?"#,
        where_sql,
    );

    let mut q = sqlx::query_as::<_, AssetRow>(&sql);
    for b in &bindings {
        q = q.bind(b);
    }
    q = q.bind(limit);

    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("library_list: {e}"))?;

    // Second pass: load tags for the returned assets and attach.
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let tag_map = load_tags_for(&state.pool, &ids)
        .await
        .map_err(|e| format!("library_list tags: {e}"))?;

    let assets = rows
        .into_iter()
        .map(|r| {
            let mut a: Asset = r.into();
            if let Some(tags) = tag_map.get(&a.id) {
                a.tags = tags.clone();
            }
            a
        })
        .collect();
    Ok(assets)
}

#[tauri::command]
pub async fn library_count(
    state: State<'_, LibraryState>,
    scope: Option<LibraryScope>,
) -> Result<i64, String> {
    // Mirrors the scope semantics of library_list. Renderer uses this
    // for the "X clips" header counter, which should reflect the
    // current active project, not the global asset count.
    let (sql, bind_id): (&str, Option<String>) = match scope.unwrap_or_default() {
        LibraryScope::Any => ("SELECT COUNT(*) FROM assets", None),
        LibraryScope::Library => (
            "SELECT COUNT(*) FROM assets WHERE project_id IS NULL",
            None,
        ),
        LibraryScope::Project { id } => (
            "SELECT COUNT(*) FROM assets WHERE project_id = ?",
            Some(id),
        ),
    };
    let mut q = sqlx::query_as::<_, (i64,)>(sql);
    if let Some(id) = bind_id {
        q = q.bind(id);
    }
    let row = q
        .fetch_one(&state.pool)
        .await
        .map_err(|e| format!("library_count: {e}"))?;
    Ok(row.0)
}

#[tauri::command]
pub async fn library_delete(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    delete_file: Option<bool>,
) -> Result<(), String> {
    // Default behavior (delete_file = false / None): remove only the
    // DB row. File on disk is left alone — the user can manually
    // delete it from Explorer/Finder. asset_tags rows + project_id
    // refs go via ON DELETE CASCADE / SET NULL.
    //
    // With delete_file = true: also remove the file. We grab the
    // path BEFORE the DELETE so we still have it after the row is
    // gone. Missing files are non-fatal (the row is gone anyway —
    // arguably the file was already cleaned up out-of-band).
    let should_delete_file = delete_file.unwrap_or(false);
    let path: Option<(String,)> = if should_delete_file {
        sqlx::query_as("SELECT file_path FROM assets WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| format!("library_delete fetch path: {e}"))?
    } else {
        None
    };

    sqlx::query("DELETE FROM assets WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("library_delete: {e}"))?;

    if let Some((file_path,)) = path {
        if let Err(e) = std::fs::remove_file(&file_path) {
            // Don't fail the whole op — DB row is gone, that's the
            // primary user-visible action. Just warn in logs.
            eprintln!("library_delete: removing {file_path}: {e}");
        }
        // Best-effort thumbnail cleanup too.
        if let Ok(home) = app.path().home_dir() {
            let thumb = home
                .join("Media Hub")
                .join("_thumbnails")
                .join(format!("{id}.jpg"));
            let _ = std::fs::remove_file(thumb);
        }
    }

    let _ = app.emit("library:changed", ());
    Ok(())
}

/// Replace an asset's full tag set in one atomic operation. The
/// renderer sends the entire desired list and we diff/sync — no
/// per-tag add/remove commands needed, fewer round trips for the
/// common "edit chips inline" interaction.
#[tauri::command]
pub async fn tag_set_for_asset(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let normalized: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| format!("begin tx: {e}"))?;

    // Wipe existing links — simpler than diffing.
    sqlx::query("DELETE FROM asset_tags WHERE asset_id = ?")
        .bind(&asset_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear tags: {e}"))?;

    for name in normalized {
        // Upsert the tag, then link. INSERT OR IGNORE preserves the
        // original casing of the existing row if there's a collision
        // (NOCASE collation matches case-insensitively).
        sqlx::query("INSERT OR IGNORE INTO tags (name) VALUES (?)")
            .bind(&name)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("upsert tag: {e}"))?;
        sqlx::query(
            "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
             SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE",
        )
        .bind(&asset_id)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("link tag: {e}"))?;
    }

    tx.commit().await.map_err(|e| format!("commit tags: {e}"))?;
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn tag_list_all(state: State<'_, LibraryState>) -> Result<Vec<TagCount>, String> {
    // Tags with their usage counts, alphabetical. Drives the tag-filter
    // chip bar and the autocomplete dropdown.
    //
    // HAVING count > 0 hides orphan tags (last asset was deleted or
    // untagged). We DON'T drop the row from the `tags` table — re-
    // adding later should restore the original casing. The orphan
    // rows are cheap and invisible at this layer.
    sqlx::query_as::<_, TagCount>(
        r#"SELECT t.name AS name, COUNT(at.asset_id) AS count
           FROM tags t
           LEFT JOIN asset_tags at ON at.tag_id = t.id
           GROUP BY t.id
           HAVING count > 0
           ORDER BY t.name COLLATE NOCASE"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("tag_list_all: {e}"))
}

/// One row of the backfill list — assets that have no local thumbnail
/// yet. The frontend feeds these through media_extract_thumbnail one
/// by one on startup so existing libraries get filled in over time
/// without thrashing CPU.
#[derive(Serialize, Debug, Clone, sqlx::FromRow)]
pub struct ThumbnailMissing {
    pub id: String,
    pub file_path: String,
    pub duration_sec: Option<f64>,
}

#[tauri::command]
pub async fn library_thumbnails_missing(
    state: State<'_, LibraryState>,
) -> Result<Vec<ThumbnailMissing>, String> {
    sqlx::query_as::<_, ThumbnailMissing>(
        r#"SELECT id, file_path, duration_sec
           FROM assets
           WHERE thumbnail_path IS NULL
           ORDER BY downloaded_at DESC"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("library_thumbnails_missing: {e}"))
}

/// Look up an existing asset by source URL. Returns the most recent
/// match (by downloaded_at DESC) — same URL downloaded twice rarely
/// happens by accident, but when it does, the most recent copy is
/// the relevant one to reveal.
///
/// Used by the Download page to warn the user before re-downloading
/// something already in their library, AND by the batch queue to
/// flag dupes per-row.
#[derive(Serialize, Debug, Clone, sqlx::FromRow)]
pub struct DuplicateMatch {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub project_id: Option<String>,
    pub downloaded_at: i64,
    /// Display label for the scope ("Library" or "<project name>").
    /// Computed in SQL via the JOIN so the renderer doesn't need a
    /// second round-trip.
    pub scope_label: String,
}

#[tauri::command]
pub async fn library_find_by_url(
    state: State<'_, LibraryState>,
    source_url: String,
) -> Result<Option<DuplicateMatch>, String> {
    let row = sqlx::query_as::<_, DuplicateMatch>(
        r#"SELECT a.id, a.title, a.file_path, a.project_id, a.downloaded_at,
                  COALESCE(p.name, 'Library') AS scope_label
           FROM assets a
           LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.source_url = ?
           ORDER BY a.downloaded_at DESC
           LIMIT 1"#,
    )
    .bind(&source_url)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("library_find_by_url: {e}"))?;
    Ok(row)
}

/// Record a local thumbnail path against an asset. Used by the post-
/// download thumbnail extraction flow (see `media_extract_thumbnail`
/// in lib.rs). Non-fatal if the asset row is gone (user might forget
/// it before extraction completes) — returns Ok in that case.
// =====================================================================
// Filesystem layout helpers (0.6 Phase B)
// =====================================================================

/// Look up a project's slug from its id. Returns None if the project
/// doesn't exist (caller decides whether to fail or fall back).
async fn project_slug_for(pool: &SqlitePool, id: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT slug FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(s,)| s))
}

/// Compute the on-disk download directory for a given scope.
///
///   None         → <home>/Media Hub/Library/raw/
///   Some(id)     → <home>/Media Hub/Projects/<slug>/raw/
///
/// The `raw/` subfolder gives us room for future siblings without
/// reorganizing — e.g. `proxies/` for 0.6 scrubber low-res files,
/// `exports/` if we ever generate user-facing exports. Resolve / NLEs
/// pointed at the project root pick up `raw/` naturally.
///
/// If `project_id` is Some but the project no longer exists, falls
/// back to Library. Defensive — better than failing the download.
pub async fn resolve_download_dir(
    state: &LibraryState,
    home: &Path,
    project_id: Option<&str>,
) -> Result<PathBuf, String> {
    let root = home.join("Media Hub");
    match project_id {
        None => Ok(root.join("Library").join("raw")),
        Some(id) => {
            let slug = project_slug_for(&state.pool, id)
                .await
                .map_err(|e| format!("resolve_download_dir lookup: {e}"))?;
            match slug {
                Some(s) => Ok(root.join("Projects").join(s).join("raw")),
                None => {
                    eprintln!(
                        "resolve_download_dir: project {id} not found; falling back to Library"
                    );
                    Ok(root.join("Library").join("raw"))
                }
            }
        }
    }
}

/// Build a non-colliding target path for moving a file into a new
/// directory. If `<dir>/<basename>` already exists, append ` (N)`
/// before the extension and increment until free.
fn unique_target_path(dir: &Path, src: &Path) -> PathBuf {
    let file_name = src.file_name().unwrap_or_default();
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("");
    for n in 2..1000 {
        let new_name = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let p = dir.join(new_name);
        if !p.exists() {
            return p;
        }
    }
    // Hyper-unlikely; just return the original (caller will fail on
    // rename, surfacing the conflict).
    candidate
}

// =====================================================================
// Projects (0.6 Phase A)
// =====================================================================

/// Sanitize a user-typed project name into a filesystem-safe slug.
/// Used at create-time only — the slug is then stable for the
/// project's lifetime, so renaming the display name doesn't strand
/// folders on disk (filesystem routing lands in Phase B but the slug
/// needs to be locked in now).
///
/// Rules:
///   - Lowercase
///   - Replace whitespace and `/`, `\` with `-`
///   - Strip anything not `[a-z0-9_-]`
///   - Collapse runs of `-`
///   - Trim leading/trailing `-`
///   - Cap at 50 chars
///   - Fall back to "project" if empty after sanitization
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_hyphen = false;
    for ch in name.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        let is_word = lower.is_ascii_alphanumeric() || lower == '_';
        if is_word {
            out.push(lower);
            last_hyphen = false;
        } else if !last_hyphen && !out.is_empty() {
            out.push('-');
            last_hyphen = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        return "project".to_string();
    }
    if out.len() > 50 {
        out.truncate(50);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

/// Ensure the slug is unique in the projects table by appending
/// `-2`, `-3`, ... on collision. The base slug is tried first.
async fn unique_slug(pool: &SqlitePool, base: &str) -> Result<String, sqlx::Error> {
    let exists = |slug: &str| {
        let pool = pool.clone();
        let slug = slug.to_string();
        async move {
            let row: Option<(i64,)> =
                sqlx::query_as("SELECT 1 FROM projects WHERE slug = ? LIMIT 1")
                    .bind(slug)
                    .fetch_optional(&pool)
                    .await?;
            Ok::<bool, sqlx::Error>(row.is_some())
        }
    };
    if !exists(base).await? {
        return Ok(base.to_string());
    }
    for n in 2..1000 {
        let candidate = format!("{base}-{n}");
        if !exists(&candidate).await? {
            return Ok(candidate);
        }
    }
    // Catastrophically unlikely — bail with a UUID suffix.
    Ok(format!("{base}-{}", uuid::Uuid::new_v4().simple()))
}

#[tauri::command]
pub async fn project_create(
    app: AppHandle,
    state: State<'_, LibraryState>,
    name: String,
) -> Result<Project, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".into());
    }
    if trimmed.len() > 80 {
        return Err("project name exceeds 80 chars".into());
    }

    // Pre-check display-name uniqueness (case-insensitive). The DB
    // UNIQUE COLLATE NOCASE will catch this too, but a user-facing
    // message is friendlier than a sqlx error string.
    let dupe: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE LIMIT 1")
            .bind(trimmed)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| format!("project_create dupe-check: {e}"))?;
    if dupe.is_some() {
        return Err(format!("project named \"{trimmed}\" already exists"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let slug_base = slugify(trimmed);
    let slug = unique_slug(&state.pool, &slug_base)
        .await
        .map_err(|e| format!("project_create slug: {e}"))?;
    let now = chrono::Utc::now().timestamp();

    sqlx::query("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(trimmed)
        .bind(&slug)
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("project_create: {e}"))?;

    let _ = app.emit("library:changed", ());

    Ok(Project {
        id,
        name: trimmed.to_string(),
        slug,
        created_at: now,
        asset_count: 0,
    })
}

#[tauri::command]
pub async fn project_list(state: State<'_, LibraryState>) -> Result<Vec<Project>, String> {
    // LEFT JOIN keeps zero-asset projects in the result. ORDER BY
    // created_at DESC so newest projects float up (matches the
    // "I just made this, where is it" expectation).
    let rows = sqlx::query_as::<_, (String, String, String, i64, i64)>(
        r#"SELECT p.id, p.name, p.slug, p.created_at,
                  COALESCE(COUNT(a.id), 0) AS asset_count
           FROM projects p
           LEFT JOIN assets a ON a.project_id = p.id
           GROUP BY p.id
           ORDER BY p.created_at DESC"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("project_list: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(id, name, slug, created_at, asset_count)| Project {
            id,
            name,
            slug,
            created_at,
            asset_count,
        })
        .collect())
}

#[tauri::command]
pub async fn project_rename(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".into());
    }
    if trimmed.len() > 80 {
        return Err("project name exceeds 80 chars".into());
    }

    // Reject duplicate (other than this row).
    let dupe: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE AND id != ? LIMIT 1",
    )
    .bind(trimmed)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("project_rename dupe-check: {e}"))?;
    if dupe.is_some() {
        return Err(format!("project named \"{trimmed}\" already exists"));
    }

    // Slug is intentionally NOT updated on rename — keeps the folder
    // on disk (Phase B) stable so we don't strand directories.
    let res = sqlx::query("UPDATE projects SET name = ? WHERE id = ?")
        .bind(trimmed)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("project_rename: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("project {id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

/// Move an asset between Library and a project (or vice versa).
/// Phase B: physically moves the file from the source scope's folder
/// into the target scope's folder, updates `file_path` in the DB to
/// match, and finally updates `project_id`.
///
/// Robustness:
/// - If the source file doesn't exist (deleted out-of-band), we just
///   update the DB. The path will still be wrong but the row is no
///   longer worse than it was — and the user can see the path in the
///   drawer to investigate.
/// - If the target dir doesn't exist, we create it.
/// - If a file with the same name already lives in the target dir,
///   we append " (2)", " (3)", etc. before the extension.
/// - If the rename across filesystems would fail (uncommon — Tauri
///   keeps everything in $HOME), we fall back to copy + delete.
#[tauri::command]
pub async fn asset_set_project(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    // Validate target project exists (NULL is always valid).
    if let Some(ref pid) = project_id {
        let exists: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
                .bind(pid)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| format!("asset_set_project lookup: {e}"))?;
        if exists.is_none() {
            return Err(format!("project {pid} not found"));
        }
    }

    // Fetch current file_path so we can move it.
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT file_path, project_id FROM assets WHERE id = ?",
    )
    .bind(&asset_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("asset_set_project fetch: {e}"))?;
    let (current_path, current_project) = row
        .ok_or_else(|| format!("asset {asset_id} not found"))?;

    // Short-circuit: same scope, nothing to do.
    if current_project == project_id {
        return Ok(());
    }

    // Compute target directory based on the new project (or Library).
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let target_dir = resolve_download_dir(&state, &home, project_id.as_deref()).await?;

    let src = PathBuf::from(&current_path);
    let new_path = if src.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("create target dir {}: {e}", target_dir.display()))?;
        let target = unique_target_path(&target_dir, &src);
        // Try a fast rename first. On Windows, rename across volumes
        // fails with ERROR_NOT_SAME_DEVICE — copy+delete is the
        // standard fallback.
        if let Err(rename_err) = std::fs::rename(&src, &target) {
            std::fs::copy(&src, &target)
                .map_err(|e| format!("copy fallback ({rename_err}): {e}"))?;
            std::fs::remove_file(&src)
                .map_err(|e| format!("cleanup after copy fallback: {e}"))?;
        }
        target.to_string_lossy().to_string()
    } else {
        // Source missing — log and keep the existing path string. The
        // DB project_id still updates, which is the primary user
        // intent.
        eprintln!(
            "asset_set_project: source file missing at {current_path}; updating DB only"
        );
        current_path
    };

    sqlx::query("UPDATE assets SET project_id = ?, file_path = ? WHERE id = ?")
        .bind(&project_id)
        .bind(&new_path)
        .bind(&asset_id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("asset_set_project update: {e}"))?;

    let _ = app.emit("library:changed", ());
    Ok(())
}

/// Finish a project — the big lifecycle action.
///
/// Workflow:
///   1. Optionally promote all the project's assets back to Library
///      (the user picked this when confirming). Files are physically
///      moved into Library/raw/.
///   2. Move the project folder (~/Media Hub/Projects/<slug>/) to OS
///      trash via the `trash` crate. Recoverable — the user can pull
///      it out of Trash/Recycle Bin if they finished too early.
///   3. Delete the project row from the DB.
///
/// Two non-promote behaviors are reasonable:
///   - `promote: true` (default in UI): assets survive in Library
///   - `promote: false`: assets are DB-deleted too (CASCADE via
///     ON DELETE SET NULL would only orphan them; we explicitly
///     remove rows to keep the library clean). Files go to trash
///     alongside the folder.
///
/// We always trash the folder — that's the whole point of the
/// "Finish" gesture (clean shutdown of a finished piece of work).
#[tauri::command]
pub async fn project_finish(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    promote: bool,
) -> Result<(), String> {
    // Resolve the slug first — needed for the folder path AND we
    // want to bail clearly if the project doesn't exist.
    let slug = project_slug_for(&state.pool, &id)
        .await
        .map_err(|e| format!("project_finish lookup: {e}"))?
        .ok_or_else(|| format!("project {id} not found"))?;

    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let project_dir = home.join("Media Hub").join("Projects").join(&slug);

    if promote {
        // Move each project asset back to Library (file + DB) via
        // the existing per-asset move logic. Sequential keeps things
        // predictable; with N≈dozens this is fine. If projects ever
        // grow to thousands of assets, batch this.
        let asset_ids: Vec<(String,)> =
            sqlx::query_as("SELECT id FROM assets WHERE project_id = ?")
                .bind(&id)
                .fetch_all(&state.pool)
                .await
                .map_err(|e| format!("project_finish list: {e}"))?;

        let library_dir = home.join("Media Hub").join("Library").join("raw");
        for (asset_id,) in asset_ids {
            // Reuse the asset_set_project logic by calling it
            // inline. We can't invoke the #[tauri::command] from
            // another command directly, but we can replicate the
            // body — or extract into a helper. Inline for now;
            // refactor when this pattern repeats.
            let row: Option<(String,)> =
                sqlx::query_as("SELECT file_path FROM assets WHERE id = ?")
                    .bind(&asset_id)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| format!("project_finish fetch asset: {e}"))?;
            if let Some((current_path,)) = row {
                let src = PathBuf::from(&current_path);
                let new_path = if src.exists() {
                    std::fs::create_dir_all(&library_dir).map_err(|e| {
                        format!("create library dir: {e}")
                    })?;
                    let target = unique_target_path(&library_dir, &src);
                    if std::fs::rename(&src, &target).is_err() {
                        std::fs::copy(&src, &target).map_err(|e| {
                            format!("project_finish copy fallback: {e}")
                        })?;
                        let _ = std::fs::remove_file(&src);
                    }
                    target.to_string_lossy().to_string()
                } else {
                    current_path
                };
                sqlx::query(
                    "UPDATE assets SET project_id = NULL, file_path = ? WHERE id = ?",
                )
                .bind(&new_path)
                .bind(&asset_id)
                .execute(&state.pool)
                .await
                .map_err(|e| format!("project_finish update asset: {e}"))?;
            }
        }
    } else {
        // Drop the asset rows for this project — files go to trash
        // alongside the project folder below.
        sqlx::query("DELETE FROM assets WHERE project_id = ?")
            .bind(&id)
            .execute(&state.pool)
            .await
            .map_err(|e| format!("project_finish purge assets: {e}"))?;
    }

    // Trash the project folder. Missing-folder is fine (user finished
    // an empty project, or files were already cleaned up out-of-band).
    if project_dir.exists() {
        if let Err(e) = trash::delete(&project_dir) {
            return Err(format!(
                "could not move {} to trash: {e}",
                project_dir.display()
            ));
        }
    }

    // Finally remove the project row.
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("project_finish delete project: {e}"))?;

    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn project_delete(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    // ON DELETE SET NULL on assets.project_id means deleting a project
    // returns its assets to the Library (project_id = NULL) rather
    // than removing them. File system migration (move out of the
    // project folder) is Phase B; tonight this is metadata-only.
    let res = sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("project_delete: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("project {id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

// =====================================================================
// Thumbnail commands
// =====================================================================

#[tauri::command]
pub async fn library_set_thumbnail(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_id: String,
    path: String,
) -> Result<(), String> {
    let res = sqlx::query("UPDATE assets SET thumbnail_path = ? WHERE id = ?")
        .bind(&path)
        .bind(&asset_id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("library_set_thumbnail: {e}"))?;
    if res.rows_affected() > 0 {
        let _ = app.emit("library:changed", ());
    }
    Ok(())
}
