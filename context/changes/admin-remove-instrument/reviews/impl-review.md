<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin can remove an instrument from the registry

- **Plan**: context/changes/admin-remove-instrument/plan.md
- **Scope**: Phase 4 of 4 (full plan)
- **Date**: 2026-08-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Grounding

- `git diff --name-only f076396..HEAD` matches the plan's file list exactly (11 app/test files + 4 context docs) — no unplanned files.
- Automated checks re-run at HEAD (2cb15dc): `npm run typecheck` clean, `npm run test:worker` 163/163 passed, `npm run build` clean (full i18n catalog validated now that the route is wired).
- All Progress checkboxes in plan.md are `[x]` with commit SHAs matching `git log` (c40861a, 21384ac, 89a617e, 6ca4413).
- Manual Progress items (1.3, 4.2–4.7) were checked off following the user's explicit statement "zweryfikowane" after being shown the full itemized list — not inferred from a generic acknowledgement.

## Findings

### F1 — DELETE route's D1 batch call has no error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/admin.ts:226-232
- **Detail**: The new `DELETE /instruments/:ticker` route's `c.env.DB.batch([...])` call is not wrapped in try/catch, unlike its two sibling write routes in the same file — `POST /market-data` (admin.ts:88-97) and `POST /instruments` (admin.ts:178-193) both catch and return `{error, code}` JSON on failure. If the batch throws (e.g. a transient D1 error), it propagates to Hono's default handler, returning a plain-text 500 instead of the file's established `{error, code}` shape. The frontend's `showError()` falls back to its generic message either way, so this is not user-visible breakage, but it's an inconsistent error-handling convention and has no matching test (unlike `admin.test.ts:242-257`'s equivalent "returns 500 when the D1 batch write fails" case for `POST /market-data`).
- **Fix**: Wrap the batch call in try/catch, returning `{error: 'failed to delete instrument', code: 'delete_failed'}` on 500, matching the two sibling routes' convention. Add a matching test mirroring `admin.test.ts:242-257` (`vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(...)`).
- **Decision**: FIXED (try/catch added, `delete_failed` code, matching test added — `test/worker/admin.test.ts`; 164/164 tests pass)

### F2 — No test assertion that trigger_events.alert_id is nulled by the cascade

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: test/worker/admin.test.ts:564-606 (test body); migrations/0011_alert_notifications.sql:75 (schema)
- **Detail**: `trigger_events.alert_id` has `REFERENCES alerts(id) ON DELETE SET NULL`. When the batch's `DELETE FROM alerts WHERE ticker = ?` runs, D1 (if FK enforcement is on) nulls `alert_id` on any surviving `trigger_events` row that pointed at a deleted alert — pre-existing schema behavior, identical to what already happens via `DELETE /api/alerts/:id`, not something this plan introduces. The cascade-delete test asserts the `trigger_events` row still exists but doesn't assert on `alert_id`, so this specific FK-driven side effect is unverified.
- **Fix**: Add one assertion in the existing cascade test: `expect(row.alert_id).toBeNull()` after the delete, for completeness.
- **Decision**: FIXED (assertion added — empirically confirmed D1 *does* enforce the FK here, `alert_id` is nulled; this corrects the plan's "Current State Analysis" claim that D1 never enforces FKs, though it doesn't affect the shipped feature's correctness since all deletes are explicit app-code statements, not relied-upon cascades)

### F3 — Ticker path param isn't normalized (trim/uppercase) on the two new routes

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/admin.ts:197, 217
- **Detail**: `POST /instruments` normalizes the ticker (`body.ticker.trim().toUpperCase()`, admin.ts:153) before use. The two new routes read `c.req.param('ticker')` raw with no normalization — a differently-cased request would 404 even if the "same" instrument exists. Low practical risk since the frontend always sends tickers copied verbatim from `InstrumentsService`.
- **Fix**: Apply the same `.trim().toUpperCase()` normalization to the path param in both new routes, for defense-in-depth consistency with the rest of the file.
- **Decision**: FIXED (`.trim().toUpperCase()` applied to both routes' ticker param; 164/164 tests still pass)

### F4 — `unknown_instrument` returns 404 here vs. 400 in POST /market-data

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/admin.ts:201, 221 (new routes) vs. admin.ts:63 (POST /market-data)
- **Detail**: The same `code: 'unknown_instrument'` value is returned with different HTTP statuses across the file — 404 in the two new routes, 400 in the existing `POST /market-data`. Arguably 404 is the more correct choice for a path-param lookup, but it's an inconsistency for an identical `code` string. Harmless since frontend consumers key off `code`, not status.
- **Fix**: No change recommended — 404 is arguably the better convention for path-param resource lookups; leaving as-is unless the team wants to retroactively align `POST /market-data` too (out of this plan's scope).
- **Decision**: SKIPPED (user: 404 is correct here, aligning POST /market-data is out of scope)

### F5 — Instrument pickers stay enabled during the impact→dialog→delete flow

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/admin/remove-instrument/remove-instrument.html:12-27; remove-instrument.ts:79
- **Detail**: While `submitting()` is true (impact fetch in flight, confirm dialog open, or delete in flight), only the submit button is disabled — the type/instrument `mat-select`s remain interactive. No data-correctness impact since `onSubmit()` captures the ticker into a local `const` used through the whole async chain, but a user could visually reselect a different instrument mid-flow while the dialog still references the original one.
- **Fix**: Optionally bind `[disabled]="submitting()"` to both `mat-select`s for UX polish. Not required — no functional bug.
- **Decision**: FIXED (`[disabled]="submitting()"` added to both `mat-select`s in `remove-instrument.html`)

## Sub-agent notes

- Plan Drift Detection agent: full MATCH across all 4 phases, no drift, no missing pieces, no scope creep, "What We're NOT Doing" verified not contradicted (no `type='index'` guard added, no email code, no `trigger_events` writes, no optimistic lock, `scheduled.ts` untouched).
- Safety & Pattern agent: authorization wiring, SQL parameterization, batch atomicity, `trigger_events` exclusion, URL encoding, and double-submit guarding all confirmed correct. No CRITICAL findings.
