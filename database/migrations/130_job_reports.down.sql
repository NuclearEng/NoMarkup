-- Down for 130. Drops job report intake and the auto-hide trigger.
--
-- Jobs whose deleted_at was set by the auto-hide trigger are intentionally
-- left deleted: bulk un-hiding would also restore genuinely reported jobs.
-- Admins can restore a false-positive via existing job admin tools.

DROP TRIGGER IF EXISTS job_reports_auto_hide ON job_reports;
DROP FUNCTION IF EXISTS trigger_job_reports_auto_hide();
DROP TRIGGER IF EXISTS job_reports_set_updated_at ON job_reports;
DROP INDEX IF EXISTS idx_job_reports_open_reporters;
DROP INDEX IF EXISTS uq_job_reports_open_reporter;
DROP INDEX IF EXISTS idx_job_reports_reporter;
DROP INDEX IF EXISTS idx_job_reports_status;
DROP INDEX IF EXISTS idx_job_reports_job_id;
DROP TABLE IF EXISTS job_reports;
