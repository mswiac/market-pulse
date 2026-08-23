# Multi-provider ticker integrity + remote D1 cascade check — Implementation Plan

## Overview

Closes `context/foundation/test-plan.md` §3 Phase 2, covering risks #3 and #5 from the 2026-08-22 test-plan refresh (tracked as GitHub issue #92). Adds one test per fetch path (cron, admin backfill) that asserts a bare ticker and a `.WA`-suffixed ticker both key `price_history`/`market_data` on the bare `ticker` in the *same* assertion, and performs a one-time, read-only remote-D1 check that `PRAGMA foreign_keys` is enforced in production.

## Current State Analysis

Both risks are narrower than they first sound — `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md` already confirmed neither is an active bug:

- **Risk #3**: `scheduled.ts:48-50` and `admin.ts:72-74` both keep the Yahoo query symbol (`ticker + suffix`) separate from the bare `ticker` used for every DB write. `upsertPriceHistory` (`market-data.ts:149-158`) always binds the bare `ticker`. `test/worker/scheduled.test.ts:215-241` and `test/worker/admin.test.ts:287-304` each already assert this negatively (no row exists under the suffixed key) — but only for the suffixed ticker in isolation. Neither file has a test that checks a bare ticker (`^VIX`/`^NDX`, always present via migrations + `vitest.config.mts`'s `TEST_MIGRATIONS`) and a suffixed ticker (`TEST`/`TEST.WA`, `TESTBACKFILL`/`TESTBACKFILL.WA`) side-by-side in one test.
- **Risk #5**: `sessions`, `alerts`, `trigger_events` all carry real `REFERENCES users(id) ON DELETE CASCADE`/`ON DELETE SET NULL` constraints (`migrations/0004`, `0008:32`, `0011:13,75`). `context/archive/2026-08-14-admin-remove-user/plan.md:9,27,47` documents that `PRAGMA foreign_keys` was empirically confirmed to be `1` on **local** D1 during that change's planning, and that remote D1 was explicitly *assumed* — never separately checked — to behave the same way. `wrangler.toml` names the production database `marketpulse-db` (`database_id: 7476d353-d0d1-4687-be8e-12cdbd01494b`).

## Desired End State

- `test/worker/scheduled.test.ts` and `test/worker/admin.test.ts` each have one new test that fetches/backfills a bare ticker and a suffixed ticker together and asserts, in a single test, that both wrote rows keyed on their bare ticker and neither wrote a row keyed on the suffixed symbol.
- A one-time `PRAGMA foreign_keys` check has been run against the production D1 database via `wrangler d1 execute marketpulse-db --remote`, and its exact command + output is recorded in `context/changes/multi-provider-admin-delete-integrity/remote-d1-verification.md`.

