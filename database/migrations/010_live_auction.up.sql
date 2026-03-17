-- Live Auction Arena: auction_type, anti-snipe tracking, bid events, savings, streaks

-- Jobs table: add auction_type and anti-snipe tracking
ALTER TABLE jobs ADD COLUMN auction_type TEXT NOT NULL DEFAULT 'sealed'
  CHECK (auction_type IN ('sealed', 'live'));
ALTER TABLE jobs ADD COLUMN snipe_extension_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN original_auction_ends_at TIMESTAMPTZ;

-- Bid event log for price chart (denormalized, no provider_id = privacy by design)
CREATE TABLE auction_bid_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('bid_placed','bid_updated','bid_withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auction_bid_events_job ON auction_bid_events (job_id, created_at);

-- Savings tracker (computed post-job-completion)
CREATE TABLE user_savings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  awarded_cents BIGINT NOT NULL,
  market_median_cents BIGINT NOT NULL,
  savings_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX idx_user_savings_user ON user_savings (user_id, created_at DESC);

-- Provider streaks and rankings
CREATE TABLE provider_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id),
  category_id UUID REFERENCES service_categories(id),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  category_rank INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, category_id)
);
CREATE INDEX idx_provider_streaks_rank ON provider_streaks (category_id, total_wins DESC);
