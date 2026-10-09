-- Reverse migration 045.

DROP INDEX IF EXISTS idx_message_templates_user;
DROP TABLE IF EXISTS message_templates;

DROP INDEX IF EXISTS idx_user_blocks_blocked;
DROP INDEX IF EXISTS idx_user_blocks_blocker;
DROP TABLE IF EXISTS user_blocks;

DROP INDEX IF EXISTS idx_chat_aliases_context;
DROP INDEX IF EXISTS idx_chat_aliases_email_alias;
DROP TABLE IF EXISTS chat_aliases;
