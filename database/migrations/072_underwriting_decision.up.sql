-- 072: Persist the Rust underwriting engine's decision on provider_credit_limits.
--
-- The underwriting engine (nomarkup.underwriting.v1) is a pure function over
-- un-forgeable, escrow-settled features. Its decision (approve/deny, tier,
-- available amount, pricing, and an audit hash) is stored alongside the existing
-- computed features so the latest decision is auditable and re-displayable
-- without re-running the engine. All new columns are nullable / sensibly
-- defaulted so this is additive and pre-existing rows stay valid.
--
-- Conventions: money is BIGINT cents; bps/pct are INTEGER; the factor rate is
-- NUMERIC(6,4); explainability/audit identifiers are TEXT.
ALTER TABLE provider_credit_limits
    ADD COLUMN approved                BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN tier                    TEXT,
    ADD COLUMN available_advance_cents BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN fee_bps                 INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN factor_rate             NUMERIC(6,4),
    ADD COLUMN holdback_pct            INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN binding_cap             TEXT,
    ADD COLUMN decision_hash           TEXT,
    ADD COLUMN model_version           TEXT;
