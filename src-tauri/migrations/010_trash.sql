-- 1.3.0 — in-app trash (soft-delete) for clips.
--
-- Instead of permanently `remove_file`-ing a clip (today's "Delete file"
-- behavior) or relying on the OS Recycle Bin, deleting a clip now moves
-- its file into <content_root>/_trash/ and marks the row as trashed. The
-- row is KEPT so the clip can be restored from within the app.
--
--   deleted_at IS NULL        → live clip (shows in the Library)
--   deleted_at = <unix secs>  → in the in-app Trash view
--
-- trash_original_path remembers where the file lived so Restore can put
-- it back. file_path is repointed to the _trash copy while trashed.
--
-- Retention is manual: items stay until the user empties the Trash.
ALTER TABLE assets ADD COLUMN deleted_at INTEGER;
ALTER TABLE assets ADD COLUMN trash_original_path TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at);