Verify by: `npm run test:worker` passes including the two new tests; `remote-d1-verification.md` exists and shows a `1` result (or documents an escalation if it doesn't).

### Key Discoveries:

- `^VIX`/`^NDX` are not per-test fixtures — they're seeded once via `TEST_MIGRATIONS` (`vitest.config.mts:8,14`) and persist across the whole file, which is exactly why `scheduled.test.ts`'s `beforeEach` only clears `market_data`/`price_history`, not `instruments`.
- The admin backfill endpoint (`admin.ts:37-100`) takes one `ticker` per request — "side-by-side in one test" for that path means two sequential `POST` calls inside a single `it` block, not two tickers in one request body.
- `insertSuffixInstrument()` already exists in both test files (`scheduled.test.ts:59-65`, `admin.test.ts:51-57`) and is reused as-is — no new fixture helper needed.

## What We're NOT Doing

- Not performing a live INSERT+DELETE cascade test against production data — per the decision made during planning, the remote-D1 check is read-only (`PRAGMA foreign_keys` only), not a synthetic-record delete drill. If the PRAGMA result contradicts the local `1` finding, that's escalated as a new finding, not silently worked around.
- Not adding rate limiting, schema changes, or any change to `resend.ts`/`alert-evaluation.ts` — those belong to other risks/phases.
- Not updating `context/foundation/test-plan.md`'s Phase 2 status row — that's the `/10x-test-plan` orchestrator's job, done separately from this plan.
- Not automating the remote-D1 check as a recurring CI step — matches the project's existing "no D1 migration SQL correctness automation" convention (test-plan.md §7).

## Implementation Approach

Two independent, unordered pieces of work — the test-file changes and the remote-D1 check don't depend on each other and can be done in either order. Structured as two phases only because they have distinct verification methods (automated tests vs. a manual command), not because of a sequencing requirement.

## Critical Implementation Details

**Remote-D1 command needs real network access.** `wrangler d1 execute --remote` calls Cloudflare's API, which is not in this session's sandboxed Bash network allowlist. Run this command with the sandbox disabled (it's read-only — no destructive risk) or ask the user to run it directly via `! wrangler d1 execute marketpulse-db --remote --command "PRAGMA foreign_keys"`.

## Phase 1: Multi-provider ticker integrity — side-by-side test coverage

### Overview

One new test per fetch path, each asserting a bare and a suffixed ticker together in a single test.

### Changes Required:

#### 1. Cron path test

**File**: `test/worker/scheduled.test.ts`

**Intent**: New test in `describe('scheduled handler', ...)` that inserts the suffix instrument alongside the always-present bare instruments, runs the scheduled handler once, and asserts — within that one test — that `price_history`/`market_data` hold rows keyed on both `'^NDX'` (bare) and `'TEST'` (bare part of a suffixed ticker), and that no row exists keyed on `'TEST.WA'`.

**Contract**: New `it(...)` block placed after the existing `'fetches a suffix-bearing instrument...'` test. Reuses `insertSuffixInstrument()` and the standard `yahooBody`/`jsonResponse` stub pattern already in the file — no new helpers.

#### 2. Admin backfill path test

**File**: `test/worker/admin.test.ts`

**Intent**: New test in `describe('POST /api/admin/market-data', ...)` that issues two sequential backfill calls in one test — one for a bare ticker (`^VIX`), one for the suffix-bearing `TESTBACKFILL` — and asserts, side-by-side, that both wrote `price_history` rows keyed on their bare ticker and neither wrote one keyed on `'TESTBACKFILL.WA'`.

**Contract**: New `it(...)` block placed after the existing `'fetches a suffix-bearing instrument...'` test. Reuses `insertSuffixInstrument()`; `fetch` stub matches on URL (mirroring the existing currency-correction test's `if (url.includes(...))` pattern, `admin.test.ts:310-313`) to return distinct bodies per ticker.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including both new tests
- `npm run typecheck` passes

#### Manual Verification:

- None — both fetch paths are already fully exercised through mocked Yahoo responses in the existing test suite; no live behavior to eyeball beyond what the automated assertions cover

---

## Phase 2: Remote D1 foreign-key enforcement check

### Overview

One-time, read-only verification that `PRAGMA foreign_keys` is enabled on the production D1 database, closing the scoped-down part of risk #5 the team decided to verify now.

### Changes Required:

#### 1. Evidence file

**File**: `context/changes/multi-provider-admin-delete-integrity/remote-d1-verification.md` (new)

**Intent**: Records the exact command run against production D1, its raw output, the date, and a one-line interpretation (foreign keys enforced / not enforced).

**Contract**: Markdown file containing: the command `wrangler d1 execute marketpulse-db --remote --command "PRAGMA foreign_keys"`, the verbatim output, the date the check was run, and — only if the result is `0` instead of the expected `1` — an explicit "ESCALATE" note flagging that remote D1 does not enforce foreign keys, contradicting the local-D1 finding from `context/archive/2026-08-14-admin-remove-user/plan.md`.

### Success Criteria:

#### Automated Verification:

- None — this phase has no automated check by design (a one-time manual command, not a recurring test)

#### Manual Verification:

- `wrangler d1 execute marketpulse-db --remote --command "PRAGMA foreign_keys"` run successfully against production D1 and its output recorded in `remote-d1-verification.md`
- If the result is `0` (not `1`), the finding is escalated rather than silently accepted — flagged to the user before this phase is considered done

---

## Testing Strategy

### Unit Tests:

- Phase 1's two new tests are the entirety of the automated coverage this plan adds — no other test files touched.

### Integration Tests:

- None beyond the existing Workers-runtime-emulation tests already in place (`@cloudflare/vitest-pool-workers`).

### Manual Testing Steps:

1. Run `npm run test:worker` and confirm both new tests pass alongside the full existing suite (no regressions).
2. Run the `PRAGMA foreign_keys` command against production D1 and record the result per Phase 2.

## Performance Considerations

None — both new tests reuse existing mocked-fetch patterns at the same scale as neighboring tests; the remote check is a single lightweight `PRAGMA` read.

## Migration Notes

None — no schema changes.

## References

- Test-plan phase definition: `context/foundation/test-plan.md` §2 (Risk Response Guidance rows #3, #5), §3 (Phase 2 row)
- Prior grounding research: `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md`
- Local D1 FK-cascade precedent: `context/archive/2026-08-14-admin-remove-user/plan.md:9,27,47`
- Existing suffix-ticker test pattern: `test/worker/scheduled.test.ts:215-241`, `test/worker/admin.test.ts:287-304`
- GitHub issue: #92 (split off from the #79 umbrella issue)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Multi-provider ticker integrity — side-by-side test coverage

#### Automated

- [x] 1.1 `npm run test:worker` passes, including both new tests — 0bc0445
- [x] 1.2 `npm run typecheck` passes — 0bc0445

### Phase 2: Remote D1 foreign-key enforcement check

#### Manual

- [x] 2.1 `PRAGMA foreign_keys` run against production D1, output recorded in `remote-d1-verification.md`
- [x] 2.2 A `0` result (if it occurs) escalated to the user rather than silently accepted
