CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, instrument, alert_type, threshold),
  CHECK (NOT (instrument = 'VIX' AND alert_type = 'RSI'))
);
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
