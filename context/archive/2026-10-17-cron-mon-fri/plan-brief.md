# Cron MON-FRI — Plan Brief

> Full plan: `context/changes/cron-mon-fri/plan.md`

## What & Why

The three cron triggers use `1-5`, which Cloudflare reads as Sunday–Thursday. Friday's close is therefore only fetched on Sunday and Friday alerts fire about two days late. Switch to the named range `MON-FRI`.

## Starting Point

Schedules live in `wrangler.toml` and as constants in `src/worker/scheduled.ts`; a test checks only that the two agree.

## Desired End State

The crons run Monday–Friday; Settings → Triggers reads "Monday through Friday".

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Day notation | Named `MON-FRI` | Cannot be misread as the numeric Sunday-based range |
| Regression guard | One assertion on the day-of-week field | The existing test passes with `1-5` in both places |
| Docs example | Fix `infrastructure.md:130` too | Same trap in a copy-paste snippet |

## Scope

**In scope:** `wrangler.toml`, `scheduled.ts` constants, one test assertion, one docs line.

**Out of scope:** run times, market holidays, archived plans.

## Architecture / Approach

Mechanical string change in identical form in all places.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Switch to MON-FRI | Corrected schedules + guard test | Takes effect only after deploy |

**Prerequisites:** none.
**Estimated effort:** one short session.

## Open Risks & Assumptions

- Cloudflare accepts `MON-FRI` in the cron field (as the issue proposes); confirmed by Settings → Triggers after deploy.

## Success Criteria (Summary)

- Tests, typecheck and lint pass.
- Friday crons actually run after deploy.
