# Review Follow-ups — Plan Brief

> Full plan: `context/changes/review-followups/plan.md`

## What & Why

Three follow-ups from a one-time whole-repo review (issue #42): worker-side regressions (type errors, failing tests) can currently merge to `main` unnoticed because nothing gates on them; `deployment-plan.md` documents a `ctx.waitUntil()` requirement the shipped code doesn't follow; and the RSI-eligibility DB constraint dropped in migration 0008 has no replacement, so a future direct-SQL bug could write an RSI value for a non-eligible instrument with nothing to stop it.

## Starting Point

`Workers Builds: marketpulse` (Cloudflare's native CI/CD app) already runs on every PR/push and shows as a GitHub check, but its dashboard-configured build command likely only builds the Angular frontend — `npm run typecheck` and `npm run test:worker` exist and pass but run only when someone remembers to run them manually. `main` has zero branch protection today. `alerts`/`market_data` have real production rows and no DB-level RSI-eligibility check since 0008.

## Desired End State

Every PR/push automatically runs typecheck + worker tests + build via the existing Cloudflare pipeline, and a red run blocks merge. The deployment doc matches the shipped code. The database itself rejects any RSI value for a non-RSI-eligible ticker — automatically, for any current or future instrument — without needing another migration each time.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| CI approach | Extend existing Cloudflare Workers Builds, no GitHub Actions | Matches this project's prior explicit "GitHub Actions excluded" decision; avoids two parallel CI systems | Plan |
| CI gating | Required GitHub status check on `main` | An informational-only check doesn't fix the gap the review found — merging on red must become impossible | Plan |
| Build command packaging | New `npm run ci` script in `package.json` | Keeps the gate logic versioned/reviewable in the repo instead of living only in a dashboard text field | Plan |
| RSI-eligibility enforcement mechanism | SQLite triggers querying `instruments.rsi_eligible`, not a hardcoded CHECK | Verified live against local D1 that triggers can reference another table; generalizes to future instruments automatically, unlike a hardcoded `ticker = '^VIX'` CHECK | Plan |
| Migration shape for triggers | Additive-only (no shadow-table rebuild) | Triggers don't require rewriting existing rows — safer on live production data than a full table rebuild | Plan |
| Remote migration safety | Before/after `COUNT(*)` + spot-check | Matches how today's cron-data fix was already verified; sufficient given the migration touches zero existing rows | Plan |
| Trigger test coverage | New test doing a raw `env.DB` INSERT bypassing app validation | Only way to actually prove the DB itself blocks bad data, not just the application layer | Plan |

## Scope

**In scope:**
- `npm run ci` script + required status check on `main`
- `deployment-plan.md` waitUntil correction + `scheduled.ts` retry-delay comment
- Migration `0009` adding 4 triggers (alerts × 2, market_data × 2) + a new test proving they fire

**Out of scope:**
- Any GitHub Actions workflow
- Broader `deployment-plan.md` audit beyond the two flagged items
- `trigger_events` uniqueness constraint (table doesn't exist yet — belongs to S-05)
- Rebuilding `alerts`/`market_data` tables

## Architecture / Approach

Phase 1 and 2 are pure config/doc changes with no runtime code path affected. Phase 3 adds enforcement at the database layer, generalized via a subquery against the existing `instruments` registry rather than encoding ticker knowledge into the schema — the same registry-driven pattern the app layer (`validateAlertInput`) already uses, just mirrored at the DB layer for defense-in-depth.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. CI gate via Workers Builds | Typecheck+tests block merge on `main` | Requires a manual dashboard step (pasting the build command) that can't be automated from this environment |
| 2. Deployment-plan doc fix | Doc matches shipped code | None — pure doc/comment change |
| 3. RSI-eligibility triggers | DB rejects bad RSI writes automatically, for any instrument | Touches production tables (additive-only, no rewrite, but still a first-ever trigger migration on this project) |

**Prerequisites:** None — all three phases are independent of each other and of any other in-flight change.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The exact current Cloudflare Workers Builds build command isn't visible from this environment (dashboard-only config) — Phase 1's manual step assumes you'll paste `npm run ci` in as the full replacement, not append it to something already there. Worth a quick look at the current value before overwriting it.
- `enforce_admins: false` is used for the branch protection setting, so the repo owner can still override a red check in an emergency — flag if you'd rather it be strict.

## Success Criteria (Summary)

- A deliberately broken worker test cannot be merged to `main` without an explicit admin override
- `deployment-plan.md` no longer contradicts the shipped `scheduled` export
- A raw SQL attempt to set an RSI value on a non-eligible ticker fails on production, proven by an automated test
