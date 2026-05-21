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
use std::path::PathBuf;
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
) -> Result<(), String> {
    // Remove the row only. File on disk is left alone — the user can
    // manually delete it from Explorer/Finder. asset_tags rows go via
    // ON DELETE CASCADE.
    sqlx::query("DELETE FROM assets WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("library_delete: {e}"))?;
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

/// Record a local thumbnail path against an asset. Used by the post-
/// download thumbnail extraction flow (see `media_extract_thumbnail`
/// in lib.rs). Non-fatal if the asset row is gone (user might forget
/// it before extraction completes) — returns Ok in that case.
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
/// `project_id = null` returns the asset to the Library scope.
/// Phase A: meta-only — the file on disk doesn't physically move.
/// Phase B will pair this with an os::rename inside the library root.
#[tauri::command]
pub async fn asset_set_project(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    // Validate the target project exists (NULL is always valid).
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
    let res = sqlx::query("UPDATE assets SET project_id = ? WHERE id = ?")
        .bind(&project_id)
        .bind(&asset_id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("asset_set_project: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("asset {asset_id} not found"));
    }
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
