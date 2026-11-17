-- Reverse migration 140. Dropping the table revokes every calendar feed minted
-- since 140; subscribed calendars 401 until the user mints a new URL.
-- Development only — production is forward-only (CLAUDE.md §5).

SET lock_timeout = '5s';

DROP TABLE IF EXISTS calendar_feed_tokens;
