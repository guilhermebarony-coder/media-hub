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
    /// 1.2.0 — asset kind. None defaults to "video" server-side so
    /// older renderers / callers don't need to know about kinds yet.
    /// Recognized: "video", "audio". Future: "image", "archive".
    pub kind: Option<String>,
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
    /// 1.1 Phase 2 — organizational folder, orthogonal to project.
    /// NULL = "Uncategorized" (no folder assigned). Cascades to NULL
    /// via FK on folder delete so dropping a folder never loses
    /// asset rows.
    #[sqlx(default)]
    pub folder_id: Option<String>,
    /// 1.2.0 — asset kind. `#[sqlx(default)]` keeps it safe for old
    /// rows pre-migration where the column isn't set yet (decodes as
    /// empty string → we coalesce to "video" in From<AssetRow>).
    #[sqlx(default)]
    pub kind: String,
    pub downloaded_at: i64,
    /// Count of OTHER assets sharing this asset's source_url. Computed
    /// per row in library_list via a sub-select — drives the "+N
    /// siblings" chip on library cards without a second round-trip.
    /// Defaults to 0 when no other rows share the URL (typical case).
    #[sqlx(default)]
    pub sibling_count: i64,
    /// 1.3.0 — in-app trash. NULL = live; Some(unix) = trashed at that
    /// time. `#[sqlx(default)]` so old rows decode fine.
    #[sqlx(default)]
    pub deleted_at: Option<i64>,
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
    /// 1.1 Phase 2 — organizational folder. See AssetRow.folder_id doc.
    pub folder_id: Option<String>,
    /// 1.2.0 — "video" | "audio" | future kinds. Always populated.
    pub kind: String,
    pub downloaded_at: i64,
    pub tags: Vec<String>,
    /// Number of other assets that share this asset's source_url.
    /// Drives the "+N siblings" chip on library cards.
    pub sibling_count: i64,
    /// 1.3.0 — true when `file_path` no longer exists on disk (deleted
    /// out-of-band in Explorer/Finder, or its drive is offline). Computed
    /// per-list in `library_list`, never stored. Drives the ⚠ MISSING
    /// badge + the "Remove missing" cleanup. We never auto-delete on this
    /// — an unplugged drive must not wipe the library.
    pub missing: bool,
    /// 1.3.0 — when this clip was moved to the in-app Trash (unix secs),
    /// or null if it's live. Drives the Trash view's "deleted X ago".
    pub deleted_at: Option<i64>,
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
            folder_id: r.folder_id,
            // Coerce empty (legacy rows pre-migration) → "video" so
            // the renderer doesn't have to handle the empty case.
            kind: if r.kind.is_empty() { "video".to_string() } else { r.kind },
            downloaded_at: r.downloaded_at,
            tags: Vec::new(),
            sibling_count: r.sibling_count,
            // Set per-list in library_list (needs a filesystem stat).
            missing: false,
            deleted_at: r.deleted_at,
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
    /// 1.3.0 — custom on-disk folder. None = legacy managed path
    /// (<content_root>/Projects/<slug>/raw/); Some = that exact folder,
    /// clips land directly in it. Drives the "custom location" behavior
    /// + the "never trash a user folder" safety rule.
    pub root_path: Option<String>,
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
        include_str!("../migrations/005_indexes.sql"),
        include_str!("../migrations/006_drop_dead_indexes.sql"),
        include_str!("../migrations/007_folders.sql"),
        include_str!("../migrations/008_asset_kind.sql"),
        include_str!("../migrations/009_project_root.sql"),
        include_str!("../migrations/010_trash.sql"),
        include_str!("../migrations/011_folder_nesting.sql"),
        include_str!("../migrations/012_eagle.sql"),
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

    // 1.3.x — folder-nesting structural migration that can't run in the
    // naive idempotent loop above (it drops a column constraint, which
    // requires a table rebuild). Guarded: only rebuilds when migration
    // 007's global UNIQUE on folders.name is still present. Always
    // ensures the nesting indexes exist (idempotent).
    migrate_folders_for_nesting(&pool).await?;

    Ok(LibraryState { pool })
}

/// Drop migration 007's global `UNIQUE` on `folders.name` (incompatible
/// with nesting — same name is fine under different parents) and ensure
/// the nesting indexes exist.
///
/// SQLite can't drop a column constraint in place, so we rebuild the
/// table. The rebuild is guarded behind a check of the live schema so it
/// runs exactly once: if `folders`' CREATE SQL no longer contains the
/// global UNIQUE, we skip straight to ensuring indexes.
async fn migrate_folders_for_nesting(pool: &sqlx::SqlitePool) -> Result<(), String> {
    // Read the table's current DDL from sqlite_master.
    let ddl: Option<(String,)> =
        sqlx::query_as("SELECT sql FROM sqlite_master WHERE type='table' AND name='folders'")
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("folder-nesting: read schema: {e}"))?;

    // The old (migration 007) DDL declared `name TEXT NOT NULL UNIQUE
    // COLLATE NOCASE`. The rebuilt table drops that inline UNIQUE. We
    // detect the old shape by the column-level UNIQUE on name.
    let needs_rebuild = ddl
        .as_ref()
        .map(|(sql,)| sql.to_uppercase().contains("UNIQUE"))
        .unwrap_or(false);

    if needs_rebuild {
        // Rebuild inside a transaction. FK enforcement is off by default
        // on the connection, so dropping/renaming won't trip references.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("folder-nesting: begin tx: {e}"))?;

        // New table: same columns, NO global UNIQUE on name.
        sqlx::query(
            r#"CREATE TABLE folders_new (
                 id         TEXT PRIMARY KEY,
                 name       TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 parent_id  TEXT REFERENCES folders_new(id) ON DELETE SET NULL,
                 color      TEXT,
                 position   INTEGER NOT NULL DEFAULT 0
               )"#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("folder-nesting: create new table: {e}"))?;

        sqlx::query(
            r#"INSERT INTO folders_new (id, name, created_at, parent_id, color, position)
               SELECT id, name, created_at, parent_id, color, position FROM folders"#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("folder-nesting: copy rows: {e}"))?;

        sqlx::query("DROP TABLE folders")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("folder-nesting: drop old table: {e}"))?;

        sqlx::query("ALTER TABLE folders_new RENAME TO folders")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("folder-nesting: rename: {e}"))?;

        tx.commit()
            .await
            .map_err(|e| format!("folder-nesting: commit: {e}"))?;
    }

    // Ensure nesting indexes (idempotent — runs every launch).
    for stmt in [
        "CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id)",
        "CREATE INDEX IF NOT EXISTS idx_folders_parent_position \
           ON folders(parent_id, position, name COLLATE NOCASE)",
        // Per-parent case-insensitive name uniqueness. COALESCE folds
        // top-level folders (NULL parent) onto a single sentinel so
        // root siblings are also de-duped (SQLite treats NULLs as
        // distinct in UNIQUE otherwise).
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name_unique \
           ON folders(COALESCE(parent_id, ''), name COLLATE NOCASE)",
    ] {
        sqlx::query(stmt)
            .execute(pool)
            .await
            .map_err(|e| format!("folder-nesting: index: {e}"))?;
    }

    Ok(())
}

// =====================================================================
// Tauri commands
// =====================================================================

