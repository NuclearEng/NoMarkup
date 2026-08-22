-- Down for 132. Drops the server-side request-activity log.
-- Indexes are dropped with the table.

DROP INDEX IF EXISTS idx_user_request_activity_created;
DROP INDEX IF EXISTS idx_user_request_activity_request_id;
DROP INDEX IF EXISTS idx_user_request_activity_user_created;
DROP TABLE IF EXISTS user_request_activity;
