# E2E generation prompt — history pages smoke

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md`) are the levers — this file
carries only what they can't know.

```text
We are adding smoke E2E tests for this risk from context/foundation/test-plan.md:
Risk #4 (Angular surfaces have little automated coverage): the two history
pages are only reachable through the router and a real API, so a broken route,
guard or response mapping would go unnoticed.

Research anchor:
/history/triggers (trigger-history.html) shows the "Uruchomione alerty" heading
and either a table, the empty state "Brak jeszcze uruchomionych alertów." or a
load-error paragraph. /history (instrument-history.html) shows a choose-prompt
until an instrument is picked, then calls GET /api/instruments/:ticker/history
and renders a table (Data, Zamknięcie, ...) or a load-error paragraph.

Business scenarios (one observable behavior each):
1. Trigger history loads: heading visible, table or empty state, no error.
2. Instrument history loads closes for a picked instrument.

Real boundaries (do not mock): storageState session, router, instrument list
and picker, GET /api/trigger-events (scenario 1).

Mocked boundaries (mock at network layer):
Scenario 2 only: GET /api/instruments/:ticker/history with fixed rows, because
real closes depend on local market data.
```
