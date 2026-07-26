<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Review Follow-ups Implementation Plan

- **Plan**: context/changes/review-followups/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-07-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification Log

- `npm run ci` (typecheck + test:worker + build): pass — 67/67 tests, build succeeds.
- `gh api repos/mswiac/market-pulse/branches/main/protection`: confirmed `required_status_checks.checks` includes `{"context":"Workers Builds: marketpulse","app_id":85455}`, `enforce_admins.enabled: false`.
- `npm run migrate:local` / `npm run migrate:remote`: migration 0009 applied cleanly on both, additive-only (verified via before/after COUNT(*) + spot-check on production during implementation: alerts=3, market_data=2, all rows unchanged).
- Drift sub-agent: all 6 planned changes MATCH; branch diff (`main...HEAD`) contains only the 6 planned files plus expected `context/changes/review-followups/*` planning artifacts — no scope creep.
- Safety/pattern sub-agent: empirically verified (not just from docs) that D1 upserts fire both BEFORE INSERT and BEFORE UPDATE triggers on the conflict path, confirming the migration's trigger coverage is correct (redundant-safe, not gapped) for scheduled.ts's `INSERT ... ON CONFLICT DO UPDATE` write. No SQL injection surface (all parameterized). Migration is additive-only, cannot fail on existing data (SQLite triggers don't validate pre-existing rows). Test isolation confirmed correct (`@cloudflare/vitest-pool-workers` gives each test file its own D1 instance). Existing per-ticker try/catch + Workers Logs observability in `scheduled.ts` remain intact and would still surface a future trigger firing in production.

## Findings

### F1 — Trigger test doesn't exercise the real upsert shape

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/worker/rsi-eligibility-triggers.test.ts:57-71
- **Detail**: The market_data tests use a plain INSERT and a plain UPDATE, not the `INSERT ... ON CONFLICT (ticker) DO UPDATE` shape scheduled.ts actually uses in production. Verified empirically (sub-agent independently confirmed via SQLite) that both BEFORE INSERT and BEFORE UPDATE fire on an upsert's conflict path, so this is provably equivalent — not a real gap in enforcement, just a gap in what the test literally exercises.
- **Fix**: Add one case running the actual upsert (mirroring how scheduled.test.ts calls handleScheduled()) with a non-eligible ticker + non-null rsi, closing the gap between "provably equivalent" and "directly demonstrated."
- **Decision**: FIXED

### F2 — Success Criteria wording still says the deprecated `contexts` field

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Phase 1 Success Criteria bullet / Progress 1.2
- **Detail**: During plan-review triage, the Contract for Phase 1 item 2 was corrected to use the modern `checks` array instead of the deprecated `contexts` array (confirmed live: what's actually configured on GitHub is `checks: [{context, app_id}]`). The Success Criteria bullet text and Progress row 1.2's description were never updated to match — they still read "required_status_checks.contexts." Phase blocks are read-only during /10x-implement, so this couldn't be fixed mid-implementation. Purely cosmetic — what was actually verified and configured is correct.
- **Fix**: Update the wording in the Phase 1 Success Criteria bullet and Progress row 1.2 description to say "checks" instead of "contexts."
- **Decision**: FIXED

## Non-finding (out of scope, noted for awareness)

Sub-agent flagged, in passing, a pre-existing doc staleness unrelated to this change's diff: `context/changes/deployment/deployment-plan.md:320` still says "fetch Stooq data" though the project switched to Yahoo Finance for both tickers previously. Not part of Phase 2's scope (only the two specific items from the review were in scope) — mentioned for awareness only, not filed as a finding.
