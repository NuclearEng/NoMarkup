-- F1 Proof of work: durable check-in sessions + completion photos.
-- Redis work-session keys expire in 24h; release days later needs Postgres.

CREATE TABLE contract_work_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id       UUID NOT NULL REFERENCES contracts(id),
    provider_id       UUID NOT NULL REFERENCES users(id),
    checked_in_at     TIMESTAMPTZ NOT NULL,
    check_in_lat      DOUBLE PRECISION,
    check_in_lng      DOUBLE PRECISION,
    checked_out_at    TIMESTAMPTZ,
    check_out_lat     DOUBLE PRECISION,
    check_out_lng     DOUBLE PRECISION,
    duration_minutes  INT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One in-progress session per provider on a contract.
CREATE UNIQUE INDEX idx_contract_work_sessions_open
    ON contract_work_sessions (contract_id, provider_id)
    WHERE checked_out_at IS NULL;

CREATE INDEX idx_contract_work_sessions_contract_id
    ON contract_work_sessions (contract_id);

CREATE TRIGGER set_updated_at_contract_work_sessions
    BEFORE UPDATE ON contract_work_sessions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE contract_completion_photos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id  UUID NOT NULL REFERENCES contracts(id),
    uploaded_by  UUID NOT NULL REFERENCES users(id),
    phase        TEXT NOT NULL CHECK (phase IN ('before', 'after')),
    url          TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_completion_photos_contract_id
    ON contract_completion_photos (contract_id);

COMMENT ON TABLE contract_work_sessions IS
    'F1 proof of work: provider on-site check-in/out. Authority for escrow release (not Redis).';

COMMENT ON TABLE contract_completion_photos IS
    'F1 proof of work: before/after completion photos. At least one after-photo is required to release service escrow.';
