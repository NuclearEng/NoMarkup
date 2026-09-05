-- 130: Job-level abuse reports (ASR-1.2.b).
--
-- Listings could be flagged (036 listing_reports + 074 attributable auto-hide);
-- jobs — the other core UGC surface — had no equivalent. This table mirrors
-- listing_reports so intake, admin queue, and the one-open-report-per-reporter
-- rule carry over.
--
-- Reasons are job-flavored (no stolen/counterfeit — those are goods-only).
-- Reporter is optional (anonymous reports queue for moderation) but the
-- auto-hide trigger counts DISTINCT authenticated reporters only, matching
-- migration 074. Jobs have no is_hidden column; timely hide sets
-- jobs.deleted_at when currently NULL (browse/search already filter it).

CREATE TABLE IF NOT EXISTS job_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    -- Reporter is optional — "report this job" works for anonymous visitors
    -- (rate-limited at the gateway). Signed-in reports record user_id for
    -- the fraud trail and for the attributable auto-hide count.
    reporter_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    reason          TEXT NOT NULL CHECK (reason IN (
        'prohibited', 'misleading', 'spam', 'scam', 'harassment', 'other'
    )),
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'reviewed', 'actioned', 'dismissed'
    )),
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    resolution      TEXT,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_reports_job_id
    ON job_reports (job_id);
CREATE INDEX IF NOT EXISTS idx_job_reports_status
    ON job_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_reports_reporter
    ON job_reports (reporter_id);

-- One open report per signed-in reporter per job (anonymous rows skipped).
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_reports_open_reporter
    ON job_reports (job_id, reporter_id)
    WHERE status = 'open' AND reporter_id IS NOT NULL;

-- Supports the trigger's DISTINCT-reporter count.
CREATE INDEX IF NOT EXISTS idx_job_reports_open_reporters
    ON job_reports (job_id, reporter_id)
    WHERE status = 'open';

DROP TRIGGER IF EXISTS job_reports_set_updated_at ON job_reports;
CREATE TRIGGER job_reports_set_updated_at
    BEFORE UPDATE ON job_reports
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ASR-1.2.b timely hide: ≥3 open reports from distinct authenticated
-- accounts soft-delete the job (deleted_at) if it is not already deleted.
-- Anonymous reports still queue; they never auto-hide on their own.
CREATE OR REPLACE FUNCTION trigger_job_reports_auto_hide()
RETURNS TRIGGER AS $$
DECLARE
    target_job     UUID;
    reporter_count INTEGER;
BEGIN
    target_job := COALESCE(NEW.job_id, OLD.job_id);

    -- COUNT(DISTINCT ...) already skips NULLs; the explicit predicate keeps
    -- the intent legible: only signed-in, attributable reporters count
    -- toward an automated punitive action (mirrors 074).
    SELECT COUNT(DISTINCT reporter_id) INTO reporter_count
      FROM job_reports
     WHERE job_id = target_job
       AND status = 'open'
       AND reporter_id IS NOT NULL;

    IF reporter_count >= 3 THEN
        -- ASR-1.2.b timely hide — jobs have no is_hidden; deleted_at is the
        -- existing browse/search exclusion. Only set when currently NULL so
        -- a later report cannot clobber an earlier customer/admin delete.
        UPDATE jobs
           SET deleted_at = now(),
               updated_at = now()
         WHERE id = target_job
           AND deleted_at IS NULL;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS job_reports_auto_hide ON job_reports;
CREATE TRIGGER job_reports_auto_hide
    AFTER INSERT OR UPDATE OF status ON job_reports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_job_reports_auto_hide();
