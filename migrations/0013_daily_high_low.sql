-- Nullable: existing rows and any day Yahoo omits high/low keep NULL here.
-- price_history/market_data self-backfill over subsequent cron runs; nothing
-- older than the fetch window is ever populated (see plan.md Migration Notes).
ALTER TABLE market_data ADD COLUMN high REAL;
ALTER TABLE market_data ADD COLUMN low REAL;
ALTER TABLE price_history ADD COLUMN high REAL;
ALTER TABLE price_history ADD COLUMN low REAL;

-- Recorded alongside the existing value_at_trigger (close/RSI) so a fired
-- PRICE alert's email/history can show High/Low/Close together.
ALTER TABLE trigger_events ADD COLUMN high_at_trigger REAL;
ALTER TABLE trigger_events ADD COLUMN low_at_trigger REAL;
