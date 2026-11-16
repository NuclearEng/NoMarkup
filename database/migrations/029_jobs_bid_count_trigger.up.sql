-- Bug 3: jobs.bid_count denormalized counter drifts out of sync because
-- nothing in the schema or service code maintains it. The seed (and dev
-- environments) end up with rows where bid_count = 2 but bids has 8 rows
-- for the same job.
--
-- Fix: install an AFTER INSERT/UPDATE/DELETE trigger on bids that recomputes
-- the count for affected job_id(s) on every change, then backfill.

CREATE OR REPLACE FUNCTION trigger_update_bid_count()
RETURNS TRIGGER AS $$
DECLARE
    target_job_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        target_job_id := NEW.job_id;
    ELSIF TG_OP = 'UPDATE' THEN
        target_job_id := NEW.job_id;
    ELSIF TG_OP = 'DELETE' THEN
        target_job_id := OLD.job_id;
    END IF;

    UPDATE jobs
       SET bid_count = (
                SELECT count(*)
                  FROM bids
                 WHERE job_id = target_job_id
                   AND status NOT IN ('expired', 'withdrawn')
           )
     WHERE id = target_job_id;

    IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
        UPDATE jobs
           SET bid_count = (
                    SELECT count(*)
                      FROM bids
                     WHERE job_id = OLD.job_id
                       AND status NOT IN ('expired', 'withdrawn')
               )
         WHERE id = OLD.job_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bids_update_bid_count ON bids;
CREATE TRIGGER bids_update_bid_count
    AFTER INSERT OR UPDATE OF status, job_id OR DELETE
    ON bids
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_bid_count();

-- One-shot backfill so existing rows match reality.
UPDATE jobs
   SET bid_count = (
            SELECT count(*)
              FROM bids
             WHERE bids.job_id = jobs.id
               AND bids.status NOT IN ('expired', 'withdrawn')
       );
