# Abuse-Lens Test Gaps — Plan Brief

> Full plan: `context/changes/abuse-lens-closure/plan.md`

## What & Why

Close the last two narrow test gaps from test-plan.md's Phase 4 "Abuse-lens closure": risk #6 (an admin session must not get special access on non-admin routes, and two admins must not confer immunity on each other) and risk #7 (the 730-day backfill cap has only ever been tested for rejection above the boundary, never exercised near it). Phase 4's other item — a local post-edit hook — already shipped in PR #90, so this is pure test-coverage work.

## Starting Point

`alerts.ts`/`trigger-events.ts` already scope every query by `user_id` and never check admin status — this is correct today, just unproven by a test. `admin.ts` already rejects backfill ranges over 730 days, but nothing has ever run a range near that boundary to see the actual batch size. `vitest.config.mts` currently configures exactly one admin email, so a two-admin scenario isn't testable yet.

## Desired End State

Three new automated tests exist: an admin session correctly gets 404 on another user's alert via the regular alert routes; a second admin account can be acted on by the first admin exactly like a regular user (correct scoping, no immunity, no data mixing); and a near-730-day backfill produces the expected batch size with its timing visible in test output. No production code changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Two-admin scenario shape | Admin A acts on Admin B's resources via admin routes | Matches test-plan.md's literal "cross-user" framing more directly than a self-exclusion-only check | Plan |
| Second admin config | Widen `ADMIN_EMAILS` to a comma-list in `vitest.config.mts` | One-line change; `isAdminEmail()` already supports comma-separated lists | Plan |
| Admin-vs-non-admin route scope | `alerts.ts` PUT/DELETE only | Highest-risk (mutating) surface named in the test-plan's Risk Response Guidance; `trigger-events.ts` is read-only and lower risk | Plan |
| Risk #7 benchmark assertion | Observational (batch size + success), no hard time threshold | `vitest-pool-workers` timing doesn't reflect Cloudflare's real (I/O-bound, not CPU-bound) budget — a fixed threshold would be flaky and unrelated | Plan |
| Test file placement | Extend `alerts.test.ts` / `admin.test.ts` | Matches this repo's one-module-one-test-file convention (CLAUDE.md §6.1) | Plan |

## Scope

**In scope:**
- One `vitest.config.mts` config-value change (second admin email)
- One new test in `alerts.test.ts` (admin session vs. non-admin route)
- Two new tests in `admin.test.ts` (two-admin scenario, near-730-day batch-size observation)

**Out of scope:**
- Any production code change in `src/worker/**`
- `trigger-events.ts` route coverage
- A hard latency/CPU threshold assertion
- The local post-edit hook (already shipped in PR #90)

## Architecture / Approach

No architecture change — this is additive test coverage reusing existing helpers (`registerAndLogIn`, `logInAsAdmin`, `yahooBody`, `vi.stubGlobal('fetch', ...)`, `vi.spyOn(env.DB, 'batch')`, `insertAlert`/`insertTriggerEvent`/`getUserId`) already established in both test files.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Abuse-lens test coverage | 3 new tests + 1 config change, closing risks #6 and #7's remaining gaps | Generating realistic weekday-timestamp test data for the ~729-day range without hand-listing ~520 entries |

**Prerequisites:** None — all patterns and helpers already exist in the two target test files.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- Assumes D1's per-batch statement limits comfortably accommodate ~520 statements (the original admin-panel plan already reasoned this is "within D1 limits," and this phase's test will directly confirm the batch actually contains that many statements without erroring).

## Success Criteria (Summary)

- `npm run test:worker` and `npm run ci` pass with the three new tests included.
- An admin session can no longer be mistaken for having elevated access on `/api/alerts/:id`.
- A near-730-day backfill's real batch size is now visible and asserted, closing the "never exercised near the boundary" gap.
