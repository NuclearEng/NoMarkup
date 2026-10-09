-- NoMarkup: Rollback initial schema
-- Drops all tables in reverse dependency order

-- NOTE: schema_migrations is deliberately NOT dropped here. That table belongs
-- to golang-migrate, not to this schema. Dropping it mid-rollback destroys the
-- version bookkeeping the tool is holding open, so `migrate down` to zero
-- failed on its own trailing write ("relation schema_migrations does not
-- exist") after this file had already succeeded — leaving a torn-down database
-- the tool then refused to operate on. A migration must never touch it.

DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
DROP TABLE IF EXISTS platform_config CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS analytics_transactions CASCADE;
DROP TABLE IF EXISTS market_ranges CASCADE;
DROP TABLE IF EXISTS platform_fee_config CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_tiers CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS fraud_signals CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_channels CASCADE;
DROP TABLE IF EXISTS trust_score_history CASCADE;
DROP TABLE IF EXISTS trust_scores CASCADE;
DROP TABLE IF EXISTS review_responses CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS recurring_instances CASCADE;
DROP TABLE IF EXISTS recurring_configs CASCADE;
DROP TABLE IF EXISTS change_orders CASCADE;
DROP TABLE IF EXISTS milestones CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS bids CASCADE;
DROP TABLE IF EXISTS job_tags CASCADE;
DROP TABLE IF EXISTS job_photos CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS verification_documents CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS provider_service_categories CASCADE;
DROP TABLE IF EXISTS service_categories CASCADE;
DROP TABLE IF EXISTS provider_portfolio_images CASCADE;
DROP TABLE IF EXISTS provider_profiles CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS oauth_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP FUNCTION IF EXISTS trigger_set_updated_at CASCADE;

-- The up creates `CREATE SEQUENCE contract_number_seq` (no IF NOT EXISTS) but
-- the down never dropped it, so a down-to-zero followed by an up died on
-- `relation "contract_number_seq" already exists` and stamped (1, dirty=true)
-- — the same wedge this file's other fix removes, one migration later.
DROP SEQUENCE IF EXISTS contract_number_seq CASCADE;

DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS postgis;
DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS "uuid-ossp";
