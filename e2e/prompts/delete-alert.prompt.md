# E2E generation prompt — alert deletion via confirm dialog

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md` § "10xDevs AI Toolkit -
Module 3, Lesson 4") are the levers.

```text
We are adding an E2E test for this risk from context/foundation/test-plan.md:
§3 Phase 6 — "alert deletion via confirm dialog", the rendered-UI + persistence
facet in the Risk #4 / Risk #8 area (dialog-guarded destructive action + data
survives the round trip).

Research anchor:
test-plan.md §3 Phase 6, and §6.5's dialog notes. alert-list.ts deleteAlert()
opens the delete-alert-confirm MatDialog and only calls AlertsService.delete()
(DELETE /api/alerts/:id -> D1) when afterClosed() is truthy. AlertsService.delete
optimistically drops the row from the alerts signal on success, so the list
updates before a reload — the reload is what proves the DELETE actually
persisted. The confirm dialog's "Anuluj" button closes with a falsy value;
"Usuń" closes with true.

Business scenario (two observable behaviors that must stay true):
1. Create an alert, open its delete dialog, confirm -> the alert disappears from
   the list AND is still gone after a full page reload.
2. Create an alert, open its delete dialog, cancel -> the alert is still in the
   list (and still there after a reload).

Real boundaries (do not mock — the risk hides here):
storageState auth, the reactive form, POST /api/alerts, DELETE /api/alerts/:id,
D1, the MatDialog confirm/cancel branch, full page reload.

Mocked boundaries (mock at network layer):
None.

Write a Playwright test following seed.spec.ts patterns and the E2E rules.
Unique threshold per alert; an afterEach sweeps any alert the run created (via
the API, matched by the run's own thresholds) so re-runs don't collide with the
alerts UNIQUE(user_id, ticker, alert_type, threshold) constraint.
Assert the business outcomes that would fail if this risk materialized.
Explain in one sentence which regression this test catches.
```

**Regression caught:** if a confirmed delete stops persisting (DELETE is a
no-op), or a cancelled delete starts calling the service anyway, this test goes
red instead of the UI silently lying about what happened to the user's alert.
