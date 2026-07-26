-- Currency is hand-seeded per instrument, same as name/type/rsi_eligible — not
-- fetched from Yahoo and not written by the daily cron. DEFAULT 'USD' backfills
-- the two existing rows (^VIX, ^NDX, both USD-denominated) in this same
-- statement. Any future instrument's INSERT must supply its own currency
-- value explicitly, the same way name/type are supplied today.
ALTER TABLE instruments ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
