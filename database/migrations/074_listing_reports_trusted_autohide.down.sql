-- Down for 074. Restores the migration 036 auto-hide rule verbatim.
--
-- NOTE: rolling this back reopens the unauthenticated delisting path — three
-- anonymous POSTs to /api/v1/listings/{id}/report will again hide any
-- listing. Only run this in development.
--
-- The status changes made by the up-migration's duplicate collapse are not
-- reverted: 'dismissed' is a valid terminal state and re-opening those rows
-- would resurrect report counts an admin may since have acted on.

DROP INDEX IF EXISTS idx_listing_reports_open_reporters;
DROP INDEX IF EXISTS uq_listing_reports_open_reporter;

CREATE OR REPLACE FUNCTION trigger_listing_reports_auto_hide()
RETURNS TRIGGER AS $$
DECLARE
    target_listing UUID;
    open_count     INTEGER;
BEGIN
    target_listing := COALESCE(NEW.listing_id, OLD.listing_id);

    SELECT COUNT(*) INTO open_count
      FROM listing_reports
     WHERE listing_id = target_listing
       AND status = 'open';

    IF open_count >= 3 THEN
        UPDATE listings
           SET is_hidden = true,
               hidden_reason = 'auto: ≥3 open reports',
               updated_at = now()
         WHERE id = target_listing
           AND is_hidden = false;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
