-- Supports the trigger-history endpoint's `WHERE user_id = ? ORDER BY
-- triggered_at DESC` query with a covering composite index. The old
-- single-column index is dropped as redundant: its only column is the
-- composite index's leftmost column, so any query that filtered on
-- `user_id` alone is already served by the new index.
DROP INDEX IF EXISTS idx_trigger_events_user_id;
CREATE INDEX idx_trigger_events_user_triggered_at ON trigger_events(user_id, triggered_at DESC);
