# E2E for the Force data refresh admin page — Plan Brief

> Full plan: `context/changes/e2e-admin-cron-run/plan.md`

## What & Why

Cover the admin "Force data refresh" page in the browser (issue #184): the confirm dialog, the results tables, and how failures from #172 surface in the UI. Today this page has no E2E coverage, so a regression in how errors are rendered would go unnoticed.

## Starting Point

The page already exists and sends three `POST /api/admin/cron/run` requests (fetch `pl`, fetch `other`, evaluate). Admin E2E infrastructure (`chromium-admin`, admin session) shipped in #183.

## Desired End State

`e2e/admin/cron-run.spec.ts` with four green tests, each red when its behavior breaks: clean run, 207 with a failed ticker, 207 with `errors`, and cancel sends no request.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Backend | Mock `/api/admin/cron/run` via `page.route` | No Yahoo/real data dependency; server logic is covered by worker tests | Plan |
| File layout | One spec file, 4 tests | Shared body-aware mock helper; deviates from skill default, accepted | Plan |
| Complexity | LOW | One spec, no app changes | Plan |

## Scope

**In scope:** the four issue scenarios, the generation prompt file.
**Out of scope:** failure-notice email, real cron runs, any app/worker/config change, 401/403 scenarios.

## Architecture / Approach

Route handler installed before navigation branches on request body (`phase`, `market`) so each of the three calls can return a different payload. The cancel test uses the same route as a request counter and also guards against a real run.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Cron-run admin page E2E | Prompt + spec with 4 verified tests | Asserting on instrument display names that depend on catalogue data |

**Prerequisites:** #183 merged (done).
**Estimated effort:** one `/10x-e2e` session.

## Open Risks & Assumptions

- Instrument names in result rows depend on the loaded catalogue; assertions target error text and status labels instead.

## Success Criteria (Summary)

- Four tests pass locally and in CI, and each fails when its behavior is broken.
