-- 1.4 — Eagle integration (one-way push).
--
-- Stores the Eagle item id returned for an asset once we start reading
-- it back (P3 dedup / re-send). P1 doesn't populate this — the
-- addFromPaths API returns only a status, not per-item ids — but we add
-- the column now so the future read-back path needs no migration.
-- NULL = never pushed (or pushed before we tracked ids).
ALTER TABLE assets ADD COLUMN eagle_item_id TEXT;
