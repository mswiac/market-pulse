# Trigger History Implementation Plan

## Overview

Add a read-only "trigger history" page (roadmap S-06 / FR-010): a paginated backend endpoint over the existing `trigger_events` table, and an Angular page listing every alert-trigger event for the logged-in user — timestamp, instrument, alert type, direction, threshold, value-at-trigger, and email delivery status.

## Current State Analysis

`trigger_events` was created and is already populated by the `alert-notifications` slice (S-05, archived) — the daily cron (`src/worker/lib/alert-evaluation.ts:93-111`) inserts one row per genuinely-fired alert (both successful and failed email sends), but nothing in the codebase reads the table today: no route exposes it, and no frontend page renders it. This plan is purely additive on top of that existing data.

## Desired End State

A logged-in user can navigate to a new "Triggered alerts" page (nested under the existing "History" sidenav section) and see a table of every alert they've had fire, newest first, with a "load more" control once more than one page exists. Verify by: registering, letting (or forcing, in a local dev seed) an alert fire, and confirming the row appears with correct instrument name, values, and — for a failed email — a tooltip explaining why.

### Key Discoveries:

- `trigger_events` schema (`migrations/0011_alert_notifications.sql:72-86`): `id, user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, notification_email, email_status ('sent'|'failed'), email_error, triggered_at`. Only `user_id` is indexed today (`idx_trigger_events_user_id`) — no index supports `ORDER BY triggered_at`.
- No route/service/component anywhere queries `trigger_events` (confirmed via full-repo grep) — nothing to integrate with or break.
- `ticker` is denormalized onto `trigger_events` (survives `alerts` row deletion via `ON DELETE SET NULL` on `alert_id`), but the display **name** and **currency** require a join to `instruments` on `ticker` — that join must be a `LEFT JOIN` with a fallback, since a ticker could in principle be missing from `instruments`.
- No list endpoint in this codebase paginates today (`GET /api/alerts`, `GET /api/instruments` both return bare unbounded arrays) — this plan introduces the first pagination pattern, decided as `limit`/`offset` query params with a `hasMore` boolean (see Critical Implementation Details), not cursor-based.
- The Hono route + auth pattern is identical across `alerts.ts`/`instruments.ts`: a per-route-group `Variables = { userId: number }`, `.use('*', sessionMiddleware)`, then `WHERE user_id = ?` scoping (`src/worker/routes/instruments.ts:7-9,17`; `src/worker/lib/session.ts:70-90`).
- The Angular pattern to mirror is `instrument-history` (`src/app/features/instrument-history/`): standalone component, colocated feature service with domain interfaces defined inline, `MatTableModule` styled via `.numeric-cell` + header-row color overrides (`instrument-history.scss:38-51`), `loadError`/scoped-error signals, i18n via `i18n="@@feature.key"`.
- `Shell` (`src/app/core/shell/shell.ts:24`, `shell.html:33-37`) already has an expandable "History" nav group with one nested link (`/history` → Instruments); `historyExpanded` is driven by `router.url.startsWith('/history')`, so a new sibling route under `/history/...` auto-expands the group for free — no need to touch that signal.
- Timestamps (`triggered_at`, like `updatedAt` in `alert-list.html:74`) are unix **seconds**; `DatePipe` needs `* 1000` before formatting, or it renders 1970.

## What We're NOT Doing

- Not adding filtering or search (by instrument, date range, alert type) — the roadmap outcome only asks for a chronological log.
- Not adding a total-count / "X of Y" indicator — only a `hasMore` boolean drives the "load more" control.
- Not changing the `alerts` table, the cron, or anything in `alert-evaluation.ts` — `trigger_events` is already fully and correctly populated; this slice only reads it.
- Not touching the existing `/history` (instrument-history) route or its nav link — the new route/link is added as a sibling, nothing existing is renamed.
- Not adding a shared cross-feature pagination utility/component — this is the first paginated list in the app; a reusable abstraction is premature until a second one exists.

## Implementation Approach

