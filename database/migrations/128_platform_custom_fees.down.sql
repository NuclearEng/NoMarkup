DROP TRIGGER IF EXISTS set_platform_custom_fees_updated_at ON platform_custom_fees;
DROP INDEX IF EXISTS idx_platform_custom_fees_list;
DROP INDEX IF EXISTS idx_platform_custom_fees_active;
DROP TABLE IF EXISTS platform_custom_fees;