/// Fetch tags for a set of asset ids in one query, returning a map.
/// Keeps `library_list` to two queries regardless of asset count.
pub async fn load_tags_for(
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

    // 1.2.0 — validate kind allowlist. Defends against arbitrary
    // strings sneaking in from a misbehaving renderer; unknown values
    // collapse to "video" so the worst case is a video-styled card.
    let kind = match input.kind.as_deref() {
        Some("audio") => "audio",
        Some("video") | None => "video",
        Some(_) => "video",
    };

    sqlx::query(
        r#"INSERT INTO assets
           (id, source_url, platform, video_id, channel, title,
            duration_sec, in_sec, out_sec,
            file_path, file_size, container,
            codec_video, codec_audio, width, height, fps,
            transcoded_to, thumbnail_url, project_id, kind, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
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
    .bind(kind)
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
    /// 1.1 Phase 2 — folder filter. Three-state semantics via the
    /// tagged enum (similar to LibraryScope):
    ///   - None / Any   → no filter (every folder + uncategorized)
    ///   - Uncategorized → folder_id IS NULL only
    ///   - Id(s)         → folder_id = s
    /// Folders are orthogonal to projects: a clip can live in a
    /// project AND be tagged with a folder; both filters apply if
    /// set.
    pub folder: Option<FolderFilter>,
    pub limit: Option<i64>,
    /// 1.3.0 — in-app trash view. None/false → live clips only
    /// (deleted_at IS NULL). true → ONLY trashed clips (deleted_at NOT
    /// NULL), ignoring project/folder scope (trash is global).
    pub trashed: Option<bool>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FolderFilter {
    #[default]
    Any,
    Uncategorized,
    Id { id: String },
    /// 1.3.x — match any of several folders at once. The frontend uses
    /// this for the "show subfolder contents" rollup: it passes the
    /// selected folder id plus all of its descendant ids (it owns the
    /// tree, so the walk is cheap and avoids a recursive SQL CTE here).
    Ids { ids: Vec<String> },
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

    // 1.3.0 — in-app trash. The live Library excludes trashed rows; the
    // Trash view shows ONLY trashed rows and ignores project/folder scope
    // (trash is global). Free-text search still applies in both.
    let trashed = filters.trashed.unwrap_or(false);
    if trashed {
        where_clauses.push("a.deleted_at IS NOT NULL".into());
    } else {
        where_clauses.push("a.deleted_at IS NULL".into());

        // Scope filter. `Any` adds no clause; `Library` and `Project`
        // are mutually exclusive predicates on assets.project_id.
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

        // 1.1 Phase 2 — folder filter. Orthogonal to scope above.
        match filters.folder.unwrap_or_default() {
            FolderFilter::Any => {}
            FolderFilter::Uncategorized => {
                where_clauses.push("a.folder_id IS NULL".into());
            }
            FolderFilter::Id { id } => {
                where_clauses.push("a.folder_id = ?".into());
                bindings.push(id);
            }
            FolderFilter::Ids { ids } => {
                if ids.is_empty() {
                    // No folders selected → match nothing (avoids an
                    // empty `IN ()` which is a SQL syntax error).
                    where_clauses.push("0 = 1".into());
                } else {
                    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    where_clauses.push(format!("a.folder_id IN ({placeholders})"));
                    for id in ids {
                        bindings.push(id);
                    }
                }
            }
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    // The correlated subquery counts OTHER assets sharing the same
    // source_url. Cost: O(N) per result row, but each lookup hits the
    // implicit index on source_url (sqlite auto-creates one for the
    // equality predicate on a non-unique column with enough rows).
    // For libraries up to ~10k assets this is fast enough. If it ever
    // becomes a bottleneck, switch to a precomputed materialized count
    // updated on insert/delete.
    let sql = format!(
        r#"SELECT a.*,
                  (SELECT COUNT(*) FROM assets s
                   WHERE s.source_url = a.source_url AND s.id != a.id)
                   AS sibling_count
           FROM assets a {} ORDER BY {} DESC LIMIT ?"#,
        where_sql,
        // Trash sorts by when it was deleted; the live library by when it
        // was downloaded.
        if trashed { "a.deleted_at" } else { "a.downloaded_at" },
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
            // 1.3.0 — flag rows whose file is gone. A cheap stat per row;
            // fine for the default 500-row page. Drives the ⚠ MISSING UI.
            a.missing = !std::path::Path::new(&a.file_path).exists();
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
    // 1.3.0 — every count excludes trashed rows (deleted_at IS NULL) so
    // the header/sidebar counters reflect only live clips.
    let (sql, bind_id): (&str, Option<String>) = match scope.unwrap_or_default() {
        LibraryScope::Any => ("SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL", None),
        LibraryScope::Library => (
            "SELECT COUNT(*) FROM assets WHERE project_id IS NULL AND deleted_at IS NULL",
            None,
        ),
        LibraryScope::Project { id } => (
            "SELECT COUNT(*) FROM assets WHERE project_id = ? AND deleted_at IS NULL",
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

// =====================================================================
// In-app trash (soft-delete) — 1.3.0
// =====================================================================
//
// Deleting a clip moves its file into <content_root>/_trash/ and marks
// the row trashed (deleted_at set), rather than permanently removing it
// or going through the OS Recycle Bin. The Trash view lists these,
// Restore moves the file back to where it came from, and Empty performs
// the real, permanent delete. Retention is manual (no auto-purge).

/// Move one asset's file into the in-app trash and flag the row. Safe to
/// call on an already-missing file (we still flag the row so the card
/// moves to Trash). No-op if the asset is already trashed or gone.
async fn trash_asset(
    pool: &SqlitePool,
    content_root: &Path,
    id: &str,
    now: i64,
) -> Result<(), String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT file_path FROM assets WHERE id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("trash_asset fetch: {e}"))?;
    let Some((current,)) = row else {
        return Ok(()); // already trashed or row gone
    };

    let trash_dir = content_root.join("_trash");
    let src = PathBuf::from(&current);
    let file_name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{id}.bin"));
    // Prefix with the asset id so two clips with the same basename don't
    // collide inside _trash.
    let dest = trash_dir.join(format!("{id}__{file_name}"));

    // Repoint file_path to the trash copy only if we actually moved a
    // file. If the source was already gone, leave file_path pointing at
    // its last-known location (the row still gets flagged trashed so the
    // user can purge it).
    let mut new_path = current.clone();
    if src.exists() {
        std::fs::create_dir_all(&trash_dir).map_err(|e| format!("create trash dir: {e}"))?;
        if std::fs::rename(&src, &dest).is_err() {
            std::fs::copy(&src, &dest).map_err(|e| format!("trash copy fallback: {e}"))?;
            let _ = std::fs::remove_file(&src);
        }
        new_path = dest.to_string_lossy().to_string();
    }

    sqlx::query(
        "UPDATE assets SET deleted_at = ?, trash_original_path = ?, file_path = ? WHERE id = ?",
    )
    .bind(now)
    .bind(&current) // remember where it lived for Restore
    .bind(&new_path)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| format!("trash_asset update: {e}"))?;
    Ok(())
}

/// Move one clip to the in-app Trash. The file is relocated to
/// <content_root>/_trash/ and the row is flagged trashed; the user can
/// restore it from the Trash view or empty the Trash to delete for good.
///
/// 1.3.0 — dropped the old `delete_file: Option<bool>` parameter together
/// with the Forget code path. "Tracked but file invisible" was a leaky
/// concept that confused users and added no value over actually moving
/// the file to the Trash. There is exactly one delete intent now.
#[tauri::command]
pub async fn library_delete(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings_state: State<'_, crate::settings::SettingsState>,
    id: String,
) -> Result<(), String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let content_root = crate::settings::content_root(&settings_state, &home);
    let now = chrono::Utc::now().timestamp();
    trash_asset(&state.pool, &content_root, &id, now).await?;

    let _ = app.emit("library:changed", ());
    Ok(())
}

/// 1.3.0 — prune library rows whose underlying file is gone (deleted in
/// Explorer/Finder). Paired with the ⚠ MISSING flag from `library_list`.
///
/// SAFETY: we re-verify each file is STILL missing at call time before
/// deleting its row. So if an external/network drive came back online
/// between the refresh that flagged the rows and the user clicking
/// "Remove missing", nothing valid is removed. Only DB rows go (the file
/// is already gone — nothing to delete on disk). Thumbnails are
/// best-effort cleaned. Returns the count actually removed.
#[tauri::command]
pub async fn library_remove_missing(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings_state: State<'_, crate::settings::SettingsState>,
    ids: Vec<String>,
) -> Result<u32, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("SELECT id, file_path FROM assets WHERE id IN ({placeholders})");
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for id in &ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("remove_missing fetch: {e}"))?;

    // Re-verify: keep only rows whose file really is gone right now.
    let to_delete: Vec<String> = rows
        .into_iter()
        .filter(|(_, path)| !std::path::Path::new(path).exists())
        .map(|(id, _)| id)
        .collect();
    if to_delete.is_empty() {
        return Ok(0);
    }

    let del_ph = std::iter::repeat("?")
        .take(to_delete.len())
        .collect::<Vec<_>>()
        .join(", ");
    let del_sql = format!("DELETE FROM assets WHERE id IN ({del_ph})");
    let mut dq = sqlx::query(&del_sql);
    for id in &to_delete {
        dq = dq.bind(id);
    }
    let res = dq
        .execute(&state.pool)
        .await
        .map_err(|e| format!("remove_missing delete: {e}"))?;

    // Best-effort thumbnail cleanup for the removed rows.
    if let Ok(home) = app.path().home_dir() {
        let thumbs = crate::settings::content_root(&settings_state, &home).join("_thumbnails");
        for id in &to_delete {
            let _ = std::fs::remove_file(thumbs.join(format!("{id}.jpg")));
        }
    }

    let _ = app.emit("library:changed", ());
    Ok(res.rows_affected() as u32)
}

/// Bulk Move-to-Trash. The frontend's multi-select grid can hand us N
/// asset ids at once; each one goes through `trash_asset` and the result
/// reports both the count moved and any per-id errors so the UI can show
/// a partial-success message ("3 moved, 2 couldn't — likely in use").
///
/// 1.3.0 — collapsed to a single intent. The old `delete_files: bool`
/// parameter and its Forget branch (drop row, keep file) are gone; that
/// concept confused users and the in-app Trash makes it redundant.
#[derive(Serialize, Debug, Clone)]
pub struct BulkDeleteResult {
    pub rows_deleted: u32,
    pub files_removed: u32,
    pub file_errors: Vec<String>,
}

#[tauri::command]
pub async fn library_delete_many(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings_state: State<'_, crate::settings::SettingsState>,
    ids: Vec<String>,
) -> Result<BulkDeleteResult, String> {
    if ids.is_empty() {
        return Ok(BulkDeleteResult {
            rows_deleted: 0,
            files_removed: 0,
            file_errors: Vec::new(),
        });
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let content_root = crate::settings::content_root(&settings_state, &home);
    let now = chrono::Utc::now().timestamp();
    let mut trashed = 0u32;
    let mut file_errors: Vec<String> = Vec::new();
    for id in &ids {
        match trash_asset(&state.pool, &content_root, id, now).await {
            Ok(()) => trashed += 1,
            Err(e) => {
                eprintln!("[delete_many] trash id={id}: {e}");
                file_errors.push(format!("{id}: {e}"));
            }
        }
    }
    let _ = app.emit("library:changed", ());
    Ok(BulkDeleteResult {
        rows_deleted: trashed,
        files_removed: trashed,
        file_errors,
    })
}

/// 1.3.0 — count of clips currently in the in-app Trash. Drives the
/// sidebar "Trash (N)" badge.
#[tauri::command]
pub async fn library_trash_count(state: State<'_, LibraryState>) -> Result<i64, String> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM assets WHERE deleted_at IS NOT NULL")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| format!("library_trash_count: {e}"))?;
    Ok(row.0)
}

/// 1.3.0 — restore trashed clips: move each file back from _trash to its
/// original location and clear the trashed flag. If the original folder
/// is gone (e.g. project deleted), we recreate its parent; if a file now
/// occupies the original name, we de-collide with " (N)". Returns count.
#[tauri::command]
pub async fn library_trash_restore(
    app: AppHandle,
    state: State<'_, LibraryState>,
    ids: Vec<String>,
) -> Result<u32, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut restored = 0u32;
    for id in &ids {
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT file_path, trash_original_path FROM assets WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("trash_restore fetch id={id}: {e}"))?;
        let Some((trash_path, original)) = row else {
            continue;
        };
        let src = PathBuf::from(&trash_path);

        // Where to put it back. Prefer the recorded original path,
        // recreating its parent and de-colliding if needed.
        let target = match original {
            Some(orig) if !orig.trim().is_empty() => {
                let op = PathBuf::from(&orig);
                match op.parent() {
                    Some(parent) => {
                        let _ = std::fs::create_dir_all(parent);
                        if op.exists() {
                            unique_target_path(parent, &op)
                        } else {
                            op.clone()
                        }
                    }
                    None => op.clone(),
                }
            }
            // No original recorded — leave the file where it is.
            _ => src.clone(),
        };

        let final_path = if src.exists() && src != target {
            if std::fs::rename(&src, &target).is_err() {
                std::fs::copy(&src, &target)
                    .map_err(|e| format!("trash_restore copy id={id}: {e}"))?;
                let _ = std::fs::remove_file(&src);
            }
            target.to_string_lossy().to_string()
        } else {
            target.to_string_lossy().to_string()
        };

        sqlx::query(
            "UPDATE assets SET deleted_at = NULL, trash_original_path = NULL, file_path = ? WHERE id = ?",
        )
        .bind(&final_path)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("trash_restore update id={id}: {e}"))?;
        restored += 1;
    }
    let _ = app.emit("library:changed", ());
    Ok(restored)
}

/// 1.3.0 — permanently delete trashed clips (the real delete). Removes
/// the _trash file + thumbnail + row. Only acts on rows that are
/// actually trashed. Returns count removed.
#[tauri::command]
pub async fn library_trash_empty(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings_state: State<'_, crate::settings::SettingsState>,
    ids: Vec<String>,
) -> Result<u32, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let thumbs_dir = app
        .path()
        .home_dir()
        .ok()
        .map(|h| crate::settings::content_root(&settings_state, &h).join("_thumbnails"));
    let mut removed = 0u32;
    for id in &ids {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT file_path FROM assets WHERE id = ? AND deleted_at IS NOT NULL")
                .bind(id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| format!("trash_empty fetch id={id}: {e}"))?;
        let Some((path,)) = row else {
            continue;
        };
        let _ = std::fs::remove_file(&path);
        if let Some(ref td) = thumbs_dir {
            let _ = std::fs::remove_file(td.join(format!("{id}.jpg")));
        }
        sqlx::query("DELETE FROM assets WHERE id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .map_err(|e| format!("trash_empty delete id={id}: {e}"))?;
        removed += 1;
    }
    let _ = app.emit("library:changed", ());
    Ok(removed)
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

/// Return assets that share a source_url with the given asset id,
/// excluding the asset itself. Used by the asset drawer's "Other clips
/// from this source" section.
///
/// Returns a compact projection (id, title, thumbnail, in/out, scope)
/// rather than full Asset rows — we don't need the full row for the
/// thumbnail-strip UI, and shipping less over the IPC bridge is just
/// nice.
#[derive(Serialize, Debug, Clone, sqlx::FromRow)]
pub struct SiblingSummary {
    pub id: String,
    pub title: String,
    pub thumbnail_path: Option<String>,
    pub thumbnail_url: Option<String>,
    pub in_sec: Option<f64>,
    pub out_sec: Option<f64>,
    pub duration_sec: Option<f64>,
    pub downloaded_at: i64,
    pub scope_label: String,
}

#[tauri::command]
pub async fn library_siblings(
    state: State<'_, LibraryState>,
    asset_id: String,
) -> Result<Vec<SiblingSummary>, String> {
    sqlx::query_as::<_, SiblingSummary>(
        r#"SELECT a.id, a.title, a.thumbnail_path, a.thumbnail_url,
                  a.in_sec, a.out_sec, a.duration_sec, a.downloaded_at,
                  COALESCE(p.name, 'Library') AS scope_label
           FROM assets a
           LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.source_url = (SELECT source_url FROM assets WHERE id = ?)
             AND a.id != ?
           ORDER BY COALESCE(a.in_sec, 0) ASC, a.downloaded_at ASC"#,
    )
    .bind(&asset_id)
    .bind(&asset_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("library_siblings: {e}"))
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

/// 1.3.0 — look up a project's (slug, root_path). `root_path` is the
/// custom user folder (None = legacy managed path). Returns None if the
/// project doesn't exist.
async fn project_paths_for(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<(String, Option<String>)>, sqlx::Error> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT slug, root_path FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// Compute the on-disk download directory for a given scope.
///
///   None         → <content_root>/Library/raw/
///   Some(id)     → <content_root>/Projects/<slug>/raw/
///
/// `content_root` is `<home>/Media Hub` by default, or the user's
/// `settings.library_root` override (0.8.C). Callers resolve it via
/// `settings::content_root(state, home)`. We accept it as a parameter
/// here (rather than reaching into settings state) so library.rs has
/// no settings dependency.
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
    content_root: &Path,
    project_id: Option<&str>,
) -> Result<PathBuf, String> {
    let root = content_root.to_path_buf();
    match project_id {
        None => Ok(root.join("Library").join("raw")),
        Some(id) => {
            let paths = project_paths_for(&state.pool, id)
                .await
                .map_err(|e| format!("resolve_download_dir lookup: {e}"))?;
            match paths {
                // 1.3.0 — custom folder: clips land directly in it (no raw/).
                Some((_, Some(custom))) => Ok(PathBuf::from(custom)),
                // Legacy managed project: <content_root>/Projects/<slug>/raw/
                Some((slug, None)) => Ok(root.join("Projects").join(slug).join("raw")),
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

/// 1.1 — heal a library whose thumbnail_path rows point at files
/// that no longer exist. Built specifically to recover from the
/// `library_migrate_root` bug shipped in 1.0.5: that command rewrote
/// `assets.file_path` but forgot to rewrite `assets.thumbnail_path`,
/// so post-migration libraries had every thumbnail path pointing at
/// `<old_root>/_thumbnails/...` which is no longer there.
///
/// Strategy: for each row with a non-null thumbnail_path, check if
/// the file exists. If not, set thumbnail_path = NULL. The Library
/// page's mount-time backfill effect (`library_thumbnails_missing` →
/// `attachLocalThumbnail`) will then regenerate them from the actual
/// video files on next mount.
///
/// Safe to run anytime — it only nulls broken refs, never overwrites
/// valid ones. Returns count repaired.
#[tauri::command]
pub async fn library_repair_thumbnails(
    app: AppHandle,
    state: tauri::State<'_, LibraryState>,
) -> Result<u32, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, thumbnail_path FROM assets WHERE thumbnail_path IS NOT NULL")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| format!("repair_thumbnails select: {e}"))?;

    let mut repaired = 0u32;
    for (id, path) in rows {
        if !std::path::Path::new(&path).exists() {
            sqlx::query("UPDATE assets SET thumbnail_path = NULL WHERE id = ?")
                .bind(&id)
                .execute(&state.pool)
                .await
                .map_err(|e| format!("repair_thumbnails update id={id}: {e}"))?;
            repaired += 1;
        }
    }
    if repaired > 0 {
        let _ = app.emit("library:changed", ());
    }
    Ok(repaired)
}

/// Build a non-colliding target path for moving a file into a new
/// directory. If `<dir>/<basename>` already exists, append ` (N)`
/// before the extension and increment until free.
// =====================================================================
// 1.0.5 — Library-root migration
// =====================================================================
//
// The footgun this defuses: when the user sets a new `library_root` in
// Settings → Library, today's behavior is FORWARD-ONLY. Future downloads
// land at the new root, but every existing `assets.file_path` row still
// points at the OLD location, and `library.db` itself stays at
// `~/Media Hub/library.db` regardless. If the user then "cleans up"
// the old folder, they wipe their entire history.
//
// `library_migrate_root` is the rescue: physically moves the content
// directories AND rewrites every asset row's file_path in a single
// sqlx transaction. The DB itself intentionally stays put — moving an
// open SQLite mid-session is fiddly and the user-visible win is small.
// Documented behavior.
//
// Strategy:
//   1. Validate: refuse self-moves, refuse new_root inside old_root
//      (would create cycles), refuse if new_root already has a
//      conflicting Library/ or Projects/ subdir with content.
//   2. For each of [Library, Projects, _thumbnails], move from
//      old → new. Try `fs::rename` first (atomic same-volume), fall
//      back to recursive copy + delete on EXDEV / cross-device.
//   3. In a sqlx transaction, rewrite every `assets.file_path` whose
//      string starts with the old root prefix → swap in the new root.
//      Atomic at the DB level: if anything fails mid-loop, the whole
//      UPDATE rolls back.
//   4. Update `settings.library_root` via the helper in settings.rs.
//   5. Emit `library:changed` so the UI reloads with the new paths.
//
// What we don't try to do:
//   - Move library.db (documented design — stays at home/Media Hub)
//   - Move yt-dlp's logs / cache (not ours)
//   - Roll back filesystem moves on later failure. The DB rollback
//     handles the "row rewrite failed" case but undoing filesystem
//     moves robustly would need a journal. For 1.0.5 we surface the
//     half-done state in the result struct so the user can see what
//     succeeded.

#[derive(Serialize, Debug, Clone)]
pub struct MigrateResult {
    pub old_root: String,
    pub new_root: String,
    pub moved_dirs: Vec<String>,       // names of subdirs successfully relocated
    pub skipped_dirs: Vec<String>,     // subdirs that didn't exist at old root (nothing to move)
    pub asset_rows_updated: u32,       // count of file_path rewrites in DB
    pub warnings: Vec<String>,         // non-fatal issues (orphan files, mismatched paths)
}

/// Recursively copy `src` directory tree to `dst`. Used as a fallback
/// when `fs::rename` fails across volumes. Caller is responsible for
/// deleting `src` after a successful copy.
///
/// We don't use a crate for this because adding a dep for ~30 lines
/// of trivial recursion isn't worth it. Skips symlinks (unlikely in
/// our content dirs, would need extra ceremony to handle correctly).
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry_path, &target)?;
        } else if ty.is_file() {
            std::fs::copy(&entry_path, &target)?;
        }
        // Symlinks intentionally skipped — not part of our content layout.
    }
    Ok(())
}

/// Move a directory tree from `src` to `dst`. Tries `rename` first
/// (instant, atomic, same-volume only) and falls back to recursive
/// copy + delete. On copy+delete failure mid-flight, the half-copied
/// destination is best-effort cleaned up before returning the error,
/// leaving the source intact so the user doesn't lose data.
fn move_dir(src: &Path, dst: &Path) -> Result<(), String> {
    // Path::exists checks resolved (followed) target — fine for our
    // case where we know there's no symlink shenanigans.
    if !src.exists() {
        return Err(format!("source doesn't exist: {}", src.display()));
    }
    if dst.exists() {
        return Err(format!("destination already exists: {}", dst.display()));
    }
    // Ensure parent of dst exists.
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create dst parent {}: {e}", parent.display()))?;
    }

    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Most cross-device move errors land as ErrorKind::Other or
            // raw os error 17/18 depending on platform. Don't try to
            // discriminate too cleverly — any rename failure → try the
            // copy fallback.
            eprintln!(
                "[migrate] rename failed ({e}), falling back to copy+delete for {} → {}",
                src.display(),
                dst.display()
            );
            if let Err(copy_err) = copy_dir_recursive(src, dst) {
                // Half-copied → clean up the partial destination so the
                // user's old data stays intact.
                let _ = std::fs::remove_dir_all(dst);
                return Err(format!(
                    "copy fallback failed for {}: {copy_err} (original rename error: {e})",
                    src.display()
                ));
            }
            // Copy succeeded — now delete source. If delete fails, the
            // data is safely at dst but we have a duplicate at src.
            // Surface that as a warning, not a hard failure.
            if let Err(del_err) = std::fs::remove_dir_all(src) {
                eprintln!(
                    "[migrate] copy succeeded but source delete failed for {}: {del_err}",
                    src.display()
                );
                return Err(format!(
                    "moved content to {} but couldn't delete original at {} ({del_err}). \
                     Verify both locations and delete the old copy manually.",
                    dst.display(),
                    src.display()
                ));
            }
            Ok(())
        }
    }
}

