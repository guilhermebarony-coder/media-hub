-- Media Hub — tags schema
--
-- Two tables: a normalized tags catalog and a join to assets. We
-- normalize so tag rename / merge is cheap later.
--
-- Names are case-insensitive (NOCASE collation) — "B-roll" and "b-roll"
-- and "B-Roll" are the same tag. We preserve the casing the user typed
-- (no toLowerCase) so display reads naturally.
--
-- CASCADE on the foreign keys means deleting an asset row drops its
-- tag links automatically. Deleting a tag row drops its links too —
-- useful for the "merge or rename tags" feature when we add it.

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);

-- Lookups in the other direction: "which assets have this tag?"
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag_id
    ON asset_tags(tag_id);
