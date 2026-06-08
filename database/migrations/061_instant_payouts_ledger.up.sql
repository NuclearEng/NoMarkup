-- 061_instant_payouts_ledger.up.sql
--
-- Durable ledger for provider instant payouts (CLAUDE.md §6: idempotency is
-- mandatory on payment mutations; §15: money paths fail closed and must be
-- recorded, never report unrecorded success).
--
-- Background: the gateway's InstantPayout handler had real fee + eligibility
-- math but wrote NO record and returned a FAKE payout_id ("payout-<userID>").
-- Its "daily cap" was faked (no ledger to sum against). The security audit
-- flagged this as the highest-risk gap: the platform fronts real money and
-- reported success without persisting anything, so the rolling daily clawback
-- cap was unenforceable and replays double-paid.
--
-- This table is the source of truth for every instant payout. The gateway:
--   * dedups on (provider_id, idempotency_key) for idempotent replay, and
--   * sums amount_cents over the trailing 24h window for the REAL daily cap.
--
-- Money is BIGINT cents (§5). UUID v7-style ids via gen_random_uuid (the rest
-- of the schema uses gen_random_uuid for gateway-issued rows). stripe_payout_id
-- holds the Stripe Payout API id in prod; in dev it carries the mock id
-- "payout_dev_<short-uuid>" (mirrors the advances' "tr_platform_dev_<uuid>").

CREATE TABLE instant_payouts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id       UUID        NOT NULL,
    amount_cents      BIGINT      NOT NULL,
    fee_cents         BIGINT      NOT NULL,
    net_cents         BIGINT      NOT NULL,
    status            TEXT        NOT NULL,
    stripe_payout_id  TEXT,
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT instant_payouts_amount_positive    CHECK (amount_cents > 0),
    CONSTRAINT instant_payouts_fee_nonnegative     CHECK (fee_cents >= 0),
    CONSTRAINT instant_payouts_net_positive        CHECK (net_cents > 0),
    CONSTRAINT instant_payouts_net_consistent      CHECK (net_cents = amount_cents - fee_cents),
    CONSTRAINT instant_payouts_status_valid        CHECK (status IN ('pending', 'completed', 'failed'))
);

COMMENT ON TABLE instant_payouts IS
    'Ledger of provider instant payouts. Source of truth for idempotent replay (provider_id, idempotency_key) and the rolling 24h daily cap (sum amount_cents). Written by the gateway InstantPayout handler.';
COMMENT ON COLUMN instant_payouts.stripe_payout_id IS
    'Stripe Payout API id in prod; dev mock "payout_dev_<short-uuid>" (mirrors advances'' "tr_platform_dev_<uuid>").';
COMMENT ON COLUMN instant_payouts.idempotency_key IS
    'Client-supplied Idempotency-Key. NULL = no key sent. Deduped per provider via idx_instant_payouts_idempotency.';

-- Idempotency: a second payout with the same (provider, key) collides and the
-- handler replays the prior row instead of paying again. Partial so legacy
-- NULL-key rows never collide.
CREATE UNIQUE INDEX idx_instant_payouts_idempotency
    ON instant_payouts (provider_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;

-- Backs the rolling daily-cap query:
--   SELECT COALESCE(SUM(amount_cents),0) FROM instant_payouts
--    WHERE provider_id = $1 AND created_at >= now() - interval '24 hours'
CREATE INDEX idx_instant_payouts_provider_created
    ON instant_payouts (provider_id, created_at);
