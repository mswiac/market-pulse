-- Adds a user-controlled pause flag to alerts. It is deliberately separate
-- from `armed`, which is the automatic re-arm state the cron flips after a
-- trigger: a paused alert is skipped by the cron entirely, so it neither
-- fires nor re-arms until the user resumes it. Plain ADD COLUMN with a
-- constant default — no shadow-table rebuild needed (see
-- migrations/0015_instruments_suffix.sql); existing alerts start unpaused.
ALTER TABLE alerts ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
