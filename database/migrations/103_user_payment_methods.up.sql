-- Persist the payment methods a user has saved.
--
-- Background. Migration 102 gave each person a Stripe Customer. This table
-- records the cards attached to it. Stripe remains the SOURCE OF TRUTH for card
-- data (brand, last4, expiry, whether it still exists); this table exists for
-- the three things a Stripe round-trip cannot give us:
--
--   1. FAIL-CLOSED CHARGEABILITY. Before the settlement sweeper attempts an
--      off-session charge on an auction win it must answer "does this buyer have
--      a card we may charge?" — for a batch of orders, on a cron, without the
--      buyer present. Asking Stripe once per order per pass is a per-order
--      network call on a path that must stay cheap and must fail CLOSED when
--      Stripe is degraded. A local row lets "no instrument on file" be a
--      decision we make from our own data, and a Stripe outage then means
--      "don't charge" rather than "charge blindly".
--
--   2. WHICH CARD IS DEFAULT, as an invariant we control. Stripe stores this on
--      customer.invoice_settings.default_payment_method, a single mutable field
--      with no history. The partial unique index below makes "at most one
--      default per user" a constraint the database enforces, so a half-applied
--      update can never leave a user with two defaults (ambiguous: which card
--      gets charged?) — the failure mode is a rejected write, not a silently
--      wrong charge.
--
--   3. AUDIT. Money moved off a card; we need a local record of which card was
--      on file when, independent of a third party we do not control and whose
--      objects the GDPR erasure path deletes.
--
-- DELIBERATELY ABSENT: any card number, CVC, expiry-as-secret, or Stripe
-- client_secret. Only the opaque pm_ token plus the display fields Stripe itself
-- classifies as non-sensitive (brand/last4/exp) — the same set already carried by
-- domain.PaymentMethod and already rendered to the user. Nothing here is PII
-- requiring secretbox under the migration 031/033 inventory, and nothing here is
-- in PCI scope: the platform never touches a PAN (CLAUDE.md §6).

CREATE TABLE user_payment_methods (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id),

    -- The Stripe PaymentMethod token (pm_...). Globally unique at Stripe, so
    -- unique here too: this is what makes persistence idempotent. The
    -- setup_intent.succeeded event handler and the synchronous
    -- GetSetupIntentStatus fast path both write the same method, and Stripe
    -- redelivers successful events — every one of those is an upsert onto this
    -- key, never a duplicate.
    stripe_payment_method_id TEXT NOT NULL,

    -- The Customer this method is attached to, denormalized from
    -- users.stripe_customer_id at write time. Kept so an off-session charge can
    -- read (customer, payment_method) as one consistent pair, and so a card that
    -- was attached to a superseded Customer is visibly stale rather than
    -- silently mismatched.
    stripe_customer_id       TEXT NOT NULL,

    type                     TEXT NOT NULL DEFAULT 'card',
    brand                    TEXT NOT NULL DEFAULT '',
    last_four                TEXT NOT NULL DEFAULT '',
    exp_month                INTEGER NOT NULL DEFAULT 0,
    exp_year                 INTEGER NOT NULL DEFAULT 0,

    is_default               BOOLEAN NOT NULL DEFAULT false,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Soft delete (CLAUDE.md §5: deleted_at, not a boolean). A detached card
    -- must stay readable: it may be the card a completed payment was taken on.
    deleted_at               TIMESTAMPTZ
);

-- Idempotency key for the upsert. Unconditional (not partial): a pm_ id is
-- unique at Stripe, so re-attaching a previously detached method must revive
-- THIS row rather than insert a second one.
CREATE UNIQUE INDEX idx_user_payment_methods_stripe_pm
    ON user_payment_methods (stripe_payment_method_id);

-- Owner lookup: the only read pattern (list this user's live cards).
CREATE INDEX idx_user_payment_methods_user
    ON user_payment_methods (user_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- At most one default per user, enforced by the database rather than by
-- application discipline. Partial on the live+default set so ordinary cards and
-- soft-deleted cards do not collide.
CREATE UNIQUE INDEX idx_user_payment_methods_one_default
    ON user_payment_methods (user_id)
    WHERE is_default AND deleted_at IS NULL;

COMMENT ON TABLE user_payment_methods IS
    'Saved Stripe PaymentMethods per user. Stripe is authoritative for card data; this table exists for fail-closed chargeability checks, a DB-enforced single default, and audit. Never stores a PAN, CVC, or client_secret.';
COMMENT ON COLUMN user_payment_methods.stripe_payment_method_id IS
    'Opaque Stripe PaymentMethod token (pm_...). Unique — the upsert key that makes redelivered setup_intent.succeeded events idempotent.';
COMMENT ON COLUMN user_payment_methods.is_default IS
    'Mirrors customer.invoice_settings.default_payment_method at Stripe. At most one live default per user (idx_user_payment_methods_one_default).';
COMMENT ON COLUMN user_payment_methods.deleted_at IS
    'Soft delete, set when the method is detached at Stripe. Detached cards stay readable because a completed payment may reference them.';