/// True if `child` is `parent` or sits anywhere underneath it. Used to
/// reject "move library to a folder inside the current library" which
/// would otherwise create a cycle. Compares canonicalized paths when
/// possible (so symlinks / `..` segments don't bypass the check) and
/// falls back to lexical comparison when canonicalization fails (target
/// might not exist yet).
fn path_is_inside(child: &Path, parent: &Path) -> bool {
    let canon_child = std::fs::canonicalize(child).ok();
    let canon_parent = std::fs::canonicalize(parent).ok();
    match (canon_child, canon_parent) {
        (Some(c), Some(p)) => c.starts_with(&p),
        _ => child.starts_with(parent),
    }
}

#[tauri::command]
pub async fn library_migrate_root(
    app: AppHandle,
    state: tauri::State<'_, LibraryState>,
    settings: tauri::State<'_, crate::settings::SettingsState>,
    registry: tauri::State<'_, crate::JobRegistry>,
    new_root: String,
) -> Result<MigrateResult, String> {
    let new_root_trimmed = new_root.trim();
    if new_root_trimmed.is_empty() {
        return Err("new_root is empty".into());
    }
    let new_root_path = PathBuf::from(new_root_trimmed);

    // Refuse migration if any download is in flight. The alternative
    // would be to coordinate with the JobRegistry — pause workers,
    // wait for child processes to finish — but that's enough
    // complexity to deserve its own session. For 1.0.5 the rule is:
    // ALL downloads complete or canceled before migrating.
    let active_jobs = registry
        .children
        .lock()
        .map(|m| m.len())
        .unwrap_or(0);
    if active_jobs > 0 {
        return Err(format!(
            "Can't migrate while {active_jobs} download(s) are running. \
             Wait for them to finish or cancel them, then retry."
        ));
    }

    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let old_root = crate::settings::content_root(&settings, &home);

    // Validate target.
    if path_is_inside(&new_root_path, &old_root) || path_is_inside(&old_root, &new_root_path) {
        // Includes the "same path" case (a path is inside itself for
        // starts_with purposes). Refuse cycles either direction.
        if new_root_path == old_root {
            return Err("New root is the same as current root — nothing to do.".into());
        }
        return Err(format!(
            "Can't migrate into a folder that's nested inside the current root \
             (or vice versa): {} ↔ {}",
            old_root.display(),
            new_root_path.display()
        ));
    }

    // Create new_root if it doesn't exist yet; if it does, ensure the
    // critical subdirs aren't already populated (we'd clobber).
    std::fs::create_dir_all(&new_root_path)
        .map_err(|e| format!("create new_root {}: {e}", new_root_path.display()))?;
    for subdir in ["Library", "Projects", "_thumbnails"] {
        let candidate = new_root_path.join(subdir);
        if candidate.exists() {
            let is_empty = std::fs::read_dir(&candidate)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
            if !is_empty {
                return Err(format!(
                    "New root already contains '{subdir}/' with files. \
                     Pick an empty folder or remove existing content first: {}",
                    candidate.display()
                ));
            }
        }
    }

    // Move the three content subdirs. Track which moved + which were
    // missing-at-source (e.g. a fresh install that never created
    // _thumbnails/ yet).
    let mut moved_dirs: Vec<String> = Vec::new();
    let mut skipped_dirs: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for subdir in ["Library", "Projects", "_thumbnails"] {
        let src = old_root.join(subdir);
        let dst = new_root_path.join(subdir);
        if !src.exists() {
            skipped_dirs.push(subdir.to_string());
            continue;
        }
        // Remove the empty candidate dir we may have created during
        // the validation check above — move_dir refuses if dst exists.
        if dst.exists() {
            let _ = std::fs::remove_dir(&dst);
        }
        if let Err(e) = move_dir(&src, &dst) {
            // Hard fail: surface what already moved so the user knows
            // recovery state. They can manually finish or roll back.
            return Err(format!(
                "Move failed at '{subdir}/': {e}\n\
                 Successfully moved before failure: {moved_dirs:?}\n\
                 Old root: {}\nNew root: {}",
                old_root.display(),
                new_root_path.display()
            ));
        }
        moved_dirs.push(subdir.to_string());
    }

    // Rewrite asset file_path rows. Single transaction — all-or-nothing
    // at the DB layer. Pattern: take rows whose file_path starts with
    // the old_root string, swap that prefix for the new_root string.
    //
    // We use string-prefix matching rather than canonical-path math
    // because the stored file_path values are exactly what the
    // download flow wrote — same casing, same separators. SQLite's
    // LIKE doesn't natively know about prefix matching efficiently
    // but for our row counts (< 10k assets typical) it's fine.
    let old_prefix = old_root.to_string_lossy().to_string();
    let new_prefix = new_root_path.to_string_lossy().to_string();

    let updated = {
        let mut tx = state
            .pool
            .begin()
            .await
            .map_err(|e| format!("db transaction begin: {e}"))?;

        // Fetch all rows that look like they live under the old root.
        // We do this in Rust rather than `UPDATE ... WHERE file_path LIKE`
        // so we can warn about edge cases (paths that don't actually
        // start with the prefix, mid-string matches, etc.).
        let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, file_path, thumbnail_path FROM assets WHERE file_path LIKE ?",
        )
        .bind(format!("{}%", old_prefix))
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("db select: {e}"))?;

        let mut count = 0u32;
        for (id, file_path, thumbnail_path) in &rows {
            // Defensive: ensure the prefix actually matches as a path
            // boundary (next char after prefix should be a separator).
            // Avoids accidentally rewriting a different folder that
            // happens to share a string prefix.
            let after_prefix = &file_path[old_prefix.len()..];
            if !after_prefix.starts_with(std::path::MAIN_SEPARATOR) && !after_prefix.is_empty() {
                warnings.push(format!(
                    "Skipped suspicious row id={id} path={file_path} (prefix matched but not at a path boundary)"
                ));
                continue;
            }
            let rewritten = format!("{new_prefix}{after_prefix}");
            sqlx::query("UPDATE assets SET file_path = ? WHERE id = ?")
                .bind(&rewritten)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("db update id={id}: {e}"))?;

            // 1.1 — thumbnail_path patch. 1.0.5's migration forgot
            // this column, leaving every thumbnail pointing at the
            // old `<root>/_thumbnails/...` location after a move.
            // Same prefix-boundary safety as file_path.
            if let Some(tp) = thumbnail_path {
                if tp.starts_with(&old_prefix) {
                    let tp_after = &tp[old_prefix.len()..];
                    if tp_after.starts_with(std::path::MAIN_SEPARATOR) || tp_after.is_empty() {
                        let new_tp = format!("{new_prefix}{tp_after}");
                        sqlx::query(
                            "UPDATE assets SET thumbnail_path = ? WHERE id = ?",
                        )
                        .bind(&new_tp)
                        .bind(id)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| format!("db update thumbnail id={id}: {e}"))?;
                    }
                }
            }
            count += 1;
        }

        tx.commit()
            .await
            .map_err(|e| format!("db transaction commit: {e}"))?;
        count
    };

    // Persist the new root in settings. Done LAST so a failure here
    // doesn't leave us with a half-migrated state where settings point
    // at a new location but content + DB rows still reference the old.
    if let Err(e) =
        crate::settings::set_library_root(&app, &settings, Some(new_prefix.clone()))
    {
        warnings.push(format!(
            "Migration complete but failed to persist new library_root in settings: {e}. \
             Set it manually in Settings → Library."
        ));
    }

    // Tell the UI to reload.
    let _ = app.emit("library:changed", ());

    Ok(MigrateResult {
        old_root: old_prefix,
        new_root: new_prefix,
        moved_dirs,
        skipped_dirs,
        asset_rows_updated: updated,
        warnings,
    })
}

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
    root_path: Option<String>,
) -> Result<Project, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".into());
    }
    if trimmed.len() > 80 {
        return Err("project name exceeds 80 chars".into());
    }

    // 1.3.0 — optional custom folder. Normalize empty → None, then
    // validate: must be creatable + a directory. We create it now so the
    // folder exists immediately (an editor can point their NLE at it
    // before the first download lands).
    let root_path = match root_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) => {
            let pb = PathBuf::from(&p);
            std::fs::create_dir_all(&pb)
                .map_err(|e| format!("create project folder {p}: {e}"))?;
            if !pb.is_dir() {
                return Err(format!("project folder is not a directory: {p}"));
            }
            // Store the path as the picker gave it (already absolute +
            // clean). We deliberately DON'T canonicalize: on Windows that
            // yields a `\\?\C:\...` extended-length prefix that both looks
            // wrong in the UI and can trip yt-dlp's `-P` handling.
            Some(p)
        }
    };

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

    sqlx::query(
        "INSERT INTO projects (id, name, slug, created_at, root_path) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed)
    .bind(&slug)
    .bind(now)
    .bind(&root_path)
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
        root_path,
    })
}

