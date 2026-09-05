-- F8 Field RUM: anonymous Core Web Vitals samples from the browser.
-- No user id, cookies, IP, or other PII columns — path is query-stripped
-- at the gateway (max 200 chars). Index serves admin p75 over a time window.

CREATE TABLE rum_samples (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL CHECK (name IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
    value_ms   DOUBLE PRECISION NOT NULL CHECK (value_ms >= 0 AND value_ms < 1e7),
    rating     TEXT NOT NULL CHECK (rating IN ('good', 'needs-improvement', 'poor')),
    path       TEXT NOT NULL CHECK (char_length(path) <= 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rum_samples_name_created_at
    ON rum_samples (name, created_at);

COMMENT ON TABLE rum_samples IS
    'F8 field RUM. Anonymous CWV samples (LCP/INP/CLS/FCP/TTFB). No PII.';
