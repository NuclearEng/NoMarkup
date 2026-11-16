-- Goods orders need a chat channel. chat_channels.job_id was NOT NULL with a
-- table UNIQUE (job_id, customer_id, provider_id). Listing pickup chat has no
-- job, so job_id becomes nullable, listing_id is the other context, and exactly
-- one of the two is set. Partial unique indexes replace the table UNIQUE
-- because PostgreSQL treats NULLs as distinct. channel_type stays inside the
-- existing check (goods pickup uses 'contract'; the chat proto has no order
-- value).

ALTER TABLE chat_channels
  DROP CONSTRAINT IF EXISTS chat_channels_job_id_customer_id_provider_id_key;

ALTER TABLE chat_channels
  ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE chat_channels
  ADD COLUMN listing_id UUID NULL REFERENCES listings(id);

ALTER TABLE chat_channels
  ADD CONSTRAINT chat_channels_context_chk CHECK (
    (job_id IS NOT NULL AND listing_id IS NULL)
    OR (job_id IS NULL AND listing_id IS NOT NULL)
  );

CREATE UNIQUE INDEX idx_chat_channels_job_parties
  ON chat_channels (job_id, customer_id, provider_id)
  WHERE job_id IS NOT NULL;

CREATE UNIQUE INDEX idx_chat_channels_listing_parties
  ON chat_channels (listing_id, customer_id, provider_id)
  WHERE listing_id IS NOT NULL;

CREATE INDEX idx_chat_channels_listing
  ON chat_channels (listing_id)
  WHERE listing_id IS NOT NULL;
