-- Reverse migration 046.

DROP INDEX IF EXISTS idx_jobs_same_day_requested;

ALTER TABLE contracts DROP COLUMN IF EXISTS tip_amount_cents;

ALTER TABLE jobs DROP COLUMN IF EXISTS same_day_requested;
ALTER TABLE jobs DROP COLUMN IF EXISTS hourly_rate_cents;
ALTER TABLE jobs DROP COLUMN IF EXISTS is_hourly;

DROP TABLE IF EXISTS quote_templates;
DROP TABLE IF EXISTS job_question_answers;
DROP TABLE IF EXISTS category_questions;
