-- 074: Close the unauthenticated listing auto-hide path.
--
-- Migration 036 wired an automated, admin-equivalent action (setting
-- listings.is_hidden = true, which removes a live auction from browse,
-- detail, search and follower feeds) to a raw COUNT(*) of open rows in
-- listing_reports. Because POST /api/v1/listings/{id}/report accepts
-- anonymous reports and nothing deduped them, three unauthenticated requests
-- from a single client were enough to delist any listing on the platform
-- until an admin manually resolved every report and called reactivate.
--
-- The report intake stays anonymous — that is a deliberate product choice —
-- but intake is now decoupled from enforcement:
--
--   1. The auto-hide threshold counts DISTINCT authenticated reporters.
--      Anonymous reports still queue for moderation; they never auto-hide.
--   2. A partial unique index enforces the one-open-report-per-reporter rule
--      in the database, mirroring uq_user_reports_open_user from 073's
--      sibling surface (migration 067). The gateway had this check in Go but
--      it was unreachable, because the route ran no auth middleware and so
--      claims were never populated.
--
-- Listings already hidden by the old rule are intentionally left hidden.
-- Un-hiding them in bulk would also un-hide genuinely reported listings
-- (stolen goods, counterfeits); admins have POST /api/v1/admin/listings/
-- {id}/reactivate for the ones that were sabotaged.

-- ── 1. Replace the trigger function FIRST ────────────────────────────────
-- Ordering matters: step 2 updates listing_reports.status, which fires this
-- trigger. Replacing the function first means the backfill runs under the
-- safe rule rather than the vulnerable one.
CREATE OR REPLACE FUNCTION trigger_listing_reports_auto_hide()
RETURNS TRIGGER AS $$
DECLARE
    target_listing UUID;
    reporter_count INTEGER;
BEGIN
    target_listing := COALESCE(NEW.listing_id, OLD.listing_id);

    -- COUNT(DISTINCT ...) already skips NULLs; the explicit predicate keeps
    -- the intent legible: only signed-in, attributable reporters count
    -- toward an automated punitive action.
    SELECT COUNT(DISTINCT reporter_id) INTO reporter_count
      FROM listing_reports
     WHERE listing_id = target_listing
       AND status = 'open'
       AND reporter_id IS NOT NULL;

    IF reporter_count >= 3 THEN
        UPDATE listings
           SET is_hidden = true,
               hidden_reason = 'auto: >=3 open reports from distinct accounts',
               updated_at = now()
         WHERE id = target_listing
           AND is_hidden = false;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Collapse pre-existing duplicate open reports ──────────────────────
-- Required before the unique index can build. Keeps the earliest open report
-- per (listing, reporter) and dismisses the rest.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY listing_id, reporter_id
               ORDER BY created_at, id
           ) AS rn
      FROM listing_reports
     WHERE status = 'open'
       AND reporter_id IS NOT NULL
)
UPDATE listing_reports lr
   SET status     = 'dismissed',
       resolution = COALESCE(
           lr.resolution,
           'auto: collapsed duplicate open report (migration 074)'
       ),
       updated_at = now()
  FROM ranked
 WHERE lr.id = ranked.id
   AND ranked.rn > 1;

-- ── 3. Enforce one open report per reporter per listing ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_reports_open_reporter
    ON listing_reports (listing_id, reporter_id)
    WHERE status = 'open' AND reporter_id IS NOT NULL;

-- Supports the trigger's DISTINCT-reporter count.
CREATE INDEX IF NOT EXISTS idx_listing_reports_open_reporters
    ON listing_reports (listing_id, reporter_id)
    WHERE status = 'open';
