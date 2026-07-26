<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Instrument Currency Display Implementation Plan

- **Plan**: context/changes/instrument-currency-display/plan.md
- **Scope**: Phase 1 of 2 (full plan — both phases complete)
- **Date**: 2026-07-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `InstrumentRow.currency` unfetched at one of its two call sites

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/worker/routes/alerts.ts:19` (`lookupTicker`), `src/worker/lib/instruments.ts:4` (`InstrumentRow`)
- **Detail**: Phase 1 added `currency: string` to the shared `InstrumentRow` type (used by both `alerts.ts` and `instruments.ts`). `instruments.ts`'s `/:ticker/history` query was updated to select `currency`, but `alerts.ts`'s `lookupTicker()` still runs `SELECT ticker, rsi_eligible FROM instruments WHERE ticker = ?` — the `currency` column is never selected there. TypeScript happily types the result as `InstrumentRow` (so `instrument.currency` reads as `string`), but at runtime it's `undefined`. Currently harmless: nothing in `alerts.ts` reads `.currency` off `lookupTicker`'s result — the `currency` value actually returned to clients comes from the separate `ALERT_SELECT` join. But the shared type's contract is silently violated at this call site, and a future edit that adds a `.currency` read there would get `undefined` while the compiler insists it's a `string`.
- **Fix**: Add `currency` to `lookupTicker`'s `SELECT` (`SELECT ticker, rsi_eligible, currency FROM instruments WHERE ticker = ?`) so the shared `InstrumentRow` type is honest at both call sites — one-line change, no behavior change since the field still isn't read anywhere in `alerts.ts`.
- **Decision**: FIXED — `src/worker/routes/alerts.ts:19` now selects `currency`. Verified: `npm run typecheck` ✅, `npm run test:worker` (81/81) ✅.

## Notes

- Both sub-agent passes (Plan Drift Detection, Safety/Quality/Pattern Compliance) independently converged on this same single finding — no other drift, scope creep, or pattern mismatch identified across all 12 planned-change files.
- The two manually-discovered RSI-gating revisions (alert list: RSI threshold/Current RSI never gets a currency suffix; alert form: threshold suffix gated on `alertType !== 'RSI'`) were both verified as correctly implemented, including edge cases (switching alert type, switching ticker between RSI-eligible/ineligible instruments, empty initial ticker selection).
- Migration safety verified: `ALTER TABLE instruments ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'` is a metadata-only, non-breaking SQLite operation (NOT NULL + non-null constant DEFAULT is permitted without a table rewrite); confirmed locally that both `^VIX`/`^NDX` backfilled correctly.
- Automated verification re-run on final HEAD (`f3f7446`): `npm run typecheck` ✅, `npm run test:worker` (81/81) ✅, `npm run build` ✅.
- All manual verification items (alert list summary + detail, alert form, instrument history table) were confirmed by the user during Phase 2, including the RSI-currency-suffix correction.
