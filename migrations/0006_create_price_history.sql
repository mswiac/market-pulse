CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (instrument, date)
);
CREATE INDEX idx_price_history_instrument_date ON price_history(instrument, date);
