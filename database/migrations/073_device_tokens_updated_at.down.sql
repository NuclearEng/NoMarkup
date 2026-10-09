-- 073_device_tokens_updated_at.down.sql
--
-- Reverse of 073: drop the touch-trigger and the updated_at column.
-- trigger_set_updated_at() is owned by 001 and shared by many other
-- tables' triggers, so it is NOT dropped here.

DROP TRIGGER IF EXISTS set_device_tokens_updated_at ON device_tokens;

ALTER TABLE device_tokens
    DROP COLUMN IF EXISTS updated_at;
