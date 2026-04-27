-- Revert to the recomputing trigger from migration 029.
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
