DROP TRIGGER IF EXISTS user_reports_set_updated_at ON user_reports;
DROP INDEX IF EXISTS uq_user_reports_open_user;
DROP INDEX IF EXISTS uq_user_reports_open_message;
DROP INDEX IF EXISTS idx_user_reports_status;
DROP INDEX IF EXISTS idx_user_reports_reporter;
DROP INDEX IF EXISTS idx_user_reports_reported_user;
DROP TABLE IF EXISTS user_reports;
