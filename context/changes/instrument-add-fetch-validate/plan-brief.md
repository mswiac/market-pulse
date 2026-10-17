# Fetch and Validate Market Data When an Instrument Is Added — Plan Brief

> Full plan: `context/changes/instrument-add-fetch-validate/plan.md`
> Frame brief: `context/changes/instrument-add-fetch-validate/frame.md`

## What & Why

Adding an instrument must be an atomic "fetch, validate, seed" step, and that validation is only meaningful once Yahoo "unknown symbol" can be told apart from "provider unavailable" — a distinction the fetch layer does not make today. Today a typo is found late (or never) and a new instrument has no history for a stable RSI.

## Starting Point

`POST /api/admin/instruments` only inserts a row. Every Yahoo failure is the same error class, timeouts are unwrapped, and real Yahoo answers an unknown symbol with HTTP 404 that no test models. `refreshInstruments` cannot create instruments (30-day window, swallowed errors).

## Desired End State

Adding a real instrument stores about 200 sessions and a `market_data` row with the same RSI the history pages show, immediately. An unknown symbol is rejected with a clear message, a Yahoo outage asks the admin to retry, a wrong currency is corrected to Yahoo's and reported, and the button shows "Checking data…" while it works.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unknown symbol vs outage | Distinct failure kinds on the fetch error | Otherwise an outage reads as a bad ticker | Frame |
| Window | ~300 calendar days ending tomorrow | Matches the 180-close RSI input and avoids losing today's close | Frame |
| Atomicity | One `DB.batch()` with the instrument INSERT first | No half-created instruments; fits the RSI trigger | Frame |
| Currency mismatch | Store Yahoo's currency and tell the admin | Consistent with "Yahoo wins"; user confirmed | Frame + Plan |
| Yahoo outage on add | Refuse and ask to retry (502) | Never create an unvalidated instrument | Plan |
| Waiting feedback | Button text "Checking data…" | Adds a few seconds to the request | Plan |
| E2E | Browser-mocked add and remove calls (no worker flag, no DB writes from e2e) | E2E must not call Yahoo and the worker's own Yahoo calls cannot be stubbed from the browser | Plan (revised in Phase 3) |
| RSI definition | Extract a shared `rsiFromCloses` used by cron and seed | Keeps one RSI definition (#211) | Plan |

## Scope

**In scope:** fetch failure kinds; seed path + endpoint; form messages, label, translations; CI/e2e flag and docs; worker/frontend tests.

**Out of scope:** the admin "fetch market data" form, the 30-day cron/alert windows, treating "too few sessions" as an error, DB-level guards, alert/cron logic.

## Architecture / Approach

`fetchDailyCloses` classifies failures. A new `seedInstrument` fetches the 300-day window with one attempt and a 6 s timeout, computes the RSI with the shared helper, and returns either a ready batch (instrument, price rows, market row) or a rejection reason. The route checks duplicates first, runs the batch, and maps outcomes to 201 / 409 / 422 / 502. The Angular form maps the new codes and shows the correction notice.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Failure kinds | `not_found` vs `provider` on the fetch error, incl. wrapped network errors | Misclassifying an ambiguous Yahoo response |
| 2. Seed path and endpoint | Atomic create with history, RSI and currency rule; new codes; tests | The RSI trigger and batch order; existing add tests need a Yahoo stub |
| 3. Form, e2e, docs | Messages, button label, translations, browser-mocked add and remove specs, docs | Mocks can drift from the real API shapes; the worker tests cover the real endpoints |

**Prerequisites:** #211 merged (done). **Estimated effort:** ~3 sessions across 3 phases; no migration.

## Open Risks & Assumptions

- The not-found signal rests on an unofficial endpoint (HTTP 404 / `Not Found`); an all-null series is treated as not-found.
- CPU of the add request is unmeasured; check Observability after deploy.

## Success Criteria (Summary)

- A real ticker added in the admin has history and the same RSI everywhere right away.
- A bad symbol is rejected, an outage is reported as an outage, and nothing partial is ever stored.
- CI e2e stay green without depending on live Yahoo.
