-- Rebuilds `alerts` (SQLite can't ALTER a UNIQUE constraint in place) to add
-- `direction` and `armed`, extending the uniqueness key to include direction
-- so a ticker/type/threshold can have both an "up" and a "down" alert.
-- `direction DEFAULT 'up'` matters beyond the backfill below: raw-SQL test
-- inserts (test/worker/rsi-eligibility-triggers.test.ts) write to `alerts`
-- without a `direction` column on purpose, to exercise the RSI-eligibility
-- triggers directly — without a default those inserts would fail on an
-- unrelated NOT NULL violation. The application layer always supplies an
-- explicit, validated direction, so the default is never exercised through
-- the API.
CREATE TABLE alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  notification_email TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up', 'down')),
  armed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, ticker, alert_type, threshold, direction)
);

-- Backfill: existing rows have no recorded "value at creation," so direction
-- is approximated from the current market_data value vs. threshold (missing
-- market_data also defaults to 'up', same convention as the column default
-- above). `armed` starts at 1 for every pre-existing row — their historical
-- trigger state is unknown, so they start fresh.
INSERT INTO alerts_new (id, user_id, ticker, alert_type, threshold, notification_email, direction, armed, created_at, updated_at)
  SELECT
    alerts.id,
    alerts.user_id,
    alerts.ticker,
    alerts.alert_type,
    alerts.threshold,
    alerts.notification_email,
    CASE
      WHEN (CASE alerts.alert_type WHEN 'RSI' THEN market_data.rsi ELSE market_data.price END) < alerts.threshold
        OR (CASE alerts.alert_type WHEN 'RSI' THEN market_data.rsi ELSE market_data.price END) IS NULL
      THEN 'up' ELSE 'down'
    END,
    1,
    alerts.created_at,
    alerts.updated_at
  FROM alerts
  LEFT JOIN market_data ON market_data.ticker = alerts.ticker;

DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX idx_alerts_user_id ON alerts(user_id);

-- DROP TABLE above also drops any triggers bound to the old `alerts` table
-- (migrations/0009_rsi_eligibility_triggers.sql) — recreated verbatim here,
-- or RSI-eligibility enforcement silently disappears.
CREATE TRIGGER trg_alerts_rsi_eligibility_insert
BEFORE INSERT ON alerts
WHEN NEW.alert_type = 'RSI'
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TRIGGER trg_alerts_rsi_eligibility_update
BEFORE UPDATE ON alerts
WHEN NEW.alert_type = 'RSI'
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TABLE trigger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
  ticker TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  threshold REAL NOT NULL,
  value_at_trigger REAL NOT NULL,
  notification_email TEXT NOT NULL,
  email_status TEXT NOT NULL CHECK (email_status IN ('sent', 'failed')),
  email_error TEXT,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_trigger_events_user_id ON trigger_events(user_id);
