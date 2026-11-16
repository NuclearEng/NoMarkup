-- Migration 097 — cover the unindexed FK events.session_id.
--
-- events references user_sessions(session_id) with no index. Session rows are short-lived and pruned, and every prune scans the events table — which is the highest-volume append-only table after analytics_transactions.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_session_fk ON events (session_id);
