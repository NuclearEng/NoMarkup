-- Reverse migration 042.

DROP INDEX IF EXISTS idx_push_subscriptions_user;
DROP TABLE IF EXISTS push_subscriptions;
