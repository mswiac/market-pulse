<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alert Edit & Delete Implementation Plan

- **Plan**: context/changes/alert-edit-delete/plan.md
- **Scope**: Phase 1 of 4 through Phase 4 of 4 (full plan)
- **Date**: 2026-07-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (re-run at review time)

- `npm run typecheck` — pass
- `npm run test:worker` — 56/56 pass (7 files)
- `npm run build` — pass (i18nMissingTranslation: "error" gate satisfied)

## Manual verification

All Progress manual checkboxes (1.3, 3.4–3.8, 4.4–4.8) are `[x]` with commit SHAs, confirmed interactively by the user during the session, including a live 3-round UX iteration on the delete-confirmation dialog's readability — direct observable evidence, not rubber-stamped.

## Findings

### F1 — Delete failure is silent (no error handling on AlertsService.delete() call site)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/alerts/alert-list/alert-list.ts:105 (`deleteAlert()`)
- **Detail**: `this.alertsService.delete(alert.id).subscribe()` has no `error` callback. If the DELETE request fails (network error, or a 404 race — e.g. the alert was already removed via another tab, which `AlertForm`'s edit path explicitly handles with a "This alert no longer exists." message per Phase 3), the user gets no feedback at all: the confirm dialog already closed, and the row just silently stays in the list with no indication anything went wrong. This is inconsistent with `alert-form.ts`, which surfaces every `update()`/`create()` failure via `formError`/`messageFor()`.
- **Fix**: Add an `error` callback to the `subscribe()` call — at minimum log it, ideally surface a brief user-facing message (the app currently has no snackbar/toast primitive; a simple inline banner near the list, or reusing `loadError`-style signal state, would fit the existing pattern without introducing a new UI primitive).
- **Decision**: FIXED — added a `deleteError` signal (mirroring `loadError`), set on the `delete()` subscribe's `error` callback and cleared before each new delete attempt; renders as an inline `.delete-error` banner above the list. New i18n id `alertList.deleteError`, extracted and translated. Typecheck/build re-verified.

### F2 — Delete-confirm dialog's data contract diverged from plan.md's text (deliberate, user-directed)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts, plan.md Phase 4 §1
- **Detail**: `plan.md`'s Phase 4 contract specifies `DeleteAlertConfirmData = { summary: string }`, a single pre-formatted string built by the caller. The shipped code instead uses `{ instrument: string; alertType: string; threshold: string }`, rendered as a labeled `<dl>` (definition list) reusing the list's own "Walor"/"Typ alertu"/"Próg" column labels, plus an added "This action cannot be undone." body line not in the original contract. This was a live, user-directed UX iteration during Phase 4 (three rounds of feedback: illegible flat string → redundant "próg" wording → final labeled-fields structure), explicitly grounded in Material Design 3 guidance against mixing prose and list-style data in one dialog region (cited and researched mid-session). The result is a genuine improvement — clearer, more accessible, consistent with the app's existing labeling conventions — not scope creep or an unreviewed decision. The only actual gap is that `plan.md`'s Phase 4 §1 contract text itself was never updated to reflect what shipped, so it's now a stale reference for future readers.
- **Fix**: Update `plan.md` Phase 4 §1's Contract text to describe the shipped `{ instrument, alertType, threshold }` / `<dl>` structure instead of the original flat-string design, so the plan stays an accurate record.
- **Decision**: FIXED — `plan.md` Phase 4 §1's Contract updated to the shipped `{ instrument, alertType, threshold }` / `<dl>` structure, with an Addendum explaining the mid-implementation UX iteration and its M3 rationale.

## Notes

- Security: `sessionMiddleware` applies at the `alertsRoutes` module level, so both new routes inherit auth. Both `PUT`/`DELETE` scope every query with `WHERE id = ? AND user_id = ?`; the `UNIQUE` constraint is itself `user_id`-scoped, so no cross-user data leak or write is possible. `test/worker/alerts.test.ts` explicitly covers cross-user 404 isolation for both new endpoints.
- The one load-bearing implementation detail flagged in the plan's "Critical Implementation Details" — that `AlertForm`'s pre-fill must not trigger its own reset-on-change `valueChanges` subscriptions — was verified correct: initial values (including alertType-matched threshold validators) are set in the `FormBuilder.group()` initializer, which runs before the constructor wires the subscriptions.
- No SQL injection, no unbound queries, no un-unsubscribed long-lived subscriptions found.
