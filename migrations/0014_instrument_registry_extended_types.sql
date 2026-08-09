-- Widens the `instruments.type` CHECK constraint to allow `pl_stock` and
-- `us_stock` alongside the existing `index` type (admin-add-instrument).
-- D1/SQLite can't ALTER a CHECK constraint in place — same shadow-table
-- technique as migrations/0011_alert_notifications.sql.
--
-- None of the RSI-eligibility triggers (0009_rsi_eligibility_triggers.sql)
-- are defined ON `instruments` — they're ON `alerts`/`market_data`, only
-- referencing `instruments` in a subquery. That's still enough to break
-- `ALTER TABLE instruments_new RENAME TO instruments`: SQLite revalidates
-- every trigger body in the schema during a table rename, and at that point
-- `instruments` doesn't exist yet under its final name, so all four
-- RSI-eligibility triggers fail to resolve `FROM instruments` and the whole
-- statement errors ("no such table: main.instruments"). Verified locally —
-- dropping the triggers first and recreating them after the rename avoids
-- this entirely; the recreated bodies are byte-for-byte identical to 0009's.
DROP TRIGGER trg_alerts_rsi_eligibility_insert;
DROP TRIGGER trg_alerts_rsi_eligibility_update;
DROP TRIGGER trg_market_data_rsi_eligibility_insert;
DROP TRIGGER trg_market_data_rsi_eligibility_update;

CREATE TABLE instruments_new (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('index', 'pl_stock', 'us_stock')),
  rsi_eligible INTEGER NOT NULL,
  provider TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD'
);

INSERT INTO instruments_new SELECT * FROM instruments;

DROP TABLE instruments;
ALTER TABLE instruments_new RENAME TO instruments;

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

CREATE TRIGGER trg_market_data_rsi_eligibility_insert
BEFORE INSERT ON market_data
WHEN NEW.rsi IS NOT NULL
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TRIGGER trg_market_data_rsi_eligibility_update
BEFORE UPDATE ON market_data
WHEN NEW.rsi IS NOT NULL
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;
