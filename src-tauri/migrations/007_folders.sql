-- 1.1 Phase 2: library folders (Eagle-inspired)
--
-- Folders are user-named buckets that organize assets ORTHOGONALLY
-- to projects:
--   - Projects scope downloads + can be "finished" (folder routing
--     on disk, OS-trash on finish). Lifecycle-bound.
--   - Folders are pure organizational metadata. No filesystem
--     impact, no lifecycle. An asset stays in its on-disk location
--     no matter what folder it's tagged with.
--
-- Schema:
--   - folders.id: UUID
--   - folders.name: display name, case-insensitive unique
--   - folders.created_at: unix epoch
--
-- Future-proofing left out of MVP, can ALTER-ADD later without pain:
--   - parent_id (nesting)
--   - color (Eagle-style 6-color palette)
--   - sort_order (manual reorder)
--   - icon
--
-- Asset side: nullable folder_id. NULL = "Uncategorized" (default,
-- back-compat with every existing row). Foreign key cascades to NULL
-- so deleting a folder doesn't lose assets — they just fall back to
-- Uncategorized.

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_created_at ON folders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_folders_name ON folders(name COLLATE NOCASE);

ALTER TABLE assets ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_folder_id ON assets(folder_id);
