-- Bug 2: UI reads jobs.lowest_bid_cents but the column did not exist.
-- Add it and keep it current via a trigger on the bids table.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lowest_bid_cents BIGINT NULL;

-- Backfill existing rows from current active bids.
UPDATE jobs j
   SET lowest_bid_cents = sub.min_amount
  FROM (
        SELECT job_id, MIN(amount_cents) AS min_amount
          FROM bids
         WHERE status NOT IN ('expired', 'withdrawn')
         GROUP BY job_id
       ) sub
 WHERE sub.job_id = j.id;

-- Trigger: keep jobs.lowest_bid_cents current as bids are created/updated/deleted.
CREATE OR REPLACE FUNCTION trigger_update_lowest_bid_cents()
RETURNS TRIGGER AS $$
DECLARE
    target_job_id UUID;
BEGIN
    -- Pick the job_id that needs recomputing. For UPDATE we may need to handle
    -- both the OLD and NEW job_id, but bids.job_id is immutable in practice
    -- (no UPDATE path changes it). We still cover both for safety.
    IF TG_OP = 'INSERT' THEN
        target_job_id := NEW.job_id;
    ELSIF TG_OP = 'UPDATE' THEN
        target_job_id := NEW.job_id;
    ELSIF TG_OP = 'DELETE' THEN
        target_job_id := OLD.job_id;
    END IF;

    -- Recompute from scratch (handles inserts, status flips, withdrawals,
    -- amount edits, and deletes uniformly).
    UPDATE jobs
       SET lowest_bid_cents = (
                SELECT MIN(amount_cents)
                  FROM bids
                 WHERE job_id = target_job_id
                   AND status NOT IN ('expired', 'withdrawn')
           )
     WHERE id = target_job_id;

    -- If UPDATE moved a bid between jobs (defensive), recompute the OLD job too.
    IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
        UPDATE jobs
           SET lowest_bid_cents = (
                    SELECT MIN(amount_cents)
                      FROM bids
                     WHERE job_id = OLD.job_id
                       AND status NOT IN ('expired', 'withdrawn')
               )
         WHERE id = OLD.job_id;
    END IF;

    RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bids_update_lowest_bid_cents ON bids;
CREATE TRIGGER bids_update_lowest_bid_cents
    AFTER INSERT OR UPDATE OF amount_cents, status, job_id OR DELETE
    ON bids
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_lowest_bid_cents();

CREATE INDEX IF NOT EXISTS idx_jobs_lowest_bid_cents
    ON jobs (lowest_bid_cents)
    WHERE lowest_bid_cents IS NOT NULL AND deleted_at IS NULL;
