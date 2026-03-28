-- Provider Challenges & Seasonal Events
-- Time-limited competitions with progress tracking and rewards for providers.

CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    challenge_type TEXT NOT NULL CHECK (challenge_type IN ('jobs_completed', 'five_star_reviews', 'response_time', 'bid_win_rate', 'revenue_milestone', 'category_specialist')),
    target_value INTEGER NOT NULL,
    reward_type TEXT NOT NULL CHECK (reward_type IN ('badge', 'priority_placement', 'fee_discount', 'profile_highlight')),
    reward_value TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_seasonal BOOLEAN NOT NULL DEFAULT false,
    season_name TEXT,
    max_participants INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE challenge_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES users(id),
    current_progress INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    reward_claimed BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(challenge_id, provider_id)
);

CREATE TRIGGER set_challenges_updated_at
    BEFORE UPDATE ON challenges FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_challenge_participants_updated_at
    BEFORE UPDATE ON challenge_participants FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_challenges_active ON challenges (ends_at, starts_at);
CREATE INDEX idx_challenge_participants_challenge ON challenge_participants (challenge_id);
CREATE INDEX idx_challenge_participants_provider ON challenge_participants (provider_id);

-- Seed initial challenges
INSERT INTO challenges (title, description, challenge_type, target_value, reward_type, reward_value, starts_at, ends_at, is_seasonal, season_name) VALUES
    ('First 5 Jobs', 'Complete your first 5 jobs on NoMarkup', 'jobs_completed', 5, 'badge', 'Rising Star', now(), now() + interval '90 days', false, null),
    ('Review Champion', 'Earn 10 five-star reviews', 'five_star_reviews', 10, 'profile_highlight', '30_days', now(), now() + interval '90 days', false, null),
    ('Speed Demon', 'Respond to 20 job inquiries within 1 hour', 'response_time', 20, 'priority_placement', '7_days', now(), now() + interval '30 days', true, 'Spring Sprint 2026'),
    ('Win Streak', 'Win 15 bids this month', 'bid_win_rate', 15, 'fee_discount', '10_percent_30_days', now(), now() + interval '30 days', true, 'Spring Sprint 2026');
