<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Daily High/Low Alert Evaluation

- **Plan**: context/changes/daily-high-low-evaluation/plan.md
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: SOUND (after fixes; REVISE before triage)
- **Findings**: 2 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (2 findings, both fixed) |
| Plan Completeness | PASS |

## Grounding

10/10 paths verified via `ls -l` (market-data.ts, scheduled.ts, alert-evaluation.ts, alerts.ts, trigger-events.ts, instruments.ts, alerts.service.ts, trigger-history.service.ts, instrument-history.service.ts, migrations/0010_instrument_currency.sql). 8/8 symbols grounded via grep (conditionMet, hasRetreatedPastMargin, computeArmed, CurrentMarketValue, ALERT_SELECT, DISPLAYED_COLUMNS, range=1mo, HISTORY_DAYS/LOOKBACK_DAYS/RSI_PERIOD). Brief↔plan consistent. Progress↔Phase section mechanically consistent (5/5 phases matched, every Success Criteria bullet has a matching Progress checkbox, no stray checkboxes in phase blocks).

## Findings

### F1 — computeArmed doesn't handle the no-market_data-row case

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real fix needed, narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 3 (Armed-state consistency)
- **Detail**: The plan's Phase 3.3 contract had `computeArmed` call the new `resolveFiringValue(alertType, direction, snapshot)`, where `snapshot: MarketSnapshot` requires `price: number` (non-nullable). But `computeArmed` today handles the case where no `market_data` row exists yet for a ticker (`row === null` from `.first<CurrentMarketValue>()`) by returning `armed = 1` immediately — exercised by an existing, currently-passing test (`test/worker/alerts.test.ts:73-108`, alert created with no seeded `market_data`, expects `active: true`, `currentPrice: null`). The original plan text gave no guidance for reconciling this null-row case with the new non-nullable `resolveFiringValue` contract, which would force the implementer to guess — a naive implementation would throw at runtime and break the existing test/endpoint.
- **Fix**: Keep the existing early return unchanged — if `row` is `null`, return `armed = 1` immediately, before ever constructing a `MarketSnapshot` or calling `resolveFiringValue`. Only call `resolveFiringValue` once `row` is confirmed non-null.
- **Decision**: FIXED — applied to Phase 3, item 3's contract text in `plan.md`.

### F2 — Migration Notes wrongly claims immediate self-backfill of high/low for the 30-day history view

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes, real tradeoff
- **Dimension**: Blind Spots
- **Location**: Migration Notes + Phase 5, item 3 (Instrument history)
- **Detail**: The original Migration Notes claimed `high`/`low` self-backfill "within the first post-deploy cron run" and that this is "within the self-backfilling window" needed by S-07. But S-07 reads `LOOKBACK_DAYS = HISTORY_DAYS(30) + RSI_PERIOD(14) = 44` trading days (`instruments.ts:11-15`), while the daily fetch only requests `range=1mo` (`market-data.ts:32`) — roughly 21 trading days, well short of 44. Full backfill of the display range actually takes on the order of weeks (the rolling `1mo` window sliding forward day by day), not one cron run. Meanwhile the original Phase 5.3 contract typed `InstrumentHistoryEntry.high`/`.low` as `number` (non-nullable) — a real type/runtime mismatch against data that will legitimately be `null` for older days for an extended period, inconsistent with Phase 5.2's correct `number | null` typing for the same underlying nullable-column reality on `TriggerEvent`.
- **Fix A ⭐ Applied**: `high`/`low` typed `number | null` in `InstrumentHistoryEntry`, with the UI rendering blank cells for `null`, mirroring the already-proven `rsi: number | null` ramp-up pattern in the same table.
  - Strength: No ingestion changes; accurately reflects real data state; reuses a pattern already shipped and tested in this exact table.
  - Tradeoff: Older days show blank High/Low cells for the first few weeks after deploy.
  - Confidence: HIGH — the `rsi: null` pattern already exists and is tested (`test/worker/instruments.test.ts` partial-lookback case).
- **Fix B (not applied)**: Widen the daily fetch range (e.g. `range=3mo`) for immediate full backfill.
  - Strength: Single cron run fully populates the 44-day lookback.
  - Tradeoff: Permanently larger payload/parse cost on every daily cron run, not just around the migration; CPU/response-size cost on the Workers Free tier unverified.
  - Confidence: MEDIUM — untested at this response size in this environment.
- **Decision**: FIXED — applied Fix A to Phase 5, item 3's contract, added a new "Self-backfill window" note under Critical Implementation Details, and corrected Migration Notes (including a forward-reference to a possible future admin-panel on-demand fetch capability, raised during triage, as a natural way to accelerate backfill later without changing this plan's design).
