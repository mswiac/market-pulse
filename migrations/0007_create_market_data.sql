CREATE TABLE market_data (
  instrument TEXT PRIMARY KEY,
  price REAL NOT NULL,
  rsi REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (NOT (instrument = 'VIX' AND rsi IS NOT NULL))
);
