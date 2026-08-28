---
change_id: alert-form-submitting-mutants
title: Harden alert-form component tests against the submitting-flag / double-submit mutants
status: implemented
created: 2026-08-28
updated: 2026-08-28
archived_at: null
---

## Notes

GitHub issue #114. Per-component follow-up to the frontend mutation-testing work
(#110, #112, #113) — the identical treatment #113 gave the admin components, now
for `src/app/features/alerts/alert-form/alert-form.ts`.

`alert-form.ts` uses the same `submitting`-signal guard as the admin components
(`alert-form.ts:76,147,150,161`). `alert-form.spec.ts` exists (Phase 3 / risk #4)
but stubs the service with synchronous `of(...)`, so `submitting` flips
`false → true → false` in one tick — no test observes the in-flight `true` state,
and none asserts the button re-enables on the error path. A scoped Stryker run
flags `submitting.set(true) → set(false)`, `set(false) → set(true)`, and the
`||`/`&&` operator mutants in the guard as survivors.

What to do:
- Thread a caller-controlled `Subject` through `alert-form.spec.ts`'s service stub
  for the create/update call.
- In-flight assertion: submit a valid form, do not emit, assert the submit button
  is `disabled` — kills `submitting.set(true)` and the guard's `||` → `&&`.
- Re-enable-on-error assertion: emit an error, assert the button is enabled again
  — kills `submitting.set(false)` in the error handler.
- Re-run scoped and confirm survivors gone:
  `npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/**/*.ts,!src/app/features/alerts/alert-form/**/*.spec.ts"`
- Short before/after comment, per the #91 / #109 precedent.

#110 runs the broad triage pass and is expected to defer these mutants; this
change is that dedicated work — do it after or alongside #110.
