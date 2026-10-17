<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fetch and Validate Market Data When an Instrument Is Added

- **Plan**: context/changes/instrument-add-fetch-validate/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run on HEAD (501528d): worker tests 413 passed, Angular tests 199 passed, typecheck clean, lint clean, e2e 48 passed. Only 3.9 (production add after deploy) remains unchecked, by design.

## Findings

### F1 — messages.xlf not regenerated

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/locale/messages.xlf
- **Detail**: Plan Phase 3 step 2 says to run extract-i18n and fill Polish targets. Only messages.pl.xlf was edited; regenerating messages.xlf adds ~900 unrelated lines because the file is already stale in the repo.
- **Fix**: Leave as is (deliberate, disclosed deviation).
- **Decision**: FIXED — messages.xlf regenerated with extract-i18n (all new ids present)

### F2 — No direct unit tests for rsiFromCloses and resolveCurrency

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/worker/lib/price-history.ts, src/worker/lib/market-data.ts
- **Detail**: Both helpers are covered only indirectly (admin parity test, malformed-currency test, existing scheduled tests). The plan allows this path.
- **Fix**: Optional small unit tests next to the existing price-history and market-data tests.
- **Decision**: FIXED — direct unit tests added for rsiFromCloses and resolveCurrency

### F3 — createInstrument inlines the ticker into SQL

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/admin-api.ts:24-35
- **Detail**: Safe today (ticker comes from uniqueTicker(), A-Z0-9; execFileSync uses no shell), but the function accepts any string.
- **Fix**: Assert `/^[A-Z0-9]+$/` on the ticker before building the SQL.
- **Decision**: OBSOLETE — the SQL seed helper was removed: seeding the local D1 from a second process raced the Worker (SQLITE_BUSY), so the remove-instrument spec now mocks its calls in the browser

### F4 — Known symbol with no sessions reports "no data for this symbol"

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/instrument-seed.ts:59
- **Detail**: An empty series (for example a suspended listing) maps to symbol_not_found. Safe (nothing written) and consistent with the product decision that no quotes means bad data.
- **Fix**: Leave as is.
- **Decision**: SKIPPED — left as is (matches the product decision that no quotes means bad data)

## Dismissed during verification

- A reviewer warned that junk symbols (spaces, `^^`) might get HTTP 400 from Yahoo and be reported as a provider outage. Probed live on 2026-10-17: Yahoo answers 404 `Not Found` for `A B`, `^^` and `ZZZZNOPE9`, so they map to 422 correctly.

## Not verified

- CPU time of the add request (10 ms Workers Free budget) is unmeasured; check Observability after deploy.
