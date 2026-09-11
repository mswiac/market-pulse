# Admin Endpoint and Panel UI to Manually Trigger the Daily Cron Pipeline — Plan Brief

> Full plan: `context/changes/admin-cron-trigger/plan.md`

## What & Why

Add `POST /api/admin/cron/run` plus a new admin-panel page (`/admin/cron-run`) that is the *required* way to trigger it — a confirm dialog, a trigger button, and a results panel. Closes GitHub issue #150 (updated 2026-09-11): the issue now explicitly states a backend-only endpoint does not satisfy it — "it is not meant to be a curl-only/hidden action."

## Starting Point

`handleScheduled`/`evaluateAlerts` (backend) already implement the full pipeline but return `Promise<void>` — no structured summary exists yet. The admin panel is **not** a single hub — it's one routed page per admin action (`/admin`, `/admin/add-instrument`, `/admin/remove-instrument`, `/admin/remove-user`), each sharing `AdminService`, following an identical `signal`-based skeleton with `MatSnackBar` feedback. No existing admin action shows a structured result — all show a single/dual-number snackbar. This repeats an earlier attempt (reverted) that only covered the backend.

## Desired End State

An admin opens `/admin/cron-run` from the sidebar (nav label "Aktualizuj dane"), clicks "Wymuś aktualizację danych", confirms in a dialog, and sees a results panel — per-ticker outcomes, alerts-evaluated count, per-email outcomes (with instrument names), and errors — with zero need for curl or logs.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Backend summary propagation | `handleScheduled`/`evaluateAlerts` return structured objects (was `void`) | Carried over from the prior (reverted) planning round, unchanged | Plan (prior round) |
| HTTP status on partial failure | `207` when any error present, `200` otherwise | Carried over; verified no conflict with Angular's `HttpClient` (207 is 2xx → delivered via `next()`) | Plan (prior round) |
| Page structure | New dedicated routed page (`/admin/cron-run`), not a section in `/admin` | Matches the app's only existing pattern — one page per admin action | Plan |
| Confirmation before triggering | `MatDialog` Confirm/Cancel, no typed confirmation | Matches `remove-instrument`/`remove-user`'s pattern for real-consequence actions; issue explicitly flags this as "not a no-op action" | Plan |
| Results display | Inline structured panel (tickers/emails/errors), not a snackbar | A snackbar can't show the per-item breakdown the backend is built to return — this is the issue's stated purpose | Plan |
| Frontend automated tests | None — manual QA only | Matches CLAUDE.md's hard rule against generated spec files, and every prior admin-panel change | Plan |
| Loading UX | Disabled button + spinner during submit | This request fans out to multiple external calls with retries — longer than the single-call actions the disabled-only pattern was designed around | Plan |
| Results panel data richness | Enriched with instrument names via `InstrumentsService` (already loaded elsewhere) | Consistent with the rest of the Polish-language UI; minimal extra cost since the service already exists | Plan |

## Scope

**In scope:**
- Backend: `handleScheduled`/`evaluateAlerts` summary refactor, `POST /api/admin/cron/run` route, worker tests.
- Frontend: `AdminService.triggerCronRun()`, `/admin/cron-run` page, confirm dialog, results panel, nav link, `messages.pl.xlf` translations.

**Out of scope:**
- Dry-run mode, `trigger_events` source-tracking column, concurrency locking (all carried over from the prior round).
- "Last run" persistence/history for the page (ephemeral results only).
- New Angular `.spec.ts` files or a Playwright E2E test for this flow.

## Architecture / Approach

Two backend phases (pipeline refactor → admin route), identical to the already-reviewed prior round, then one frontend phase that adds the page following the codebase's established admin-component skeleton, with two new elements: a confirm dialog with no async data-preview step, and the app's first structured-results panel (vs. every prior action's single-number snackbar).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Return structured summaries | `handleScheduled`/`evaluateAlerts` return typed summaries; cron unchanged | Accidentally breaking the cron's `Promise<void>` contract — mitigated by an explicit async wrapper |
| 2. Admin endpoint | `POST /api/admin/cron/run` route + tests | Test mocking must route two fetch destinations (Yahoo, Resend) correctly |
| 3. Admin panel UI | New page, dialog, results panel, nav link, translations | Missing an i18n `<trans-unit>` entry silently breaks `npm run build` (hard `error` gate) |

**Prerequisites:** None — builds on existing `handleScheduled`/`evaluateAlerts`/admin-route/admin-component infrastructure.
**Estimated effort:** ~1-2 sessions across 3 phases (Phase 3 is the largest — new component + dialog + routing + translations).

## Open Risks & Assumptions

- Assumes calling this from the UI against production data is an accepted risk the admin takes on knowingly each time (real Resend sends) — the confirm dialog is the only safeguard, no second "type to confirm" step.
- Two truly overlapping runs (two clicks, or a click racing the real cron) can still send a duplicate email for the same crossing — documented as an accepted risk, not engineered around.
- The exact set of new i18n ids in Phase 3 is finalized during implementation as the component's strings are written; the plan lists the expected set as a checklist, not a literal final one.

## Success Criteria (Summary)

- An admin can trigger the full pipeline from the admin panel UI and see exactly what happened, per ticker and per alert, without reading Worker logs.
- A non-admin cannot reach the page; an accidental click doesn't fire anything without an explicit confirm.
- `npm run build` succeeds, proving every new UI string has a Polish translation.