Two phases, backend then frontend, mirroring every prior slice's split in this codebase: a migration + Hono route + vitest tests first, then the Angular feature consuming it once the contract is stable.

## Critical Implementation Details

- **Pagination technique**: query `LIMIT ? OFFSET ?` with `limit + 1` rows requested from D1, then slice back down to `limit` before responding — `hasMore` is simply `rows.length > limit`. This avoids a separate `COUNT(*)` query per page load, at the cost of always over-fetching one row.
- **Timing**: `trigger_events` rows are written only by the daily cron when an alert genuinely fires — there is no way to generate fresh data for manual testing except waiting for the next cron run or inserting rows directly via `wrangler d1 execute ... --local` (or the equivalent local D1 SQL client) during Phase 1's manual verification.
- **Pagination drift (accepted)**: offset-based pagination can repeat or skip a row if a new `trigger_events` row is inserted while a user is mid-"load more" — an accepted, low-probability tradeoff given the only writer is a once-daily cron, not worth cursor-based pagination for this scale.

## Phase 1: Backend — paginated trigger-events endpoint

### Overview

Expose `trigger_events` (joined with `instruments` for display name/currency) as a session-scoped, paginated `GET /api/trigger-events` endpoint.

### Changes Required:

#### 1. Migration: history-supporting index

**File**: `migrations/0012_trigger_events_history_index.sql`

**Intent**: Support the new endpoint's `WHERE user_id = ? ORDER BY triggered_at DESC` query pattern with a covering index, and drop the now-redundant single-column index (the new composite index's leftmost column already serves any query that only filters by `user_id`).

**Contract**: Forward-only migration, next in sequence after `0011`:
```sql
DROP INDEX IF EXISTS idx_trigger_events_user_id;
CREATE INDEX idx_trigger_events_user_triggered_at ON trigger_events(user_id, triggered_at DESC);
```

#### 2. New route: `GET /api/trigger-events`

**File**: `src/worker/routes/trigger-events.ts` (new)

**Intent**: Return the current user's trigger events, newest first, paginated, with instrument display name/currency joined in and a raw-ticker fallback if the instrument record is missing.

**Contract**: Same shape as `instruments.ts` — `Variables = { userId: number }`, `.use('*', sessionMiddleware)`, exported default router, mounted in `index.ts` as `app.route('/api/trigger-events', triggerEventsRoutes)` alongside the existing route registrations (`src/worker/index.ts:17-19`).

