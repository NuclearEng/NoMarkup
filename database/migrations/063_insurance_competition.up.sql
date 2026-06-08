-- 063_insurance_competition.up.sql
--
-- Competitive insurance marketplace: insurers compete for the customer's
-- business. A customer requests a quote for a product type + coverage amount;
-- the gateway fans out to every approved insurer that offers that product type,
-- each returns a competing premium/deductible quote, the customer compares and
-- selects one, and a policy is bound to the winning insurer.
--
-- This is distinct from the FIXED per-job insurance catalog (migration 022,
-- insurance_products/insurance_policies/insurance_claims), which has a single
-- platform-set base_rate_bps per product. Here the rate is per-insurer, so
-- quotes differ and the customer shops. The whole feature is gated behind the
-- `insurance_competition` feature flag (seeded off in migration 060).
--
-- Conventions (CLAUDE.md §5): snake_case plural tables, UUID ids via
-- gen_random_uuid (matches the gateway-issued-row convention used by 022/061),
-- {singular}_id FKs, money is BIGINT cents, UTC created_at/updated_at, every FK
-- indexed, one logical migration with a matching .down.sql.

-- ── Insurers ────────────────────────────────────────────────────────────────
-- A carrier participating in the competitive marketplace. payout_account holds
-- the carrier's Stripe Connect account id in prod (mock id in dev), mirroring
-- how the rest of the schema stores Stripe ids as opaque TEXT.
CREATE TABLE insurers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL UNIQUE,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'suspended')),
    payout_account  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insurers_status ON insurers (status);

COMMENT ON TABLE insurers IS
    'Carriers competing in the insurance_competition marketplace. Only status=approved insurers receive quote-request fan-out.';

-- ── Insurer rate cards ───────────────────────────────────────────────────────
-- One row per (insurer, product_type): the insurer's quote inputs for that
-- product. base_rate_bps drives premium = coverage_cents * base_rate_bps/10000,
-- clamped up to min_premium_cents. Varied base_rate_bps across insurers is what
-- makes the marketplace competitive.
CREATE TABLE insurer_products (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    insurer_id        UUID        NOT NULL REFERENCES insurers (id) ON DELETE CASCADE,
    product_type      TEXT        NOT NULL,
    base_rate_bps     INT         NOT NULL,
    min_premium_cents BIGINT      NOT NULL DEFAULT 500,
    active            BOOLEAN     NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT insurer_products_rate_nonnegative CHECK (base_rate_bps >= 0),
    CONSTRAINT insurer_products_min_premium_nonnegative CHECK (min_premium_cents >= 0),
    -- An insurer offers each product type at most once.
    CONSTRAINT insurer_products_unique_offering UNIQUE (insurer_id, product_type)
);

CREATE INDEX idx_insurer_products_insurer_id ON insurer_products (insurer_id);
-- Fan-out query: find all active offerings for a requested product_type.
CREATE INDEX idx_insurer_products_product_type ON insurer_products (product_type);

COMMENT ON TABLE insurer_products IS
    'Per-insurer rate card row per product type. Fan-out selects active rows matching the requested product_type from approved insurers.';

-- ── Quote requests ───────────────────────────────────────────────────────────
-- A customer's request for competing quotes. contract_id is optional (a quote
-- can be requested against a specific service contract, or standalone).
-- selected_quote_id is set when the customer binds a winning quote; status moves
-- open -> bound (or open -> expired). No FK to insurance_quotes on
-- selected_quote_id to avoid a circular FK at create time; it is validated in
-- the handler (the selected quote must belong to this request).
CREATE TABLE insurance_quote_requests (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id       UUID        NOT NULL,
    contract_id       UUID,
    product_type      TEXT        NOT NULL,
    coverage_cents    BIGINT      NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'bound', 'expired')),
    selected_quote_id UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT insurance_quote_requests_coverage_positive CHECK (coverage_cents > 0)
);

CREATE INDEX idx_insurance_quote_requests_customer_id ON insurance_quote_requests (customer_id);
CREATE INDEX idx_insurance_quote_requests_contract_id ON insurance_quote_requests (contract_id);
CREATE INDEX idx_insurance_quote_requests_status ON insurance_quote_requests (status);

COMMENT ON TABLE insurance_quote_requests IS
    'A customer request for competing insurance quotes. Fans out to approved insurers; one is bound via selected_quote_id.';

-- ── Quotes ───────────────────────────────────────────────────────────────────
-- One competing quote per insurer per request, produced by the fan-out.
CREATE TABLE insurance_quotes (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id       UUID        NOT NULL REFERENCES insurance_quote_requests (id) ON DELETE CASCADE,
    insurer_id       UUID        NOT NULL REFERENCES insurers (id),
    premium_cents    BIGINT      NOT NULL,
    deductible_cents BIGINT      NOT NULL DEFAULT 0,
    terms            TEXT        NOT NULL DEFAULT '',
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT insurance_quotes_premium_positive CHECK (premium_cents > 0),
    CONSTRAINT insurance_quotes_deductible_nonnegative CHECK (deductible_cents >= 0),
    -- At most one quote per insurer per request (fan-out inserts one each).
    CONSTRAINT insurance_quotes_unique_per_insurer UNIQUE (request_id, insurer_id)
);

CREATE INDEX idx_insurance_quotes_request_id ON insurance_quotes (request_id);
CREATE INDEX idx_insurance_quotes_insurer_id ON insurance_quotes (insurer_id);

