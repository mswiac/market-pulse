CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO sessions_new SELECT id, user_id, expires_at, created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
