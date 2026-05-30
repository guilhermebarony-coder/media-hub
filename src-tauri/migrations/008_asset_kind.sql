-- Media Hub — asset kind (1.2.0)
--
-- Adds a `kind` column so the library can distinguish audio-only
-- downloads from video. Future kinds: 'image' (gallery-dl sidecar),
-- 'archive' (full playlist bundle), etc.
--
-- Defaults to 'video' so existing rows back-fill correctly with no
-- one-time migration script needed — every clip in the DB pre-1.2.0
-- was a video.
--
-- Why a string and not an enum: SQLite has no enum type, and storing
-- as text lets future kinds land via a simple INSERT without schema
-- changes. The renderer treats unknown kinds as 'video' (safest
-- fallback for old apps reading new data).
--
-- ALTER TABLE ADD COLUMN doesn't support IF NOT EXISTS in SQLite —
-- the init loop in library.rs swallows the "duplicate column name"
-- error so this stays idempotent across launches.
ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'video';

-- Cheap to index — we'll filter the grid by kind soon (Audio tab in
-- the library, "all audio" view, etc.).
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
