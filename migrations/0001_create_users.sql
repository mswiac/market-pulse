CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
