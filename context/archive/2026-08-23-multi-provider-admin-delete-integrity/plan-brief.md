# Multi-provider ticker integrity + remote D1 cascade check — Plan Brief

> Full plan: `context/changes/multi-provider-admin-delete-integrity/plan.md`
> Research: `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md`

## What & Why

Closes `test-plan.md` §3 Phase 2 (GitHub issue #92): risk #3 (multi-provider ticker/suffix integrity) and risk #5 (cascading deletes verified only on local D1, never remote). Neither risk is an active bug — research already confirmed the code is correct — but both have a narrow, real coverage gap worth closing before calling them done.

## Starting Point

Ticker/suffix separation and DB-key discipline already work correctly in both the cron (`scheduled.ts`) and admin backfill (`admin.ts`) paths, and each has its own existing test proving the suffixed case doesn't leak into the DB key — but never alongside a bare ticker in the same assertion. Local D1's `ON DELETE CASCADE`/`SET NULL` constraints were empirically verified during the S-12 (admin-remove-user) plan; remote D1 was explicitly assumed, never checked.

## Desired End State

Two new tests (one per fetch path) prove bare and suffixed tickers both resolve to the correct DB key side-by-side. A one-time, read-only `PRAGMA foreign_keys` check against production D1 confirms (or disproves) that foreign-key enforcement is live remotely, with the result recorded on disk.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Where the side-by-side test lives | Both `scheduled.test.ts` and `admin.test.ts` | The cron and admin backfill paths write to the DB independently, so each needs its own proof | Plan |
| Remote-D1 verification depth | Read-only `PRAGMA foreign_keys` only, no synthetic insert/delete | Avoids any write against production data; matches the user's standing caution about touching real DB rows | Plan |
| Evidence location | Dedicated `remote-d1-verification.md` in the change folder | Keeps a discoverable, permanent trail of what was checked and when | Plan |
| Scope of "done" | Both the test and the remote check are required to close this phase | Matches how issue #92 and `test-plan.md` Phase 2 are scoped | Plan |

## Scope

**In scope:**
- One new test in `test/worker/scheduled.test.ts` asserting bare + suffixed ticker side-by-side
- One new test in `test/worker/admin.test.ts` asserting the same for the admin backfill path
- One-time read-only remote D1 `PRAGMA foreign_keys` check, with recorded evidence

**Out of scope:**
- Any code change to `market-data.ts`, `scheduled.ts`, or `admin.ts` (no bug exists — this is pure test coverage)
- A live INSERT+DELETE cascade drill against production data
- Updating `test-plan.md`'s Phase 2 status (handled separately by `/10x-test-plan`)
- Automating the remote-D1 check as a recurring CI step

## Architecture / Approach

No architectural change. Phase 1 adds test coverage using patterns already established in both test files (`insertSuffixInstrument()`, mocked `fetch` matched by URL). Phase 2 is a manual, one-time operational check outside the test suite, with its result committed as a markdown artifact for future audit trail.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Multi-provider ticker integrity tests | Two new tests proving bare+suffixed tickers both key correctly, side-by-side | Low — pure test addition, no production code touched |
| 2. Remote D1 foreign-key check | Recorded proof that `PRAGMA foreign_keys` is enforced on production D1 | The command needs live network access outside this session's sandbox, and touches production infrastructure (read-only) |

**Prerequisites:** `wrangler` authenticated against the production Cloudflare account for Phase 2; no prerequisites for Phase 1.
**Estimated effort:** ~1 session — small, additive test changes plus one manual command.

## Open Risks & Assumptions

- If the remote `PRAGMA foreign_keys` check returns `0` instead of `1`, that's a real, previously-unknown production risk (contradicting the local-D1 finding) and must be escalated, not silently noted and moved past.
- The remote command requires the sandbox's network restriction to be lifted (or the user to run it directly) since Cloudflare's API host isn't in this session's Bash allowlist.

## Success Criteria (Summary)

- `npm run test:worker` passes, including both new side-by-side tests.
- `remote-d1-verification.md` exists in the change folder with the command, output, and date recorded.
- Any unexpected `PRAGMA foreign_keys` result on remote has been surfaced to the user, not silently absorbed.
