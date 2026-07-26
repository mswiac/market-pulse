# Review Follow-ups Implementation Plan

## Overview

Three independent fixes surfaced by a one-time whole-repo review (GitHub issue #42): close the CI gap (worker typecheck/tests aren't checked before merge), correct a stale claim in `deployment-plan.md`, and restore the DB-level RSI-eligibility enforcement that migration `0008_instrument_registry.sql` dropped.

## Current State Analysis

- **CI**: `npm run typecheck` and `npm run test:worker` (vitest + `@cloudflare/vitest-pool-workers`, migrations applied in-memory via `vitest.config.mts`) exist and pass, but nothing runs them automatically. The only GitHub check on PRs/pushes is `Workers Builds: marketpulse` (Cloudflare's native Workers CI/CD app), which builds and deploys — its dashboard-configured build command is not visible from the repo and, per the project's own `deployment-plan.md` history, was never set up to run anything beyond the equivalent of `npm run build`. `main` currently has no branch protection at all (`gh api repos/mswiac/market-pulse/branches/main/protection` → 404).
- **`deployment-plan.md`**: lines 337-354 document the Worker's `scheduled` export as needing `ctx.waitUntil()`, calling it "required." The shipped code (`src/worker/index.ts:29`) does not call it — `scheduled: (_controller, env, _ctx) => handleScheduled(env)` returns the promise directly, which the Workers runtime awaits regardless of `waitUntil()`. Not a bug, but a stale doc claim that could cause an unnecessary "fix" later.
- **`src/worker/scheduled.ts:7`**: `RETRY_DELAY_MS = 300` is a fixed delay with no backoff across the 3 Yahoo Finance retry attempts. Fine at current volume (2 tickers/day) but reads like an oversight without a comment.
- **RSI-eligibility enforcement**: `migrations/0005_create_alerts.sql:11` and `0007_create_market_data.sql:6` had `CHECK (NOT (instrument = 'VIX' AND alert_type = 'RSI'))` / `CHECK (NOT (instrument = 'VIX' AND rsi IS NOT NULL))`. `0008_instrument_registry.sql` rebuilt both tables (ticker rename, new `instruments` registry with a data-driven `rsi_eligible` column) and dropped these CHECKs — enforcement today lives only in `src/worker/routes/alerts.ts`'s `validateAlertInput`. SQLite CHECK constraints cannot reference another table, so a CHECK re-creation would have to hardcode `ticker = '^VIX'` again — brittle against future instruments. Verified directly against local D1 (`wrangler d1 execute --local`) that SQLite/D1 triggers CAN reference another table in a subquery and `RAISE(FAIL, ...)` correctly aborts the statement with `SQLITE_CONSTRAINT_TRIGGER` — this is the mechanism this plan uses instead.

## Desired End State

- Every PR and push to `main` automatically runs `npm run typecheck`, `npm run test:worker`, and `npm run build` via the existing Cloudflare Workers Builds pipeline (no new CI system introduced), and a failing run blocks the merge button on GitHub.
- `deployment-plan.md` and `scheduled.ts` no longer contain the two stale/misleading statements identified in the review.
- The database itself rejects any `INSERT`/`UPDATE` on `alerts` or `market_data` that would set an RSI value for a ticker whose `instruments.rsi_eligible` is `0` — enforced dynamically from the `instruments` table, so adding a future non-RSI-eligible instrument requires no new migration.

### Key Discoveries:

- `Workers Builds: marketpulse` check context name (from `gh api repos/mswiac/market-pulse/commits/<sha>/check-runs`): `"Workers Builds: marketpulse"` — this exact string is what `required_status_checks.contexts` must reference.
- D1/SQLite triggers support cross-table subqueries in their `WHEN` clause (verified live against local D1 in this planning session) — this is what makes the enforcement in Phase 3 generalize automatically instead of hardcoding a ticker.
- `INSERT ... ON CONFLICT (ticker) DO UPDATE` (used by `scheduled.ts` for `market_data`) executes the do-update branch as an actual `UPDATE` under SQLite's upsert semantics — so `market_data` needs both a `BEFORE INSERT` and a `BEFORE UPDATE` trigger to cover the cron's upsert path, not just `BEFORE INSERT`.

## What We're NOT Doing

- Not introducing GitHub Actions or any CI system beyond the existing Cloudflare Workers Builds pipeline (explicit user decision, consistent with the project's prior "GitHub Actions excluded per user preference" note in `deployment-plan.md:376`).
- Not doing a broader audit of `deployment-plan.md` beyond the two specific stale items identified in the review (the `ctx.waitUntil()` claim and the retry-delay comment).
- Not adding a `trigger_events`-related uniqueness constraint — that table doesn't exist yet (belongs to S-05, not this cleanup batch).
- Not rebuilding the `alerts`/`market_data` tables (shadow-table pattern) — triggers can be added without touching existing rows, so production data stays untouched in Phase 3.

## Implementation Approach

Each phase is independent and separately shippable. Phase 1 closes the CI gap using the existing Cloudflare pipeline plus GitHub branch protection (no new tooling). Phase 2 is a pure documentation/comment fix. Phase 3 adds a migration that only creates triggers (no data rewrite), plus a test that proves the trigger fires by inserting directly against `env.DB`, bypassing the application validation layer entirely.

## Critical Implementation Details

**Upsert trigger coverage**: `market_data`'s cron writes use `INSERT ... ON CONFLICT (ticker) DO UPDATE SET rsi = excluded.rsi, ...`. Verified empirically against local D1: for this upsert form, BOTH the `BEFORE INSERT` and `BEFORE UPDATE` triggers fire on the same statement, in that order, regardless of whether the row already existed. Both trigger types are still required on `market_data` — not because of upsert semantics, but because `alerts.ts` writes via two genuinely separate statements (a plain `INSERT` on POST, a plain `UPDATE` on PUT), each of which only fires its own trigger type.

## Phase 1: CI gate via Workers Builds

### Overview

Close the gap where worker-side type errors or test failures can merge to `main` unnoticed, by extending the existing Cloudflare Workers Builds pipeline (no new CI system) and making it a required GitHub status check.

### Changes Required:

#### 1. Bundle the gate into one script

**File**: `package.json`

**Intent**: Give the Cloudflare dashboard's "Build command" field one script to reference instead of a raw multi-command string, so the gate logic is versioned and reviewable in the repo rather than living only in a web UI field.

**Contract**: Add a `"ci"` script: `"ci": "npm run typecheck && npm run test:worker && npm run build"`.

#### 2. Require the existing check on `main`

**Target**: GitHub repo settings (`gh api`), not a repo file.

**Intent**: Make the `Workers Builds: marketpulse` check block merging when it fails — today it's purely informational (`main` has no branch protection at all).

**Contract**: `PUT /repos/mswiac/market-pulse/branches/main/protection` with `required_status_checks: { strict: false, checks: [{ "context": "Workers Builds: marketpulse", "app_id": 85455 }] }` (the modern `checks` shape, not the deprecated `contexts` array — `85455` is the "Cloudflare Workers and Pages" app id, confirmed via `gh api repos/mswiac/market-pulse/commits/<sha>/check-runs`), `enforce_admins: false` (repo owner retains an override for a solo-maintainer project), `required_pull_request_reviews: null`, `restrictions: null`.

### Success Criteria:

#### Automated Verification:

- `npm run ci` (the new script) runs typecheck, worker tests, and build in sequence and exits 0 locally
- `gh api repos/mswiac/market-pulse/branches/main/protection` returns the configured `required_status_checks.contexts` including `"Workers Builds: marketpulse"` (no longer a 404)

#### Manual Verification:

- Paste `npm run ci` into the Cloudflare dashboard (Worker → Settings → Build → Build command) and save
- Push a small change and confirm the Cloudflare build log shows typecheck + vitest output before the Angular build step, not just the Angular build

## Phase 2: Deployment-plan doc fix

### Overview

Correct the two stale/misleading statements the review flagged — no functional code changes.

### Changes Required:

#### 1. Remove the stale `ctx.waitUntil()` claim

**File**: `context/changes/deployment/deployment-plan.md`

**Intent**: The documented code sample and the "required" claim (lines 337-354) don't match the shipped `scheduled` export in `src/worker/index.ts:29`, which correctly relies on the runtime awaiting the returned promise. Update the sample and prose to match reality so a future reader doesn't "fix" working code based on stale guidance.

**Contract**: Replace the `ctx.waitUntil(runDailyJob(env))` sample and the "`ctx.waitUntil()` is required" sentence with the actual pattern used (`scheduled: (_controller, env, _ctx) => handleScheduled(env)`) and a short note that the runtime awaits a returned promise from `scheduled()` without needing `waitUntil()`.

#### 2. Document the intentional fixed retry delay

**File**: `src/worker/scheduled.ts`

**Intent**: `RETRY_DELAY_MS = 300` with no backoff reads as an oversight; a one-line comment records that it's a deliberate simplification at current volume (2 tickers/day).

**Contract**: Add a one-line comment above the `RETRY_DELAY_MS` constant.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run test:worker` passes (no behavior change expected)

#### Manual Verification:

- Diff review: confirm `deployment-plan.md`'s sample now matches `src/worker/index.ts`

## Phase 3: Restore RSI-eligibility enforcement via triggers

### Overview

Add DB-level defense-in-depth against a non-RSI-eligible ticker ever getting an RSI alert or RSI value, enforced dynamically from `instruments.rsi_eligible` rather than a hardcoded ticker string — so it automatically covers any future instrument without a further migration.

### Changes Required:

#### 1. New migration adding four triggers

**File**: `migrations/0009_rsi_eligibility_triggers.sql`

**Intent**: Recreate the protection `0008_instrument_registry.sql` dropped, generalized via the `instruments` registry instead of hardcoding `'^VIX'`.

**Contract**: Four triggers, each `WHEN`-guarded by a subquery against `instruments.rsi_eligible` and raising `RAISE(FAIL, ...)` on violation:
- `BEFORE INSERT ON alerts` / `BEFORE UPDATE ON alerts`: block when `NEW.alert_type = 'RSI'` and the matching `instruments.rsi_eligible = 0`.
- `BEFORE INSERT ON market_data` / `BEFORE UPDATE ON market_data`: block when `NEW.rsi IS NOT NULL` and the matching `instruments.rsi_eligible = 0`.

No table rebuild — existing rows in `alerts`/`market_data` are untouched.

#### 2. Prove the trigger actually fires

**File**: `test/worker/rsi-eligibility-triggers.test.ts` (new)

**Intent**: A CHECK/trigger that's never exercised by a test is unverified defense-in-depth. Insert directly via `env.DB.prepare(...)`, bypassing `validateAlertInput` entirely, and assert the raw SQL call throws.

**Contract**: Following the `import { env } from 'cloudflare:workers'` pattern used in `test/worker/scheduled.test.ts`, at minimum: (a) direct `INSERT INTO alerts (..., ticker: '^VIX', alert_type: 'RSI', ...)` throws; (b) direct `INSERT INTO market_data (ticker: '^VIX', rsi: <non-null>, ...)` throws; (c) the equivalent valid inserts (e.g. `^NDX` with RSI) still succeed, proving the trigger doesn't over-block. `alerts.user_id` is `NOT NULL REFERENCES users(id)` and D1 enforces `PRAGMA foreign_keys = 1`, so case (a) and (c) for the `alerts` table need a real seeded user first — reuse the `registerAndLogIn` helper pattern from `test/worker/alerts.test.ts` (or a direct `users` insert) to get a valid `user_id` before inserting.

### Success Criteria:

#### Automated Verification:

- `npm run migrate:local` applies `0009` cleanly
- `npm run test:worker` passes, including the new trigger test
- `npm run typecheck` passes

#### Manual Verification:

- Before applying to remote: run `SELECT COUNT(*) FROM alerts` and `SELECT COUNT(*) FROM market_data` against production D1 and note the counts, plus a spot-check of a couple of rows
- Apply `npm run migrate:remote`
- Re-run the same `COUNT(*)` queries and spot-check against remote — confirm counts and sampled rows are unchanged
- Confirm the app still works end-to-end on production (create/edit an alert, view alert details with current price/RSI)

## Testing Strategy

### Unit Tests:

- New `test/worker/rsi-eligibility-triggers.test.ts` covering both tables, both trigger-blocked and trigger-allowed cases (see Phase 3 above)

### Integration Tests:

- Existing `test/worker/alerts.test.ts` and `test/worker/market-data.test.ts` continue to pass unmodified — the triggers must not interfere with any currently-valid write path (VIX price alerts, NASDAQ-100 price/RSI alerts, cron writes)

### Manual Testing Steps:

1. After Phase 1: push a trivial commit and confirm the Cloudflare build log runs typecheck + vitest before the Angular build
2. After Phase 1: open a PR with a deliberately broken worker test locally (not pushed) to confirm you understand what a red check looks like — or simply confirm the branch protection setting via the GitHub PR UI ("Required" badge on the check)
3. After Phase 3: on production, attempt to create a VIX+RSI alert through the UI — confirm it's still blocked by the existing app-level validation (unchanged, still the first line of defense) and that the DB itself (per the automated migration test) would also reject it if the app check were ever bypassed

## Migration Notes

`0009_rsi_eligibility_triggers.sql` is additive-only (triggers, no `ALTER`/`DROP` on existing tables or data) — this is safe to apply to remote D1 with existing rows since no row is rewritten. Rollback, if ever needed, is a follow-up migration dropping the four triggers (`DROP TRIGGER ...`) — no data implications either direction.

## References

- GitHub issue: #42 (whole-repo review findings)
- Dropped constraints: `migrations/0005_create_alerts.sql:11`, `migrations/0007_create_market_data.sql:6`
- Migration that dropped them: `migrations/0008_instrument_registry.sql`
- Stale doc: `context/changes/deployment/deployment-plan.md:337-354`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI gate via Workers Builds

#### Automated

- [x] 1.1 npm run ci script runs typecheck, worker tests, and build in sequence and exits 0 locally — 2048459
- [x] 1.2 gh api branch protection shows required_status_checks.contexts including "Workers Builds: marketpulse" — 2048459

#### Manual

- [x] 1.3 npm run ci pasted into Cloudflare dashboard Build command and saved — 56a5d43
- [x] 1.4 Push confirms Cloudflare build log runs typecheck + vitest before the Angular build — 56a5d43

### Phase 2: Deployment-plan doc fix

#### Automated

- [x] 2.1 npm run typecheck passes — 56a5d43
- [x] 2.2 npm run test:worker passes — 56a5d43

#### Manual

- [x] 2.3 Diff review confirms deployment-plan.md sample matches src/worker/index.ts — 56a5d43

### Phase 3: Restore RSI-eligibility enforcement via triggers

#### Automated

- [x] 3.1 npm run migrate:local applies 0009 cleanly
- [x] 3.2 npm run test:worker passes including the new trigger test
- [x] 3.3 npm run typecheck passes

#### Manual

- [x] 3.4 Pre-migration COUNT(*) and spot-check recorded against production D1 (alerts=3: id3 ^NDX/PRICE/113, id4 ^VIX/PRICE/24, id5 ^NDX/RSI/30; market_data=2: ^NDX price=28454.81/rsi=42.23, ^VIX price=18.70/rsi=null)
- [x] 3.5 npm run migrate:remote applied
- [x] 3.6 Post-migration COUNT(*) and spot-check confirmed unchanged against production D1 (alerts=3, market_data=2, all rows byte-identical to pre-migration spot-check)
- [ ] 3.7 App confirmed working end-to-end on production after migration
