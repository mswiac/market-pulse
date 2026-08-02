<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin Panel Implementation Plan

- **Plan**: context/changes/admin-panel/plan.md
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE → SOUND (all findings fixed during triage)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 10/10 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Empty-range result treated as hard error, not a valid outcome

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (`fetchDailyCloses`) / Phase 2 (admin route error mapping)
- **Detail**: `market-data.ts:89-91` throws `MarketDataFetchError` whenever the parsed result has zero valid closes. Today's only caller (the cron, fixed ~30-day window) never legitimately hits this. The admin panel changes that: an admin can pick a short weekend-only range, a *valid* zero-trading-day outcome, not a fetch failure. Phase 2 maps every `MarketDataFetchError` to a blanket `502`, so this legitimate case surfaces as a misleading "fetch failed" instead of a clean `daysWritten: 0`.
- **Fix A ⭐ Recommended**: Let `fetchDailyCloses` return `[]` for a structurally-valid response with zero trading days, instead of throwing
  - Strength: Correctly distinguishes "no data for this range" (valid) from "response malformed/failed" (real error).
  - Tradeoff: Touches an invariant the cron relies on — `scheduled.ts:42`'s `latest = closes[closes.length - 1]` needs an explicit empty-array guard.
  - Confidence: HIGH — architecturally correct; guard is unreachable in practice for cron's window but needed for safety.
  - Blind spot: None significant.
- **Fix B**: Keep the throw; admin route pattern-matches the error message and treats it as `daysWritten: 0`
  - Strength: Zero changes to `fetchDailyCloses`'s existing contract/tests.
  - Tradeoff: String-matching an error message across a module boundary is fragile.
  - Confidence: MEDIUM — works today, brittle under refactor.
  - Blind spot: Doesn't fix the semantic confusion at the source.
- **Decision**: FIXED (via Fix A)

### F2 — Admin check should be a middleware, not an inline route check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Admin route
- **Detail**: The plan frames the admin check as mirroring `lookupTicker` — but that's data validation, not authorization. A repo-wide check found no chained middleware anywhere; this route would be the first two-tier auth check. Doing it inline also breaks from `sessionMiddleware`'s own established idiom (a reusable `MiddlewareHandler`).
- **Fix A ⭐ Recommended**: Extract `adminMiddleware` in `src/worker/lib/admin.ts` (alongside `isAdminEmail`), chained as `.use('*', sessionMiddleware, adminMiddleware)`
  - Strength: Matches the codebase's auth-as-middleware idiom; reusable extension point for future admin actions the plan itself anticipates.
  - Tradeoff: Slightly more boilerplate than inline for the single route today.
  - Confidence: HIGH — mirrors `sessionMiddleware`'s own shape.
  - Blind spot: None significant.
- **Fix B**: Keep the inline check, correct the misleading "mirrors lookupTicker" description
  - Strength: Avoids a new abstraction for one call site.
  - Tradeoff: Idiom-inconsistent; undercuts the plan's own "more admin actions later" framing.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED (via Fix A)

### F3 — Riskiest assumption (Yahoo period1/period2) has no manual check until Phase 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria
- **Detail**: No code in this repo has ever exercised `period1`/`period2`. Phase 1's Manual Verification is explicitly "None," so the plan's riskiest claim goes unverified until Phase 2 has already built the full admin route on top of it.
- **Fix**: Add a Manual Verification item to Phase 1 — hit the real Yahoo endpoint directly with `period1`/`period2` for a known symbol and confirm the response shape, before starting Phase 2.
- **Decision**: FIXED

### F4 — Existing market-data.test.ts has 9 call sites needing mechanical updates

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Testing Strategy
- **Detail**: `test/worker/market-data.test.ts` calls `fetchDailyCloses(...)` with a single argument at 9 call sites. None assert on the URL string, so no test logic breaks, but all 9 will fail to typecheck once `from`/`to` become required.
- **Fix**: Add a one-line note to Phase 1's Changes Required calling out that all 9 existing call sites need a `from`/`to` argument added.
- **Decision**: FIXED
