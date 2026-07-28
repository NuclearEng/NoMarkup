-- FE-14: goods order reviews (MVP).
--
-- Separate from services `reviews` (contract_id/job_id, double-blind dims).
-- Listing orders are gateway-SQL primary path; this table backs a minimal
-- buyer↔seller overall rating after escrow release. Not double-blind, not
-- 8-dimension — overall_rating (+ optional text) only.
--
-- Eligibility (app layer): escrow_status = 'released', party on the order,
-- within review_window_ends (released_at + 14d at write time), one review
-- per (order_id, reviewer_id).

CREATE TABLE listing_order_reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES listing_orders(id) ON DELETE RESTRICT,
    listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
    reviewer_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewee_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewer_role       TEXT NOT NULL CHECK (reviewer_role IN ('buyer', 'seller')),
    overall_rating      SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    review_text         TEXT, -- optional; app enforces max 2000
    status              TEXT NOT NULL DEFAULT 'published'
                        CHECK (status IN ('published', 'flagged', 'removed')),
    review_window_ends  TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, reviewer_id)
);

CREATE TRIGGER set_updated_at_listing_order_reviews
    BEFORE UPDATE ON listing_order_reviews
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_listing_order_reviews_reviewee
    ON listing_order_reviews (reviewee_id, status)
    WHERE status = 'published';

CREATE INDEX idx_listing_order_reviews_order
    ON listing_order_reviews (order_id);

CREATE INDEX idx_listing_order_reviews_reviewer
    ON listing_order_reviews (reviewer_id);

COMMENT ON TABLE listing_order_reviews IS
    'MVP goods reviews: overall rating after released listing_orders. Not services double-blind contract reviews.';
