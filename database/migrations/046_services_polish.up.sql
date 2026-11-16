-- Services-side polish (Wave 5 audit Section H).
--
-- Adds Thumbtack-style infrastructure to the SERVICES surface that the
-- audit flagged as MISSING:
--
--   • category_questions      — admin-curated pre-quote questions tied
--                                to a service_categories row (e.g.
--                                "How big is the area?" for plumbing).
--                                Customers answer these on the post-job
--                                form so providers quote off real scope.
--   • job_question_answers    — customer answers, one row per question
--                                per job. Visible to bidding providers
--                                via GET /api/v1/jobs/{id}/answers.
--   • quote_templates         — provider's reusable boilerplate ("$150
--                                drain unclog, 30 min, parts included")
--                                surfaced in the quote composer.
--
-- Plus four column additions:
--
--   • jobs.is_hourly             — flat-rate vs. hourly billing toggle.
--   • jobs.hourly_rate_cents     — hourly rate when is_hourly=true.
--   • jobs.same_day_requested    — Thumbtack's "I need this today" SLA
--                                   flag. Downstream matcher prioritizes
--                                   providers with same_day_available=true.
--   • contracts.tip_amount_cents — post-completion gratuity. The Stripe
--                                   charge is a separate transaction
--                                   billed to the customer's saved card;
--                                   payout flows through existing Connect
--                                   transfer. v1 inserts the row only —
--                                   live charge wiring is in PLAN §6.5.
--
-- Seeds a starter set of pre-quote questions for the top categories so
-- the demo has something to render on the post-job form.

CREATE TABLE category_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id   UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    question      TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'number', 'select', 'multiselect', 'boolean', 'date')),
    options       JSONB,                          -- for select/multiselect
    required      BOOLEAN NOT NULL DEFAULT false,
    display_order INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_category_questions_category ON category_questions (category_id, display_order);

CREATE TABLE job_question_answers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES category_questions(id) ON DELETE CASCADE,
    answer_text TEXT,
    answer_json JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, question_id)
);
CREATE INDEX idx_job_question_answers_job ON job_question_answers (job_id);

CREATE TABLE quote_templates (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    body                   TEXT NOT NULL,
    default_amount_cents   BIGINT,
    default_duration_hours INT,
    use_count              INT NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quote_templates_user ON quote_templates (user_id, created_at DESC);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_hourly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hourly_rate_cents BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS same_day_requested BOOLEAN NOT NULL DEFAULT false;

-- Optional partial index — same-day jobs are always queried with the flag,
-- so we keep a tiny index on the truthy subset to speed downstream matching.
CREATE INDEX idx_jobs_same_day_requested ON jobs (created_at DESC) WHERE same_day_requested = true;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS tip_amount_cents BIGINT NOT NULL DEFAULT 0;

-- Seed a starter set of pre-quote questions for two top-of-funnel categories
-- so the demo has something to render. Real production data will be admin-CRUDed
-- via POST /api/v1/admin/category-questions. Wrapped in a DO block so it no-ops
-- cleanly on schemas where the seeded categories don't exist (test sandboxes).
DO $$
DECLARE
    plumbing_id UUID;
    cleaning_id UUID;
BEGIN
    SELECT id INTO plumbing_id FROM service_categories WHERE slug = 'plumbing' LIMIT 1;
    SELECT id INTO cleaning_id FROM service_categories WHERE slug = 'cleaning' LIMIT 1;

    IF plumbing_id IS NOT NULL THEN
        INSERT INTO category_questions (category_id, question, question_type, options, required, display_order) VALUES
            (plumbing_id, 'How big is the affected area?', 'select',
             '["Single fixture","Whole bathroom","Whole kitchen","Multiple rooms","Whole house"]'::jsonb,
             true, 0),
            (plumbing_id, 'When did the issue start?', 'select',
             '["Today","This week","More than a week ago","Recurring problem"]'::jsonb,
             true, 1),
            (plumbing_id, 'Is the property currently occupied?', 'boolean', NULL, false, 2);
    END IF;

    IF cleaning_id IS NOT NULL THEN
        INSERT INTO category_questions (category_id, question, question_type, options, required, display_order) VALUES
            (cleaning_id, 'Approximate square footage?', 'number', NULL, true, 0),
            (cleaning_id, 'How often do you need cleaning?', 'select',
             '["One-time","Weekly","Bi-weekly","Monthly"]'::jsonb,
             true, 1),
            (cleaning_id, 'How many bedrooms?', 'number', NULL, false, 2),
            (cleaning_id, 'How many bathrooms?', 'number', NULL, false, 3);
    END IF;
END $$;
