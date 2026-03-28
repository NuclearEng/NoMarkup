CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_feature_flags_updated_at
    BEFORE UPDATE ON feature_flags
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_feature_flags_key ON feature_flags (key);

-- Seed default flags for expansion features
INSERT INTO feature_flags (key, enabled, description) VALUES
    ('fair_price_index', false, 'Public pricing tool showing market rates by category and ZIP code'),
    ('spectator_mode', false, 'Allow anonymous users to watch live auctions'),
    ('nomarkup_guarantee', false, 'Platform-backed quality guarantee with claim flow'),
    ('smart_matching', false, 'Auto-match providers to new jobs based on category, proximity, and trust'),
    ('provider_business_os', false, 'Provider expense tracking, working capital, and business dashboard'),
    ('live_auction', true, 'Live auction arena with real-time bidding');
