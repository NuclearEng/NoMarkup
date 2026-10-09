-- 071 down: drop email_unsubscribe_tokens.
DROP INDEX IF EXISTS idx_email_unsubscribe_tokens_user_id;
DROP TABLE IF EXISTS email_unsubscribe_tokens;
