# Admin can remove an instrument from the registry — Plan Brief

> Full plan: `context/changes/admin-remove-instrument/plan.md`

## What & Why

An admin needs a way to remove a stale or mistaken instrument from the `instruments` registry through the UI, without manual SQL. Because `ticker` is a plain string key (no FK) shared by `price_history`, `market_data`, `alerts`, and `trigger_events`, simply deleting the registry row would leave orphaned data and broken alerts behind — this plan defines exactly what gets cleaned up and what's preserved.

## Starting Point

The admin panel (`S-09`, `S-10`) has two actions today: fetch market data and add an instrument. Both established the patterns this plan reuses — admin-gated routes with `{error, code}` responses, a type→ticker combobox picker, and a separate route+sidebar-link per action. No delete endpoint with dependent-row cleanup exists anywhere in the codebase yet.

## Desired End State

An admin opens `/admin/remove-instrument`, picks an existing instrument, sees a confirmation dialog stating how many alerts (across all users) will also be deleted, confirms, and the instrument plus its alerts, price history, and market data are gone — atomically, immediately reflected everywhere else in the app (alert form, instrument history, other admin pages) with no page refresh.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Alerts referencing the ticker | Cascade-delete | Admin action should always succeed rather than getting blocked by another user's un-cleaned alert | Plan (user) |
| `price_history`/`market_data` rows | Delete both | "Remove this instrument" should mean fully gone, not silently orphaned data with no UI to see it | Plan (user) |
| `trigger_events` rows | Leave untouched | Already tolerates a missing instrument via `LEFT JOIN` + `COALESCE`; it's an audit log of emails actually sent, not live operational data | Plan (user) |
| Destructive-action confirmation | Dialog showing affected-alert count | Admin sees the real blast radius on other users' data before an irreversible cascade | Plan (user) |
| `type='index'` (VIX/NDX) protection | None — same endpoint, no special-casing | Matches the "admin is trusted" contract already accepted for `POST /instruments` | Plan (user) |
| Notify affected users | No email sent | Keeps this change scoped to one endpoint + one page, matching S-09/S-10's size | Plan (user) |

## Scope

**In scope:** `GET /api/admin/instruments/:ticker/impact` (alert-count preview); `DELETE /api/admin/instruments/:ticker` (atomic cascade delete of alerts/price_history/market_data/instruments); new confirmation-dialog component; new "Remove instrument" admin page; routing, sidebar nav, and i18n.

**Out of scope:** protecting index-type instruments; emailing affected users; touching `trigger_events`; instrument editing; any schema/migration changes (none needed).

## Architecture / Approach

Backend cascade-delete endpoint first (shares its alert-count query with the impact-preview endpoint), then the reusable frontend pieces (service methods, dialog component), then the page that wires them together, then routing/nav/i18n last to make it reachable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Backend endpoints | Impact preview + atomic cascade delete, with tests | Getting the `batch()` cascade order right so a partial failure can't leave `instruments` gone but `alerts` intact, or vice versa |
| 2. Frontend service + dialog | `AdminService` methods, `RemoveInstrumentConfirm` dialog | None significant — closely mirrors `delete-alert-confirm` |
| 3. Remove-instrument page | The user-facing feature | i18n catalog completeness may only fully resolve once Phase 4's ids land — noted in the plan |
| 4. Routing, nav, i18n | Reachable page, complete Polish translations | None significant |

**Prerequisites:** none — `S-09` and `F-03` (roadmap prerequisites) are already done.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes a small race window between the impact-preview call and the confirm click (an alert could be added in between) is acceptable for a low-frequency, admin-only action — no locking or re-validation beyond what the delete endpoint itself recomputes atomically.
- Assumes D1's `batch()` provides sufficient atomicity guarantees for the 5-statement cascade (count + 4 deletes) — same assumption already relied on by `alerts.ts`'s existing `batch()` usage.
- A cron run already mid-flight for the same ticker at delete time can transiently resurrect `price_history`/`market_data` rows for it, since `scheduled.ts` snapshots the instrument list once at the start and doesn't re-check existence before writing. Narrow and self-limiting (next day's cron no longer includes the deleted ticker) — accepted rather than adding a re-check.

## Success Criteria (Summary)

- An admin can remove an instrument end-to-end and see an accurate pre-delete impact count.
- All dependent alerts, price history, and market data for the removed ticker are gone; trigger history for it still renders correctly.
- The removed ticker disappears from every other part of the app immediately, with no stale cache.