COMMENT ON TABLE insurance_quotes IS
    'One competing quote per insurer per quote-request. premium = coverage * insurer base_rate_bps, clamped to min_premium.';

-- ── Bound marketplace policies ───────────────────────────────────────────────
-- The fixed-catalog insurance_policies (022) requires product_id (FK to
-- insurance_products), provider_id and contract_id NOT NULL, and a sequence
-- policy_number — it models per-job, provider-bound coverage. A competitive
-- policy is bound to an INSURER (not a provider), may have no service contract,
-- and references a winning quote, so it is NOT schema-compatible. A dedicated
-- marketplace_policies table keeps the two products cleanly separated.
CREATE TABLE marketplace_policies (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id            UUID        NOT NULL REFERENCES insurance_quote_requests (id),
    quote_id              UUID        NOT NULL REFERENCES insurance_quotes (id),
    insurer_id            UUID        NOT NULL REFERENCES insurers (id),
    customer_id           UUID        NOT NULL,
    contract_id           UUID,
    product_type          TEXT        NOT NULL,
    coverage_amount_cents BIGINT      NOT NULL,
    premium_cents         BIGINT      NOT NULL,
    deductible_cents      BIGINT      NOT NULL DEFAULT 0,
    terms                 TEXT        NOT NULL DEFAULT '',
    status                TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'expired', 'cancelled')),
    effective_date        DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
    expiration_date       DATE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT marketplace_policies_coverage_positive CHECK (coverage_amount_cents > 0),
    CONSTRAINT marketplace_policies_premium_positive CHECK (premium_cents > 0),
    -- Idempotent bind: a request binds at most once.
    CONSTRAINT marketplace_policies_unique_request UNIQUE (request_id)
);

CREATE INDEX idx_marketplace_policies_customer_id ON marketplace_policies (customer_id);
CREATE INDEX idx_marketplace_policies_insurer_id ON marketplace_policies (insurer_id);
CREATE INDEX idx_marketplace_policies_quote_id ON marketplace_policies (quote_id);
CREATE INDEX idx_marketplace_policies_contract_id ON marketplace_policies (contract_id);
CREATE INDEX idx_marketplace_policies_status ON marketplace_policies (status);

COMMENT ON TABLE marketplace_policies IS
    'Policies bound from the competitive insurance marketplace, tied to the winning insurer + quote. Separate from per-job insurance_policies (022).';

-- ── updated_at triggers ──────────────────────────────────────────────────────
-- Reuse the existing update_insurance_updated_at() trigger function (defined in
-- migration 022) so updated_at is maintained consistently.
CREATE TRIGGER trg_insurers_updated_at
    BEFORE UPDATE ON insurers
    FOR EACH ROW EXECUTE FUNCTION update_insurance_updated_at();

CREATE TRIGGER trg_marketplace_policies_updated_at
    BEFORE UPDATE ON marketplace_policies
    FOR EACH ROW EXECUTE FUNCTION update_insurance_updated_at();

-- ── Seed approved insurers + rate cards ──────────────────────────────────────
-- Three approved carriers with VARIED base_rate_bps per product type, so the
-- fan-out produces genuinely competing quotes (lowest premium sorts first).
-- Product types mirror the fixed catalog's coverage_type values so the two
-- surfaces speak the same vocabulary.
INSERT INTO insurers (id, name, slug, status, payout_account) VALUES
    ('a0000000-0000-4000-8000-000000000001', 'Summit Mutual',     'summit-mutual',     'approved', 'acct_dev_summit'),
    ('a0000000-0000-4000-8000-000000000002', 'Cascade Assurance',  'cascade-assurance', 'approved', 'acct_dev_cascade'),
    ('a0000000-0000-4000-8000-000000000003', 'Evergreen Indemnity','evergreen-indemnity','approved', 'acct_dev_evergreen');

INSERT INTO insurer_products (insurer_id, product_type, base_rate_bps, min_premium_cents, active) VALUES
    -- Summit Mutual — aggressive on property/completion, pricier on liability.
    ('a0000000-0000-4000-8000-000000000001', 'property_damage',      140, 1000, true),
    ('a0000000-0000-4000-8000-000000000001', 'workmanship_warranty', 210, 1500, true),
    ('a0000000-0000-4000-8000-000000000001', 'completion_guarantee',  90,  500, true),
    ('a0000000-0000-4000-8000-000000000001', 'liability',            270, 2000, true),
    -- Cascade Assurance — mid-market across the board.
    ('a0000000-0000-4000-8000-000000000002', 'property_damage',      160, 1200, true),
    ('a0000000-0000-4000-8000-000000000002', 'workmanship_warranty', 190, 1400, true),
    ('a0000000-0000-4000-8000-000000000002', 'completion_guarantee', 110,  600, true),
    ('a0000000-0000-4000-8000-000000000002', 'liability',            230, 1800, true),
    -- Evergreen Indemnity — cheapest on liability, premium on property.
    ('a0000000-0000-4000-8000-000000000003', 'property_damage',      175, 1100, true),
    ('a0000000-0000-4000-8000-000000000003', 'workmanship_warranty', 200, 1300, true),
    ('a0000000-0000-4000-8000-000000000003', 'completion_guarantee', 100,  550, true),
    ('a0000000-0000-4000-8000-000000000003', 'liability',            210, 1700, true);