/// 1.3.0 — resolve a project's absolute on-disk folder (the same dir
/// downloads land in). Used by the Projects UI "Open folder" button,
/// which can't compute the managed path itself (it doesn't know
/// content_root). Does NOT create the folder — just reports where it is.
#[tauri::command]
pub async fn project_dir(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings_state: State<'_, crate::settings::SettingsState>,
    id: String,
) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let content_root = crate::settings::content_root(&settings_state, &home);
    let dir = resolve_download_dir(&state, &content_root, Some(&id)).await?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn project_list(state: State<'_, LibraryState>) -> Result<Vec<Project>, String> {
    // LEFT JOIN keeps zero-asset projects in the result. ORDER BY
    // created_at DESC so newest projects float up (matches the
    // "I just made this, where is it" expectation).
    let rows = sqlx::query_as::<_, (String, String, String, i64, i64, Option<String>)>(
        r#"SELECT p.id, p.name, p.slug, p.created_at,
                  COALESCE(COUNT(a.id), 0) AS asset_count,
                  p.root_path
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
        .map(|(id, name, slug, created_at, asset_count, root_path)| Project {
            id,
            name,
            slug,
            created_at,
            asset_count,
            root_path,
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
    settings_state: State<'_, crate::settings::SettingsState>,
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
    let content_root = crate::settings::content_root(&settings_state, &home);
    let target_dir = resolve_download_dir(&state, &content_root, project_id.as_deref()).await?;

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
    settings_state: State<'_, crate::settings::SettingsState>,
    id: String,
    promote: bool,
) -> Result<(), String> {
    // Resolve slug + custom root first — needed for the folder path AND
    // we want to bail clearly if the project doesn't exist.
    let (slug, root_path) = project_paths_for(&state.pool, &id)
        .await
        .map_err(|e| format!("project_finish lookup: {e}"))?
        .ok_or_else(|| format!("project {id} not found"))?;

    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;
    let content_root = crate::settings::content_root(&settings_state, &home);
    // Only legacy managed projects have an app-owned folder we may trash.
    // Custom-location projects point at the user's own folder — NEVER
    // trash that (it may be the root of their real NLE project).
    let managed_dir = root_path
        .is_none()
        .then(|| content_root.join("Projects").join(&slug));

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

        let library_dir = content_root.join("Library").join("raw");
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

    // Trash the project folder — ONLY for legacy managed projects.
    // `managed_dir` is None for custom-location projects, so their
    // user-owned folder is left completely untouched. Missing-folder is
    // fine (empty project, or files cleaned up out-of-band).
    if let Some(project_dir) = &managed_dir {
        if project_dir.exists() {
            if let Err(e) = trash::delete(project_dir) {
                return Err(format!(
                    "could not move {} to trash: {e}",
                    project_dir.display()
                ));
            }
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
// 1.1 Phase 2 — Folder CRUD + asset assignment
// =====================================================================
//
// Folders are user-named organizational buckets, orthogonal to
// projects. See migrations/007_folders.sql for the schema rationale.
//
// Commands:
//   folder_create(name) → Folder            (case-insensitive unique name)
//   folder_list()       → Vec<Folder>       (sorted by created_at DESC,
//                                            with asset_count per folder)
//   folder_rename(id, name)                 (same uniqueness rule)
//   folder_delete(id)                       (FK SET NULL → assets fall
//                                            back to Uncategorized)
//   asset_set_folder(asset_id, folder_id?)  (single-asset assignment)
//   asset_set_folder_many(asset_ids, folder_id?) (batch from inspector)
//
// All mutators emit `library:changed` so the sidebar + grid refresh.

#[derive(Serialize, Debug, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    /// Count of assets DIRECTLY in this folder (not descendants).
    /// Computed in folder_list via LEFT JOIN; not stored on the row.
    /// The frontend rolls up descendant totals itself from the tree
    /// when the "show subfolder contents" toggle is on.
    pub asset_count: i64,
    /// 1.3.x — nesting. NULL = top-level folder.
    pub parent_id: Option<String>,
    /// Optional Eagle-style accent color (palette key or hex). NULL =
    /// default neutral icon.
    pub color: Option<String>,
    /// Manual sort order within the parent. Lower = higher in the list.
    pub position: i64,
}

#[tauri::command]
pub async fn folder_create(
    app: AppHandle,
    state: State<'_, LibraryState>,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Folder, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("folder name is empty".into());
    }
    if trimmed.len() > 80 {
        return Err("folder name exceeds 80 chars".into());
    }
    // Validate the parent exists (if given) so we don't create orphans.
    if let Some(pid) = &parent_id {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM folders WHERE id = ? LIMIT 1")
            .bind(pid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| format!("folder_create parent-check: {e}"))?;
        if exists.is_none() {
            return Err(format!("parent folder {pid} not found"));
        }
    }
    // Case-insensitive dupe pre-check scoped to the SAME parent, for a
    // friendlier error than the DB unique-index violation.
    let dupe: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM folders \
         WHERE name = ? COLLATE NOCASE \
           AND COALESCE(parent_id, '') = COALESCE(?, '') LIMIT 1",
    )
    .bind(trimmed)
    .bind(&parent_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("folder_create dupe-check: {e}"))?;
    if dupe.is_some() {
        return Err(format!(
            "a folder named \"{trimmed}\" already exists here"
        ));
    }
    // New folder sorts to the end of its parent's list.
    let next_pos: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM folders \
         WHERE COALESCE(parent_id, '') = COALESCE(?, '')",
    )
    .bind(&parent_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| format!("folder_create position: {e}"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO folders (id, name, created_at, parent_id, color, position) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed)
    .bind(now)
    .bind(&parent_id)
    .bind(&color)
    .bind(next_pos.0)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("folder_create: {e}"))?;
    let _ = app.emit("library:changed", ());
    Ok(Folder {
        id,
        name: trimmed.to_string(),
        created_at: now,
        asset_count: 0,
        parent_id,
        color,
        position: next_pos.0,
    })
}

#[tauri::command]
pub async fn folder_list(state: State<'_, LibraryState>) -> Result<Vec<Folder>, String> {
    // LEFT JOIN keeps zero-asset folders visible (you just made one,
    // it should appear immediately even before you assign anything).
    // asset_count is DIRECT items only — the frontend builds the tree
    // and rolls up descendants itself when needed. Order by manual
    // position first, then name — the frontend re-groups by parent_id
    // to build the tree, so a flat global order is fine here.
    let rows = sqlx::query_as::<_, (String, String, i64, i64, Option<String>, Option<String>, i64)>(
        r#"SELECT f.id, f.name, f.created_at,
                  COALESCE(COUNT(a.id), 0) AS asset_count,
                  f.parent_id, f.color, f.position
           FROM folders f
           LEFT JOIN assets a ON a.folder_id = f.id
           GROUP BY f.id
           ORDER BY f.position ASC, f.name COLLATE NOCASE ASC"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("folder_list: {e}"))?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, created_at, asset_count, parent_id, color, position)| Folder {
                id,
                name,
                created_at,
                asset_count,
                parent_id,
                color,
                position,
            },
        )
        .collect())
}

