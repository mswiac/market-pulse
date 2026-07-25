CREATE TABLE instruments (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('index')),
  rsi_eligible INTEGER NOT NULL,
  provider TEXT NOT NULL
);

INSERT INTO instruments (ticker, name, type, rsi_eligible, provider) VALUES
  ('^VIX', 'VIX', 'index', 0, 'yahoo'),
  ('^NDX', 'NASDAQ-100', 'index', 1, 'yahoo');

ALTER TABLE price_history RENAME COLUMN instrument TO ticker;
UPDATE price_history SET ticker = '^VIX' WHERE ticker = 'VIX';
UPDATE price_history SET ticker = '^NDX' WHERE ticker = 'NASDAQ100';

CREATE TABLE market_data_new (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  rsi REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO market_data_new (ticker, price, rsi, updated_at)
  SELECT CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END,
         price, rsi, updated_at
  FROM market_data;
DROP TABLE market_data;
ALTER TABLE market_data_new RENAME TO market_data;

CREATE TABLE alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, ticker, alert_type, threshold)
);
INSERT INTO alerts_new (id, user_id, ticker, alert_type, threshold, notification_email, created_at, updated_at)
  SELECT id, user_id,
         CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END,
         alert_type, threshold, notification_email, created_at, updated_at
  FROM alerts;
DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
