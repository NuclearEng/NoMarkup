-- Seed marketplace_offers so admin can toggle Best-Offer API (money-adjacent).
-- Previously UI-only / unseeded (default client fail-open).
INSERT INTO feature_flags (key, enabled, description) VALUES
    ('marketplace_offers', true, 'Best-offer / counter-offer chain on goods listings (accept mints pending_payment order)')
ON CONFLICT (key) DO NOTHING;