#[tauri::command]
pub async fn folder_rename(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("folder name is empty".into());
    }
    if trimmed.len() > 80 {
        return Err("folder name exceeds 80 chars".into());
    }
    // Dupe-check scoped to the folder's own parent (siblings only).
    let dupe: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM folders \
         WHERE name = ? COLLATE NOCASE AND id != ? \
           AND COALESCE(parent_id, '') = \
               COALESCE((SELECT parent_id FROM folders WHERE id = ?), '') \
         LIMIT 1",
    )
    .bind(trimmed)
    .bind(&id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("folder_rename dupe-check: {e}"))?;
    if dupe.is_some() {
        return Err(format!("a folder named \"{trimmed}\" already exists here"));
    }
    let res = sqlx::query("UPDATE folders SET name = ? WHERE id = ?")
        .bind(trimmed)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("folder_rename: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("folder {id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn folder_delete(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    // CASCADE delete: remove the folder AND its entire subtree of
    // descendants in one transaction. Clips anywhere in that subtree
    // fall back to Uncategorized (NULL) — files stay on disk.
    //
    // Why cascade rather than reparent-children-up: reparenting a child
    // to the grandparent can collide with the per-(parent, name) UNIQUE
    // index when a same-named folder already exists there (e.g. two
    // "Untitled"s), which used to fail the whole delete. Cascade also
    // matches the user's mental model — "delete this folder and what's
    // in it" — the way Finder / Explorer behave.
    //
    // The recursive CTE walks parent_id links from `id` down through
    // every descendant. SQLite enforces FKs only with PRAGMA
    // foreign_keys = ON (off by default per connection), so we do the
    // asset-nulling + folder delete explicitly.
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| format!("folder_delete begin: {e}"))?;

    // Guard: confirm the folder exists (preserves the old not-found error).
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM folders WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("folder_delete lookup: {e}"))?;
    if exists.is_none() {
        return Err(format!("folder {id} not found"));
    }

    // Collect the subtree with depth, then delete DEEPEST-FIRST. This is
    // the crucial detail: folders.parent_id has ON DELETE SET NULL and
    // foreign_keys is ON, so deleting a parent while it still has children
    // fires SET NULL on those children — which can collide with the
    // per-(parent, name) unique index (e.g. a child "Untitled" being
    // pushed to top-level where an "Untitled" already exists). Deleting
    // leaves first means every folder is childless by the time it's
    // removed, so the SET NULL action never runs on a surviving row.
    // (Assets fall back to NULL automatically via their own FK as each
    // folder goes — no unique index on assets, so that's always safe.)
    let subtree: Vec<(String,)> = sqlx::query_as(
        "WITH RECURSIVE subtree(id, depth) AS (\
           SELECT id, 0 FROM folders WHERE id = ?1 \
           UNION ALL \
           SELECT f.id, s.depth + 1 FROM folders f JOIN subtree s ON f.parent_id = s.id\
         ) \
         SELECT id FROM subtree ORDER BY depth DESC",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("folder_delete subtree: {e}"))?;

    for (fid,) in &subtree {
        sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(fid)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("folder_delete: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("folder_delete commit: {e}"))?;
    let _ = app.emit("library:changed", ());
    Ok(())
}

/// 1.3.x — Bulk-delete folders in one transaction (one confirm, not
/// fifty). Direct assets in any deleted folder fall back to
/// Uncategorized; surviving children of a deleted folder re-parent to
/// top level (NULL) so nothing is left pointing at a dead row.
#[tauri::command]
pub async fn folder_delete_many(
    app: AppHandle,
    state: State<'_, LibraryState>,
    ids: Vec<String>,
) -> Result<u32, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| format!("folder_delete_many begin: {e}"))?;

    // CASCADE, deepest-first. Same reasoning as folder_delete: the
    // ON DELETE SET NULL on folders.parent_id (with foreign_keys ON) will
    // collide with the per-(parent, name) unique index if a parent is
    // removed while children survive, so we gather the combined subtree
    // ordered by depth and delete leaves first. Seeding the CTE from ALL
    // selected ids at once means picking a parent and a child together is
    // harmless — the subtree just overlaps (DISTINCT de-dupes).
    let subtree_sql = format!(
        "WITH RECURSIVE subtree(id, depth) AS (\
           SELECT id, 0 FROM folders WHERE id IN ({placeholders}) \
           UNION ALL \
           SELECT f.id, s.depth + 1 FROM folders f JOIN subtree s ON f.parent_id = s.id\
         ) \
         SELECT id FROM subtree GROUP BY id ORDER BY MAX(depth) DESC"
    );
    let mut q = sqlx::query_as::<_, (String,)>(&subtree_sql);
    for id in &ids {
        q = q.bind(id);
    }
    let subtree: Vec<(String,)> = q
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("folder_delete_many subtree: {e}"))?;

    let mut deleted: u64 = 0;
    for (fid,) in &subtree {
        let res = sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(fid)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("folder_delete_many: {e}"))?;
        deleted += res.rows_affected();
    }

    tx.commit()
        .await
        .map_err(|e| format!("folder_delete_many commit: {e}"))?;
    let _ = app.emit("library:changed", ());
    Ok(deleted as u32)
}

