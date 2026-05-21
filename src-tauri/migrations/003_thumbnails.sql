-- 0.5.1: local thumbnail extraction
--
-- thumbnail_url already holds the remote (YouTube CDN) thumbnail URL.
-- Local mid-clip frames extracted from the downloaded file land in
-- ~/Media Hub/_thumbnails/<asset_id>.jpg and the path is recorded here.
-- The UI prefers local-when-present so segment downloads show what's
-- actually in the trimmed clip, not the source video's official thumb.

ALTER TABLE assets ADD COLUMN thumbnail_path TEXT;
