# Dashboard Page — Plan Brief

> Full plan: `context/changes/dashboard-page/plan.md`

## What & Why

Add a Dashboard ("Pulpit") page that lists every instrument in the system with one row from its latest close. It becomes the first menu item and the landing page after login, replacing the alerts list, which moves to `/alerts`. It gives a one-glance overview of the market without opening each instrument's history (GitHub issue #167).

## Starting Point

`/` renders the alerts page (welcome card, alert list, "New alert" button) and login/register redirect there. Instrument history shows one instrument at a time via the history endpoint, and the alerts list already has an instrument/type filter built on `InstrumentPicker`.

## Desired End State

After login the user sees Pulpit: a welcome card and a table with Instrument, Date, Close, High, Low, RSI per instrument, filterable by type and instrument, sortable by column, alphabetical by default. Alerts live under the second menu item at `/alerts`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Data source | New bulk endpoint `GET /api/instruments/latest` | One request, two D1 reads; a per-instrument loop would hit the 50-subrequest limit | Plan |
| RSI | Same server helper as history | Dashboard value equals the newest history row | Plan |
| Instruments without prices | Row with `—` | Instrument stays visible | User |
| Welcome card | Moves to Pulpit | Pulpit is the landing page | User |
| Default order | Alphabetical by name | Stable, predictable | User |
| Row click | Does nothing | Pure table with filters, as requested | User |
| Filtering | Client-side, type + instrument picker | Same as the alerts list; data set is small | Plan |

## Scope

**In scope:** bulk endpoint, Dashboard page, filter and sort, routing (`''` Dashboard, `alerts` Home), menu, translations, unit/worker/e2e tests, README.

**Out of scope:** row navigation, extra filters, pagination, schema changes, changes to Instrument history or cron.

## Architecture / Approach

The worker groups the last 44 closes of every instrument from one window-function query, computes RSI with a helper shared with the history endpoint, and returns the newest entry per instrument. The SPA fetches it once, filters with a pure helper, and sorts with signals in a `mat-table`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Latest-close endpoint | `GET /api/instruments/latest` + shared helper + worker tests | RSI parity with history |
| 2. Dashboard, routing, menu | Pulpit page, `/alerts`, menu, translations, unit tests | Hand-edited translations out of sync with templates |
| 3. E2E and docs | Repointed e2e specs, Dashboard e2e, README | Specs assuming alerts at `/` |

**Prerequisites:** branch `feat/dashboard-page` (exists).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Assumes the window-function query is fast enough on D1 with the existing `price_history` indexes; verify during Phase 1.
- Bookmarks to `/` now show Pulpit instead of alerts.

## Success Criteria (Summary)

- Login lands on Pulpit, showing one correct row per instrument.
- Filters and sorting work; alerts remain fully usable at `/alerts`.
- Unit, worker and Playwright suites pass.
