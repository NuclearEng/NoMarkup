-- Tier 1 production-readiness fix: jobs.bid_count was racy under
-- concurrent bid placement.
--
-- Migration 029 installed a trigger that recomputed bid_count via
-- `SELECT count(*) FROM bids WHERE job_id=$1 ...`. Under READ COMMITTED,
-- the subquery in the trigger's SET clause uses a snapshot from the
-- start of the UPDATE statement, which does NOT include in-flight
-- inserts from other concurrent transactions even after waiting for
-- the jobs-row lock to release. Result: with 8 concurrent bid
-- placements, bid_count was observed to land anywhere from 1 to 6
-- instead of 8 (services/job/internal/service/bid_race_test.go).
--
-- Fix: switch to atomic delta updates (`bid_count = bid_count + 1` on
-- INSERT, `- 1` on DELETE/expire/withdraw). Postgres re-evaluates the
-- target row's current value on every UPDATE attempt under READ
-- COMMITTED — so `bid_count + 1` always reflects the latest committed
-- value plus this transaction's contribution.

CREATE OR REPLACE FUNCTION trigger_update_bid_count()
RETURNS TRIGGER AS $$
DECLARE
    target_job_id  UUID;
    became_inactive BOOLEAN := false;
    became_active   BOOLEAN := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Only count it if it lands as a "live" bid. New bids default
        -- to status='active' so this is true in practice; we still
        -- gate to keep the trigger consistent with deletes.
        IF NEW.status NOT IN ('expired', 'withdrawn') THEN
            UPDATE jobs
               SET bid_count = bid_count + 1
             WHERE id = NEW.job_id;
        END IF;
        RETURN NULL;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status NOT IN ('expired', 'withdrawn') THEN
            UPDATE jobs
               SET bid_count = GREATEST(bid_count - 1, 0)
             WHERE id = OLD.job_id;
        END IF;
        RETURN NULL;

    ELSIF TG_OP = 'UPDATE' THEN
        -- A bid moving in/out of the (expired, withdrawn) set changes
        -- whether it counts. Job changes are extremely rare but we
        -- handle them defensively by treating it as delete-old +
        -- insert-new.
        became_active   := OLD.status IN ('expired', 'withdrawn')
                       AND NEW.status NOT IN ('expired', 'withdrawn');
        became_inactive := OLD.status NOT IN ('expired', 'withdrawn')
                       AND NEW.status IN ('expired', 'withdrawn');

        IF OLD.job_id IS DISTINCT FROM NEW.job_id THEN
            -- bid moved jobs (defensive — should not happen)
            IF OLD.status NOT IN ('expired', 'withdrawn') THEN
                UPDATE jobs
                   SET bid_count = GREATEST(bid_count - 1, 0)
                 WHERE id = OLD.job_id;
            END IF;
            IF NEW.status NOT IN ('expired', 'withdrawn') THEN
                UPDATE jobs
                   SET bid_count = bid_count + 1
                 WHERE id = NEW.job_id;
            END IF;
        ELSIF became_active THEN
            UPDATE jobs
               SET bid_count = bid_count + 1
             WHERE id = NEW.job_id;
        ELSIF became_inactive THEN
            UPDATE jobs
               SET bid_count = GREATEST(bid_count - 1, 0)
             WHERE id = NEW.job_id;
        END IF;
        RETURN NULL;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to the same surface area.
DROP TRIGGER IF EXISTS bids_update_bid_count ON bids;
CREATE TRIGGER bids_update_bid_count
    AFTER INSERT OR UPDATE OF status, job_id OR DELETE
    ON bids
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_bid_count();

-- Re-backfill so any pre-fix drift is corrected.
UPDATE jobs
   SET bid_count = (
            SELECT count(*)
              FROM bids
             WHERE bids.job_id = jobs.id
               AND bids.status NOT IN ('expired', 'withdrawn')
       );
