-- F2 Time-to-first-bid: durable record of which providers were selected
-- for a job match notify. Written after match selection (even if the
-- push/email fails-soft). Owner GET job reads notified_count from here.
-- PRIMARY KEY (job_id, provider_id) makes the insert idempotent.

CREATE TABLE job_match_notifications (
    job_id      UUID NOT NULL REFERENCES jobs(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, provider_id)
);

CREATE INDEX idx_job_match_notifications_job_id
    ON job_match_notifications (job_id);

COMMENT ON TABLE job_match_notifications IS
    'Providers selected for a job match notify (F2 liquidity). One row per (job, provider).';
