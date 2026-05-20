-- Media Hub — initial schema
--
-- Single table for the library. Tags / projects / FTS search come in
-- later migrations once the read+write loop is proven.
--
-- Identifiers:
--   id          — UUID v4 generated server-side at insert. We use this
--                 as the canonical asset reference everywhere; never
--                 surface file_path as an identifier (paths change).
--   video_id    — platform-native id (YouTube watch?v=, Twitter status
--                 id, etc.). Indexed for "do we already have this?"
--                 dedup lookups.
--   platform    — 'youtube' | 'twitter' | future sources. Lowercase.
--
-- Times:
--   downloaded_at — Unix epoch seconds (NOT milliseconds). SQLite's
--                   default for INTEGER columns. Use chrono::Utc::now()
--                   .timestamp() in Rust.
--   in_sec/out_sec — REAL fractional seconds, NULL when the asset is
--                    a full-source download (no segment trim).
--
-- File data:
--   file_path   — absolute path on disk. May change if user relocates
--                 the library root later; v1 doesn't track moves.
--   file_size   — bytes at insert time; not updated on later modifies.
--
-- Encoding:
--   transcoded_to — preset name string ('prores_422_lt' etc.) if a
--                   transcode was applied; NULL if the file is the
--                   raw download.

CREATE TABLE IF NOT EXISTS assets (
    id              TEXT PRIMARY KEY NOT NULL,
    source_url      TEXT NOT NULL,
    platform        TEXT NOT NULL,
    video_id        TEXT,
    channel         TEXT,
    title           TEXT NOT NULL,
    duration_sec    REAL,
    in_sec          REAL,
    out_sec         REAL,
    file_path       TEXT NOT NULL,
    file_size       INTEGER,
    container       TEXT,
    codec_video     TEXT,
    codec_audio     TEXT,
    width           INTEGER,
    height          INTEGER,
    fps             REAL,
    transcoded_to   TEXT,
    thumbnail_url   TEXT,
    downloaded_at   INTEGER NOT NULL
);

-- Newest-first browsing is the default sort.
CREATE INDEX IF NOT EXISTS idx_assets_downloaded_at
    ON assets(downloaded_at DESC);

-- Dedup lookups: "do I already have <platform>:<video_id>?"
CREATE INDEX IF NOT EXISTS idx_assets_platform_video_id
    ON assets(platform, video_id);

-- Channel browsing.
CREATE INDEX IF NOT EXISTS idx_assets_platform_channel
    ON assets(platform, channel);
