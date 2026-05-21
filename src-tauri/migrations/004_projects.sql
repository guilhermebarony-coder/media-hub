-- 0.6 Phase A: project foundations
--
-- Projects are user-named buckets that scope downloads and library
-- views. Every asset belongs to either:
--   - The Library (project_id IS NULL) — reusable, "lives forever"
--   - One project (project_id = projects.id) — scoped, finishable
--
-- An asset is in exactly one place at a time. The Copy/Promote
-- operations move (or duplicate then move) the asset's row + file
-- on disk; they're a Phase B concern, not Phase A.
--
-- `slug` is computed at create-time from `name` (sanitized for
-- filesystem use). Storing it once keeps folder names stable when
-- the display name is later renamed — no orphaned dirs.

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,                       -- UUID
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,    -- display name
  slug       TEXT NOT NULL UNIQUE,                   -- filesystem-safe, stable
  created_at INTEGER NOT NULL                        -- unix epoch
);

CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

ALTER TABLE assets ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
