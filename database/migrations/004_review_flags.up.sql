-- NoMarkup: Add review_flags table
-- The review_flags table tracks user-submitted flags on reviews for admin moderation.
-- Referenced by: services/job/internal/repository/review_repo.go

CREATE TABLE review_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  flagged_by        UUID NOT NULL REFERENCES users(id),
  reason            TEXT NOT NULL CHECK (reason IN ('inappropriate', 'fake', 'harassment', 'spam', 'irrelevant')),
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'dismissed')),
  resolved_by       UUID REFERENCES users(id),
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_review_flags
  BEFORE UPDATE ON review_flags
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Index on review_id for JOIN from reviews and lookups by review
CREATE INDEX idx_review_flags_review_id ON review_flags (review_id);

-- Index on status for admin filtering (AdminListFlaggedReviews filters by rf.status)
CREATE INDEX idx_review_flags_status ON review_flags (status);

-- Index on created_at for ORDER BY rf.created_at DESC in admin listing
CREATE INDEX idx_review_flags_created_at ON review_flags (created_at DESC);

-- Index on flagged_by for looking up flags submitted by a specific user
CREATE INDEX idx_review_flags_flagged_by ON review_flags (flagged_by);

-- Partial index for pending flags (most common admin query)
CREATE INDEX idx_review_flags_pending ON review_flags (created_at DESC) WHERE status = 'pending';
