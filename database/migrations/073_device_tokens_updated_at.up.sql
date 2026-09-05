-- 073_device_tokens_updated_at.up.sql
--
-- Adds updated_at + the standard touch-trigger to device_tokens.
--
-- Why this exists: commit e64f614 edited the already-shared migration 003
-- in place to add exactly these objects — a violation of "never edit a
-- deployed migration" (CLAUDE.md §5). 003 has been restored to its
-- as-introduced content (commit 4a0063e) and the edit now ships here as a
-- proper forward migration. See docs/operations/migration-notes.md.
--
-- Written IDEMPOTENTLY because existing dev databases already have both
-- objects (they ran the edited 003): on those DBs this migration is a
-- no-op; on fresh DBs it creates them.
--
-- The trigger function trigger_set_updated_at() is defined by
-- 001_initial_schema.up.sql and shared by many tables — it is guaranteed
-- to exist on any chain that reaches 073 and is intentionally NOT
-- created or replaced here.
--
-- Column + trigger land together (single logical unit — the same unit
-- e64f614 introduced); the trigger is useless without the column.

ALTER TABLE device_tokens
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_device_tokens_updated_at ON device_tokens;
CREATE TRIGGER set_device_tokens_updated_at
    BEFORE UPDATE ON device_tokens
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
