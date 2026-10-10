# E2E generation prompt — alert editing, validation, current value

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md`) are the levers — this file
carries only what they can't know.

```text
We are adding E2E tests for these risks from context/foundation/test-plan.md:
Risk #4 (the Angular alert form regresses silently), browser-level facets that
the existing create/delete/filter specs do not cover.

Research anchor:
The alert form (src/app/features/alerts/alert-form) is shared by create and
edit. Threshold validators: required, positive (price), 0-100 (RSI). A 409 from
POST /api/alerts renders "Taki alert już istnieje.". The alerts list renders a
"Bieżąca wartość" column from currentPrice / currentRsi in GET /api/alerts.

Business scenarios (one observable behavior each):
1. Edit: a changed threshold is saved and survives a reload; the old value is gone.
2. Validation: an empty, non-positive or out-of-range threshold shows a message
   and nothing is saved; a duplicate alert shows a message instead of a second row.
3. Current value: the column shows the formatted price / RSI, and "—" when there
   is no market data.

Real boundaries (do not mock): storageState session, Angular router, alert form,
PUT/POST/DELETE /api/alerts, D1.

Mocked boundaries (mock at network layer):
Scenario 3 only: GET /api/alerts, because the real values depend on local
market data.

Write Playwright tests following seed.spec.ts patterns and the E2E rules.
Assert the business outcome that would fail if the risk materialized.
```