/// 1.3.x — Reparent a folder under a new parent (or to top-level when
/// `new_parent_id` is None). Guards against cycles: a folder can't be
/// moved into itself or any of its own descendants.
#[tauri::command]
pub async fn folder_move(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    if Some(&id) == new_parent_id.as_ref() {
        return Err("can't move a folder into itself".into());
    }
    // Cycle guard: walk up from new_parent_id to the root; if we hit
    // `id` along the way, the move would create a loop.
    if let Some(target) = &new_parent_id {
        let mut cursor = Some(target.clone());
        while let Some(cur) = cursor {
            if cur == id {
                return Err("can't move a folder into its own subfolder".into());
            }
            let row: Option<(Option<String>,)> =
                sqlx::query_as("SELECT parent_id FROM folders WHERE id = ?")
                    .bind(&cur)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| format!("folder_move cycle-check: {e}"))?;
            match row {
                Some((parent,)) => cursor = parent,
                None => return Err(format!("target folder {cur} not found")),
            }
        }
    }
    // Name-collision guard within the destination parent.
    let dupe: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM folders \
         WHERE id != ? AND name = (SELECT name FROM folders WHERE id = ?) COLLATE NOCASE \
           AND COALESCE(parent_id, '') = COALESCE(?, '') LIMIT 1",
    )
    .bind(&id)
    .bind(&id)
    .bind(&new_parent_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("folder_move dupe-check: {e}"))?;
    if dupe.is_some() {
        return Err("a folder with that name already exists in the destination".into());
    }
    // Append to the end of the destination's order.
    let next_pos: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM folders \
         WHERE COALESCE(parent_id, '') = COALESCE(?, '')",
    )
    .bind(&new_parent_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| format!("folder_move position: {e}"))?;
    let res = sqlx::query("UPDATE folders SET parent_id = ?, position = ? WHERE id = ?")
        .bind(&new_parent_id)
        .bind(next_pos.0)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("folder_move: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("folder {id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

/// 1.3.x — Set (or clear, with None) a folder's accent color.
#[tauri::command]
pub async fn folder_set_color(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    color: Option<String>,
) -> Result<(), String> {
    let res = sqlx::query("UPDATE folders SET color = ? WHERE id = ?")
        .bind(&color)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("folder_set_color: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("folder {id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

/// 1.3.x — Persist a manual ordering for a set of sibling folders. The
/// frontend passes the ordered id list for one parent after a drag; we
/// write each id's index as its `position`.
#[tauri::command]
pub async fn folder_reorder(
    app: AppHandle,
    state: State<'_, LibraryState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    if ordered_ids.is_empty() {
        return Ok(());
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| format!("folder_reorder begin: {e}"))?;
    for (idx, fid) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE folders SET position = ? WHERE id = ?")
            .bind(idx as i64)
            .bind(fid)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("folder_reorder: {e}"))?;
    }
    tx.commit()
        .await
        .map_err(|e| format!("folder_reorder commit: {e}"))?;
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn asset_set_folder(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    // folder_id = None → move to Uncategorized.
    // We don't validate the folder exists here — the FK constraint
    // will reject invalid ids, and the user-facing flow only ever
    // sends ids from folder_list output.
    let res = sqlx::query("UPDATE assets SET folder_id = ? WHERE id = ?")
        .bind(&folder_id)
        .bind(&asset_id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("asset_set_folder: {e}"))?;
    if res.rows_affected() == 0 {
        return Err(format!("asset {asset_id} not found"));
    }
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn asset_set_folder_many(
    app: AppHandle,
    state: State<'_, LibraryState>,
    asset_ids: Vec<String>,
    folder_id: Option<String>,
) -> Result<u32, String> {
    if asset_ids.is_empty() {
        return Ok(0);
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| format!("asset_set_folder_many tx begin: {e}"))?;
    let mut count = 0u32;
    for id in &asset_ids {
        let res = sqlx::query("UPDATE assets SET folder_id = ? WHERE id = ?")
            .bind(&folder_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("asset_set_folder_many id={id}: {e}"))?;
        count += res.rows_affected() as u32;
    }
    tx.commit()
        .await
        .map_err(|e| format!("asset_set_folder_many tx commit: {e}"))?;
    if count > 0 {
        let _ = app.emit("library:changed", ());
    }
    Ok(count)
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

// =====================================================================
// 1.1.3 — Orphan / partial-download scan
// =====================================================================
//
// On app boot we scan the library + project roots for files that
// shouldn't be there: leftover `*.part`, `*.ytdl`, `*.tmp` files from
// yt-dlp / ffmpeg sessions that were killed mid-stream (PC sleep,
// crash, user closing the app without confirming, etc.). These can
// quietly fill the disk — a tester reported ffmpeg eating CPU after
// "closing" the app, which left behind a 2 GB partial mp4 that the
// user had no idea about.
//
// Two-step: `library_scan_orphans` returns the list (UI shows a banner
// with size + count), then `library_clean_orphans` moves them to the
// OS Recycle Bin via the `trash` crate (same code path Library delete
// uses, so they're recoverable for a while).
//
// Safety knobs:
//   - Only files older than `min_age_seconds` qualify (default 5 min).
//     Prevents racing with in-flight downloads from another instance.
//   - Only files matching whitelist extensions: .part, .ytdl, .tmp
//     plus yt-dlp's intermediate `.f<id>.<ext>` pattern (rare;
//     normally yt-dlp cleans these up but kill-mid-merge leaves them).
//   - Walks only `Library/raw` + `Projects/*/raw` — never touches
//     the user's wider filesystem.

#[derive(Debug, Serialize)]
pub struct OrphanFile {
    pub path: String,
    pub size: i64,
    pub modified_unix: i64,
}

#[derive(Debug, Serialize)]
pub struct OrphanScanResult {
    pub files: Vec<OrphanFile>,
    pub total_bytes: i64,
}

const ORPHAN_MIN_AGE_SECS: i64 = 300; // 5 minutes
const ORPHAN_EXTENSIONS: &[&str] = &["part", "ytdl", "tmp"];

fn is_orphan_filename(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    for ext in ORPHAN_EXTENSIONS {
        if lower.ends_with(&format!(".{ext}")) {
            return true;
        }
    }
    // yt-dlp intermediate format-specific files: e.g. "vid.f137.mp4".
    // These should be auto-merged then deleted; if they linger past the
    // age threshold AND have no completed sibling in DB, treat as orphans.
    // Match `.f` followed by digits then `.` (extension after).
    if let Some(stem) = std::path::Path::new(&lower).file_stem().and_then(|s| s.to_str()) {
        if let Some(dot) = stem.rfind('.') {
            let after = &stem[dot + 1..];
            if after.starts_with('f') && after[1..].chars().all(|c| c.is_ascii_digit()) && !after[1..].is_empty() {
                return true;
            }
        }
    }
    false
}

/// Walk a single `raw/` directory looking for orphan files older than
/// the threshold. Pushes matches into `out`. Errors during the walk
/// are logged + skipped (we never want orphan scan to fail boot).
fn collect_orphans_in(root: &Path, now: i64, out: &mut Vec<OrphanFile>) {
    let read = match std::fs::read_dir(root) {
        Ok(r) => r,
        Err(_) => return, // dir missing → nothing to scan
    };
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !is_orphan_filename(name) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if now - modified < ORPHAN_MIN_AGE_SECS {
            continue; // probably in-flight; leave alone
        }
        out.push(OrphanFile {
            path: path.to_string_lossy().to_string(),
            size: meta.len() as i64,
            modified_unix: modified,
        });
    }
}

#[tauri::command]
pub async fn library_scan_orphans(
    _app: AppHandle,
    _state: tauri::State<'_, LibraryState>,
    settings_state: tauri::State<'_, crate::settings::SettingsState>,
) -> Result<OrphanScanResult, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let content_root = crate::settings::content_root(&settings_state, &home);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut files: Vec<OrphanFile> = Vec::new();

    // Library/raw
    collect_orphans_in(&content_root.join("Library").join("raw"), now, &mut files);

    // Projects/*/raw — iterate project dirs
    if let Ok(read) = std::fs::read_dir(content_root.join("Projects")) {
        for entry in read.flatten() {
            let pdir = entry.path();
            if pdir.is_dir() {
                collect_orphans_in(&pdir.join("raw"), now, &mut files);
            }
        }
    }

    let total_bytes: i64 = files.iter().map(|f| f.size).sum();
    Ok(OrphanScanResult { files, total_bytes })
}

#[tauri::command]
pub async fn library_clean_orphans(paths: Vec<String>) -> Result<u32, String> {
    let mut removed: u32 = 0;
    let mut errors: Vec<String> = Vec::new();
    for p in paths {
        match trash::delete(&p) {
            Ok(()) => removed += 1,
            Err(e) => errors.push(format!("{p}: {e}")),
        }
    }
    if !errors.is_empty() {
        eprintln!("library_clean_orphans: {} failures:", errors.len());
        for e in errors.iter().take(5) {
            eprintln!("  {e}");
        }
    }
    Ok(removed)
}
