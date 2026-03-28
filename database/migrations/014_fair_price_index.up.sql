-- Fair Price Index: materialized view for public pricing data by category and ZIP code.
-- Aggregates completed-contract pricing to power the SEO-friendly "What does X cost?" page.

CREATE MATERIALIZED VIEW IF NOT EXISTS fair_price_index AS
SELECT
    sc.id AS category_id,
    sc.name AS category_name,
    sc.slug AS category_slug,
    COALESCE(j.service_zip, 'unknown') AS zip_code,
    COUNT(DISTINCT c.id) AS completed_jobs,
    ROUND(AVG(b.amount_cents)) AS avg_price_cents,
    ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY b.amount_cents)) AS p25_price_cents,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.amount_cents)) AS median_price_cents,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY b.amount_cents)) AS p75_price_cents,
    MIN(b.amount_cents) AS min_price_cents,
    MAX(b.amount_cents) AS max_price_cents,
    ROUND(AVG(j.starting_bid_cents - b.amount_cents) FILTER (WHERE j.starting_bid_cents IS NOT NULL)) AS avg_savings_cents,
    now() AS refreshed_at
FROM contracts c
JOIN bids b ON b.id = c.bid_id
JOIN jobs j ON j.id = c.job_id
JOIN service_categories sc ON sc.id = j.category_id
WHERE c.status = 'completed'
    AND b.amount_cents > 0
    AND j.deleted_at IS NULL
GROUP BY sc.id, sc.name, sc.slug, j.service_zip
HAVING COUNT(DISTINCT c.id) >= 3;  -- Minimum sample size for meaningful data

CREATE UNIQUE INDEX idx_fair_price_index_category_zip
    ON fair_price_index (category_id, zip_code);
CREATE INDEX idx_fair_price_index_slug
    ON fair_price_index (category_slug);
CREATE INDEX idx_fair_price_index_zip
    ON fair_price_index (zip_code);
