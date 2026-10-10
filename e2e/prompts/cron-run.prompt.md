# E2E generation prompt — Force data refresh admin page

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seeds
(`e2e/seed.spec.ts`, `e2e/admin/admin-gate-pass.spec.ts`) and the E2E rules
(`CLAUDE.md` § "10xDevs AI Toolkit - Module 3, Lesson 4") are the levers — this
file carries only what they can't know.

```text
We are adding E2E tests for this risk from context/foundation/test-plan.md:
Risk #8 (admin panel UI handling destructive / irreversible actions), applied
by analogy (Risk #8 names the delete-confirm dialogs; this page has the same
shape) — the "Force data refresh" page can send real notification emails, so
the confirm dialog must gate the run, and the run's outcome (including
partial failures from #172) must be rendered truthfully for the admin.

Research anchor:
src/app/features/admin/cron-run/cron-run.ts opens CronRunConfirm and, only on
confirm, sends three POST /api/admin/cron/run requests ({phase:'fetch',
market:'pl'}, {phase:'fetch', market:'other'}, {phase:'evaluate'}) and merges
the summaries. cron-run.html renders a Tickers table (error rows), "Alerts
evaluated: N", an Emails table or "No emails were sent.", and an Errors list
only when errors is non-empty. A 207 is a 2xx, so HttpClient treats it as a
normal body. Polish targets are in src/locale/messages.pl.xlf (cronRun.*).

Business scenarios (one observable behavior each):
1. Clean run: after confirming, the results show OK tickers, the evaluated
   count, "Nie wysłano żadnych e-maili." and no "Błędy" section.
2. 207 with a failed ticker: the Tickers table shows the Błąd status and the
   error message on that ticker's row.
3. 207 with errors (stale ticker / failed alert load, #172): the "Błędy"
   section lists every message.
4. Cancelling the confirm dialog sends no request.

Real boundaries (do not mock — the risk hides here):
storageState (admin session), adminGuard, Angular Router, the MatDialog
confirm, results rendering.

Mocked boundaries (mock at network layer):
POST /api/admin/cron/run only, via page.route, branching on the request body
(phase / market). No dependency on Yahoo or D1 data; server logic is covered
by worker tests. Use fake tickers (not in the catalogue) so the row label is
the raw ticker.

Write a Playwright test following the seeds and the E2E rules. Assert the
business outcome that would fail if this risk materialized. Explain in one
sentence which regression each test catches.
```

**Regressions caught:** (1) results mis-rendered or an errors section shown on
a clean run; (2) a failed ticker's error swallowed; (3) partial-failure errors
from the run dropped; (4) the confirm dialog stops gating the run (a cancel
would fire a real data refresh and emails).
