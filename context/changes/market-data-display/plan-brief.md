# Plan Brief: S-04 Market Data Display

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Price/RSI placement | Detail panel only (not the collapsed summary row) | User preference — keeps summary row layout unchanged |
| Price/RSI data source | Joined into `GET/POST/PUT /api/alerts` | One request, no client-side join, no N+1 |
| Instrument-type selector | Build now, even though only one `type` value (`index`) exists | Matches roadmap's S-04 scope literally, after confirming with the user it's worth building ahead of a second type |
| Type option source | Derived from a distinct-types query, not hardcoded | Zero frontend change needed when a second type ships |
| Instrument dropdown fetch | Fetch the full registry once, cache in a signal, filter by type client-side via `computed()` (revised during plan review, F3 — originally planned as a per-type-change `?type=` fetch) | Matches the signal-cache pattern both existing services (`alerts.service.ts`, `auth.service.ts`) already use; also removes a redundant network round-trip per type change |
| "No data" messaging | Same generic text for "not yet available" and "temporarily unavailable" | No business need yet to distinguish; keeps it simple |
| List sort key | Sort by displayed instrument name, not raw ticker | Matches what the user actually sees in the column |
| Frontend repair scope | Full rename to `ticker` + drop the hardcoded `INSTRUMENT_LABELS` map | Consistent with F-03's intent to remove hardcoded instrument lists |
| RSI-eligibility contract | Extend `GET /api/instruments` with `rsiEligible`, deliberately breaking a pinned F-03 test | Frontend genuinely needs it to show/hide the RSI option; no other source for it |
| Alert response errors | Keep the existing single `loadError` banner | One join, one request, one failure mode — no new error-handling surface needed |

## Scope

- Backend: extend alert responses (GET/POST/PUT) with instrument name/type + current price/RSI; extend the instruments endpoint with `rsiEligible`.
- Frontend: repair the 4 files still broken against the ticker-based backend (`alerts.service.ts`, `alert-form.ts`, `alert-list.ts`, `delete-alert-confirm`); add a new `InstrumentsService`; rebuild the alert form's instrument selection as a type→name cascade.
- No database migration — every column needed already exists post-F-03/F-02.

## Architecture / Approach

Two phases, backend then frontend (same split F-03 used): Phase 1 makes the API serve everything the UI needs (joined via a shared `ALERT_SELECT` fragment, re-selected after `INSERT`/`UPDATE` since D1's `RETURNING` can't join tables); Phase 2 consumes it, fixing the breakage and adding the cascading select.

## Phases at a Glance

1. **Backend — join instrument/market data into alert responses.** `alerts.ts` and `instruments.ts` route changes + test updates. No schema change.
2. **Frontend — repair ticker fields + registry-driven form.** 8 frontend files (service, new instruments service, form, list, delete-confirm × 2 each).

## Open Risks & Assumptions

- The alert form's instrument list now loads asynchronously (previously a static array) — but since `instrumentOptions` is a `computed()` over the cached signal rather than a second per-type fetch, there's no ordering hazard: the form's `selectedInstrumentType` signal is initialized synchronously at construction, same as the form control. Called out explicitly in the plan's Critical Implementation Details.
- Extending `GET /api/instruments`'s response is a deliberate contract change from F-03 (breaks a test pinned to exactly 3 keys) — expected, not a defect.
- Plan review (F2) added a `loadError` signal to the alert form for the instruments-fetch failure path, and (F3) revised the instruments-fetch strategy to a signal cache for pattern consistency with the two existing Angular services.
