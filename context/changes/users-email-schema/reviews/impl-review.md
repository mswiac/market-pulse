<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Users Email Schema

- **Plan**: `context/changes/users-email-schema/plan.md`
- **Scope**: All phases (1–3)
- **Date**: 2026-06-28
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical | 1 warning | 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — S-01 detail block still lists F-01 as prerequisite

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/roadmap.md:112`
- **Detail**: "At a glance" table and Streams table were correctly updated to F-01a but S-01 detail block still read `- **Prerequisites:** F-01`. Anyone running `/10x-plan auth-and-registration` would see the wrong prerequisite and might conclude S-01 can start before F-01a. Auth code must target the finalised email-only schema.
- **Fix**: Changed `- **Prerequisites:** F-01` → `- **Prerequisites:** F-01a` in the S-01 detail section.
- **Decision**: FIXED — 37988ee

### F2 — Stale "DROP COLUMN" note in F-01a Backlog Handoff

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/roadmap.md:185`
- **Detail**: F-01a Backlog Handoff note read "verify D1 ALTER TABLE / DROP COLUMN support." Migration used shadow-table pattern, not DROP COLUMN. Note was misleading history.
- **Fix**: Updated note to "Shadow-table migration applied (0002_users_email_schema.sql); schema confirmed on local + remote D1."
- **Decision**: FIXED — 37988ee

### F3 — Missing IF NOT EXISTS on users_new CREATE TABLE

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `migrations/0002_users_email_schema.sql:1`
- **Detail**: `0001` uses `CREATE TABLE IF NOT EXISTS users`; `0002` uses `CREATE TABLE users_new` (no guard). Contextually correct for a shadow table (you want it to fail if already exists — signals a partially applied migration), but a style divergence.
- **Fix**: No action required — behaviour is correct. Accept or add a one-line comment explaining the intentional omission.
- **Decision**: SKIPPED
