-- Adds an admin-settable suffix appended to `ticker` only when building the
-- Yahoo query symbol (e.g. ticker `CDR` + suffix `.WA` -> `CDR.WA`). The
-- bare `ticker` stays the value stored/displayed everywhere else. Plain
-- ADD COLUMN with a constant default — no shadow-table rebuild needed (that
-- technique is only required for CHECK/DROP COLUMN changes, per
-- migrations/0014_instrument_registry_extended_types.sql). Existing ^VIX/^NDX
-- rows get suffix = '', which is correct: their ticker is already the exact
-- Yahoo symbol.
ALTER TABLE instruments ADD COLUMN suffix TEXT NOT NULL DEFAULT '';
