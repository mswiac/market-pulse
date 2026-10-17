-- The RSI input window is bounded by `MAX(date)` over the whole table
-- (loadRecentPriceRows); without a date-leading index that is a full scan on
-- every dashboard load and cron run.
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
