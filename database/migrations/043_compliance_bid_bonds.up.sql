-- Compliance + anti-fraud surface (Wave 4 audit Sections C, N).
--
-- Three new audit-grade tables:
--   • cookie_consent_log  — every banner Save creates a row (anonymous OK).
--                           Logged for GDPR / ePrivacy proof-of-consent.
--   • tos_versions        — version-pinned Terms of Service. The app reads
--                           the latest row on every login and re-prompts
--                           when the user's accepted version differs.
--   • tos_acceptances     — one row per (user_id, tos_version) pair.
--   • bid_bonds           — Stripe SetupIntent-based bid bond. First-time
--                           bidders post a bond before their first bid is
--                           accepted; trusted (released) bond keeps repeat
--                           bidders from re-bonding. Captured on no-show,
--                           released on completion or loss.
--
-- ON DELETE CASCADE on user_id everywhere ties this table family into the
-- GDPR-erasure cascade introduced by migration 032.
--
-- bid_bonds.status state machine:
--   pending → authorized → captured (forfeit on no-show)
--           → authorized → released (won + paid OR lost auction)
--           → cancelled  (auction cancelled / SetupIntent expired)
--
-- The 'pending' → 'authorized' transition is the one wired in this commit
-- (POST /api/v1/listings/{id}/bid-bond/confirm). 'authorized' → 'released'
-- and 'authorized' → 'captured' are deferred to a follow-up cron job that
-- runs on auction-close and listing_orders.escrow_status transitions.

CREATE TABLE cookie_consent_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id  TEXT,
    necessary   BOOLEAN NOT NULL DEFAULT TRUE,
    analytics   BOOLEAN NOT NULL DEFAULT FALSE,
    marketing   BOOLEAN NOT NULL DEFAULT FALSE,
    ip_hash     TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user consent timeline (most recent first). Partial — anonymous rows
-- (user_id IS NULL) live forever in a tail-scan path; only authenticated
-- users get the indexed lookup.
CREATE INDEX idx_cookie_consent_user
    ON cookie_consent_log (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE TABLE tos_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version       TEXT NOT NULL UNIQUE,
    effective_at  TIMESTAMPTZ NOT NULL,
    body_url      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tos_acceptances (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tos_version   TEXT NOT NULL,
    accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tos_version)
);

CREATE INDEX idx_tos_acceptances_user
    ON tos_acceptances (user_id, accepted_at DESC);

-- DOB columns on users. dob is the raw date (DATE — no time component),
-- dob_verified_at stamps the moment we accepted it. We never expose dob
-- through any GET endpoint; only the gateway's age-gate check reads it.
ALTER TABLE users ADD COLUMN dob              DATE;
ALTER TABLE users ADD COLUMN dob_verified_at  TIMESTAMPTZ;

CREATE TABLE bid_bonds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    stripe_pi_id    TEXT NOT NULL UNIQUE,
    amount_cents    BIGINT NOT NULL,
    status          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('pending', 'authorized', 'captured', 'released', 'cancelled')),
    CHECK (amount_cents > 0)
);

CREATE INDEX idx_bid_bonds_user_status
    ON bid_bonds (user_id, status);
CREATE INDEX idx_bid_bonds_listing
    ON bid_bonds (listing_id);

-- Seed the initial ToS version so the app has something to anchor on.
-- Subsequent versions are inserted by the platform admin tool. ON CONFLICT
-- keeps the migration idempotent across re-runs in dev.
INSERT INTO tos_versions (version, effective_at, body_url) VALUES
    ('1.0', now(), '/legal/terms')
ON CONFLICT (version) DO NOTHING;
