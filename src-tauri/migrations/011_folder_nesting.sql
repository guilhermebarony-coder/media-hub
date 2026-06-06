-- 1.3.x — Folder nesting (Eagle-style hierarchy).
--
-- Adds the three columns migration 007 explicitly deferred:
--   - parent_id : self-referential FK. NULL = top-level folder.
--                 ON DELETE SET NULL so deleting a parent re-parents
--                 its children to top-level rather than cascading them
--                 into oblivion. (The Rust folder_delete re-parents to
--                 the deleted folder's OWN parent for nicer behavior;
--                 this FK is the backstop.)
--   - color     : optional Eagle-style accent (hex or palette key).
--                 NULL = default neutral folder icon.
--   - position  : manual sort order within a parent. Lower = higher
--                 in the list. Defaults to 0; ties break on name.
--
-- These ALTERs error with "duplicate column name" on second launch,
-- which the migration loop swallows (same pattern as earlier migrations).
--
-- NOTE: the rest of the nesting migration — dropping migration 007's
-- global UNIQUE on folders.name (incompatible with nesting, since two
-- folders can share a name under different parents) and creating the
-- nesting indexes — is handled by the guarded Rust step
-- `migrate_folders_for_nesting`, because a column-constraint drop needs
-- a table rebuild that can't run idempotently in this naive loop.

ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN color TEXT;
ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
