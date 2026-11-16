-- IOS-SYS.NT.1: per-user notification send ledger backing push cooldowns.
--
-- One row per successful push-channel dispatch (written by the notification
-- service after fan-out reports >= 1 delivery). The service consults it
-- BEFORE dispatching:
--   * promotional types (price_drop, seller_new_listing, welcome_day_*,
--     reengagement_*, nps/nps_survey, promotional, marketing):
--     max 1 push / user / 24h per type AND max 3 promotional pushes /
--     user / 24h total
--   * transactional types (auction/contract/message/payment/...):
--     max 20 pushes / user / hour (generous, anti-storm only)
-- Blocked pushes are skipped; the in-app notification row still delivers.
--
-- Rows older than 7 days are pruned opportunistically per user on insert
-- (services/notification/internal/repository/postgres.go RecordSend), so the
-- table stays bounded without a dedicated sweeper.
--
-- This table replaces the `notifications.delivery_log` that
-- services/notification/cmd/server/reengagement.go previously cited but which
-- never existed anywhere in the tree.
--
-- The composite index serves every ledger query (all filter on user_id, most
-- on notification_type, all on a sent_at window) and covers the user_id FK.

CREATE TABLE notification_send_ledger (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type  TEXT NOT NULL,
    channel            TEXT NOT NULL,
    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_send_ledger_user_type_sent
    ON notification_send_ledger (user_id, notification_type, sent_at);

COMMENT ON TABLE notification_send_ledger IS
    'Per-user send ledger for notification push cooldowns (IOS-SYS.NT.1). Append-only; sent_at is the creation timestamp; rows pruned after 7 days.';
