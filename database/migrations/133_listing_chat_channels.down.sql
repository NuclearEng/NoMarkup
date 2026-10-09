DELETE FROM chat_channels WHERE listing_id IS NOT NULL;

DROP INDEX IF EXISTS idx_chat_channels_listing;
DROP INDEX IF EXISTS idx_chat_channels_listing_parties;
DROP INDEX IF EXISTS idx_chat_channels_job_parties;

ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_context_chk;
ALTER TABLE chat_channels DROP COLUMN IF EXISTS listing_id;

ALTER TABLE chat_channels
  ALTER COLUMN job_id SET NOT NULL;

ALTER TABLE chat_channels
  ADD CONSTRAINT chat_channels_job_id_customer_id_provider_id_key
  UNIQUE (job_id, customer_id, provider_id);