Query params `limit` (default 20, clamp to `[1, 100]`) and `offset` (default 0, clamp to `>= 0`); non-numeric or missing values fall back to the default rather than erroring (matches the codebase's existing forgiving-query-param style, e.g. `instruments.ts:20`).

Query:
```sql
SELECT te.id, te.ticker, COALESCE(i.name, te.ticker) AS instrument_name, i.currency,
       te.alert_type, te.direction, te.threshold, te.value_at_trigger,
       te.email_status, te.email_error, te.triggered_at
FROM trigger_events te
LEFT JOIN instruments i ON i.ticker = te.ticker
WHERE te.user_id = ?
ORDER BY te.triggered_at DESC, te.id DESC
LIMIT ? OFFSET ?
```
bound to `(userId, limit + 1, offset)`. Slice to `limit`, compute `hasMore = rows.length > limit`, map snake_case → camelCase (matching the `AS rsiEligible`-style aliasing already used in `instruments.ts:23`), and respond `c.json({ events, hasMore }, 200)`.

#### 3. Tests

**File**: `test/worker/trigger-events.test.ts` (new)

**Intent**: Cover auth rejection, user isolation (a second user's events never leak), the instrument-name join, the missing-instrument raw-ticker fallback, newest-first ordering, and the `hasMore` pagination boundary — following `test/worker/instruments.test.ts`'s structure (`registerAndLogIn` helper, direct `env.DB.prepare(...).run()` seeding of `trigger_events` rows, `exports.default.fetch(...)` requests).

**Contract**: New `describe('trigger events endpoint', ...)` block; no changes to existing test files.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run migrate:local`
- Worker typecheck passes: `npm run typecheck`
- New and existing worker tests pass: `npm run test:worker`

#### Manual Verification:

- Against local D1 (`wrangler dev --local`), seed a couple of `trigger_events` rows for a test user (including one with a missing `instruments` row and one with `email_status = 'failed'`), hit `GET /api/trigger-events` with that user's session cookie, and confirm the JSON shape, ordering, ticker fallback, and `hasMore` boundary at `limit + 1` rows are all correct.

---

## Phase 2: Frontend — Triggered alerts page

### Overview

Add a new Angular feature page rendering the paginated trigger history, nested under the existing "History" sidenav section.

### Changes Required:

#### 1. Service

**File**: `src/app/features/trigger-history/trigger-history.service.ts` (new)

**Intent**: Fetch a page of trigger events; expose the domain types this feature owns (per the codebase convention of colocating interfaces in the service that produces them, e.g. `instrument-history.service.ts:5-16`).

**Contract**: `TriggerEvent` interface mirroring the endpoint's camelCase response fields (`id, ticker, instrumentName, currency, alertType, direction, threshold, valueAtTrigger, emailStatus: 'sent' | 'failed', emailError: string | null, triggeredAt: number`) plus a `TriggerEventsResponse { events: TriggerEvent[]; hasMore: boolean }`. One method: `list(offset: number): Observable<TriggerEventsResponse>` calling `GET /api/trigger-events?offset=` — `limit` is deliberately omitted so the backend's default/clamp (Phase 1) is the single source of truth for page size; nothing in this feature's scope needs a frontend-configurable page size.

#### 2. Component

**File**: `src/app/features/trigger-history/trigger-history.ts`, `.html`, `.scss` (new)

**Intent**: Render the paginated table with a "load more" control, following `instrument-history`'s structure (standalone component, `MatTableModule`, `loadError` signal) and `alert-list`'s formatting conventions (`DatePipe` with `* 1000`, `| number: '1.2-2'`, currency shown only for non-RSI rows, direction/alert-type label lookups).

**Contract**:
- Signals: `events` (accumulated array across pages), `offset`, `hasMore`, `loadError`, `loadMoreError`. Constructor loads the first page, setting `loadError` on failure (blocking, replaces page content — same convention as `instrument-history.ts:52,57`); a `loadMore()` method requests the next page at the current `offset + events().length`, appends on success, and sets `loadMoreError` on failure as a scoped inline banner alongside the already-rendered rows (mirrors `historyError` in `instrument-history.ts:53,96` / `deleteError` in `alert-list.ts:42`) — a failed "load more" must never wipe already-loaded rows.
- Table columns: date (`triggeredAt * 1000 | date: 'dd.MM.yyyy'`), instrument (`instrumentName`), alert type (local label map, same pattern as `alert-list.ts:11-14`), direction (same up/down label branching as `alert-list.html:60-64`, reusing the existing `@@alertForm.direction.up`/`@@alertForm.direction.down` i18n ids), threshold and value-at-trigger (`| number: '1.2-2'`, with `currency` appended only when `alertType !== 'RSI'`), and an email-status column — a plain indicator for `'sent'`, and for `'failed'` an icon carrying `matTooltip="{{ event.emailError }}"` (requires importing `MatTooltipModule`).
- Empty state: `@empty` block styled like `alert-list`'s `.empty-state` (`alert-list.scss:79-83`) for zero total events.
- i18n keys prefixed `@@triggerHistory.*`, matching the per-feature-prefix convention.

#### 3. Route + nav link

**File**: `src/app/app.routes.ts`, `src/app/core/shell/shell.html`

**Intent**: Register the new page as a sibling of the existing instrument-history route, and add its nav entry to the already-expandable "History" sidenav group.

**Contract**: In `app.routes.ts`, add `{ path: 'history/triggers', loadComponent: () => import('./features/trigger-history/trigger-history').then((m) => m.TriggerHistory) }` as another child of the `Shell` route (alongside the existing `path: 'history'` entry at `app.routes.ts:12-14`) — inherits `authGuard` from the parent, and still matches `historyExpanded`'s `router.url.startsWith('/history')` check with no changes needed there. In `shell.html`, add a second `<a mat-list-item class="nested-item" routerLink="/history/triggers" routerLinkActive="active-link">` inside the existing `@if (historyExpanded())` block (`shell.html:33-37`), labeled with a new i18n id (e.g. `@@shell.nav.triggerHistory`, text "Triggered alerts") to read distinctly from the top-level "Alerts" nav item.

### Success Criteria:

#### Automated Verification:

- Frontend build succeeds: `npm run build`
- Full CI pipeline passes: `npm run ci`

#### Manual Verification:

- Navigate to the new page via the "History" nav group; confirm columns, formatting, currency-only-for-non-RSI, and direction/alert-type labels render correctly for seeded data.
- Confirm the empty state renders for a user with zero trigger events.
- Confirm "load more" fetches and appends the next page, and disappears once `hasMore` is `false`.
- Confirm a failed "load more" request shows an inline error banner without clearing already-loaded rows.
- Hover a failed-email row's indicator and confirm the tooltip shows the actual `email_error` text.
- Refresh directly on `/history/triggers` and confirm the route guard keeps the user authenticated and the "History" nav section is expanded.

---

## Testing Strategy

### Unit Tests:

- N/A — no Angular spec files are generated (`skipTests: true` is set globally in `angular.json`); frontend correctness is covered by manual verification.

### Integration Tests:

- `test/worker/trigger-events.test.ts` (Phase 1): auth rejection, user isolation, instrument-name join + missing-instrument fallback, ordering, `hasMore` boundary.

### Manual Testing Steps:

1. Seed `trigger_events` rows locally (including a missing-instrument case and a `failed` email case) and verify the endpoint response shape and pagination boundary.
2. Walk through the new page end-to-end in the browser: nav link, table rendering, empty state, load-more, tooltip, and direct-URL refresh.

## Performance Considerations

The new composite index (`user_id, triggered_at DESC`) keeps the paginated query index-only for both the `WHERE` and `ORDER BY` clauses, avoiding a full-table scan as `trigger_events` grows over the lifetime of an account.

## Migration Notes

`migrations/0012_trigger_events_history_index.sql` is additive/index-only — no data is rewritten, and it's safe to apply to both local and remote D1 independently of application deploys (per this project's existing convention that D1 migrations are not auto-applied on deploy).

## References

- Prior slice (data producer): `context/archive/2026-07-31-alert-notifications/`
- Pattern to mirror (backend): `src/worker/routes/instruments.ts`
- Pattern to mirror (frontend): `src/app/features/instrument-history/`
- Roadmap entry: `context/foundation/roadmap.md:195-205` (S-06)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — paginated trigger-events endpoint

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run migrate:local`
- [x] 1.2 Worker typecheck passes: `npm run typecheck`
- [x] 1.3 New and existing worker tests pass: `npm run test:worker`

#### Manual

- [ ] 1.4 Seed local D1 trigger_events rows (incl. missing-instrument and failed-email cases) and manually verify `GET /api/trigger-events` response shape, ordering, fallback, and `hasMore` boundary

### Phase 2: Frontend — Triggered alerts page

#### Automated

- [ ] 2.1 Frontend build succeeds: `npm run build`
- [ ] 2.2 Full CI pipeline passes: `npm run ci`

#### Manual

- [ ] 2.3 Page renders correct columns/formatting/labels for seeded data
- [ ] 2.4 Empty state renders for zero trigger events
- [ ] 2.5 "Load more" fetches/appends and disappears once `hasMore` is false
- [ ] 2.6 Failed-email tooltip shows the actual `email_error` text
- [ ] 2.7 Direct refresh on `/history/triggers` keeps auth and expands the History nav section
- [ ] 2.8 Failed "load more" request shows an inline error banner without clearing already-loaded rows
