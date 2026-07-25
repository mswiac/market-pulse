<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-04: Market Data Display Implementation Plan

- **Plan**: context/changes/market-data-display/plan.md
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE (SOUND after triage — all 4 findings fixed, see Decision fields)
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

8/8 paths ✓ (src/worker/routes/alerts.ts, src/worker/routes/instruments.ts, test/worker/alerts.test.ts, test/worker/instruments.test.ts, src/app/features/alerts/alerts.service.ts, src/app/features/alerts/alert-form/alert-form.ts, src/app/features/alerts/alert-list/alert-list.ts, src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts), 6/6 symbols ✓ (ALERT_ROW_COLUMNS, lookupTicker, INSTRUMENT_LABELS, showCurrentRsi, showRsiOption, rsi_eligible), brief↔plan ✓

## Findings

### F1 — Phase blocks use checkboxes, violating the Progress↔Phase mechanical contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Both Phase 1 and Phase 2 "Success Criteria" sections
- **Detail**: Every Automated/Manual Verification bullet inside both Phase blocks uses `- [ ]` checkboxes (e.g. "- [ ] Worker unit tests pass..."). The project's own convention (confirmed against the archived F-03 plan, which this plan cites as its structural precedent) reserves `- [ ]`/`- [x]` exclusively for the `## Progress` section at the bottom — Phase blocks must use plain `- ` bullets. This plan has both: the correct plain-bullet form in `## Progress`, and a duplicate checkbox form inside the Phase blocks themselves.
- **Fix**: Strip the `[ ]` from every bullet under "Success Criteria" in both Phase 1 and Phase 2, converting them to plain `- ` bullets. Leave the `## Progress` section's checkboxes untouched.
- **Decision**: FIXED — all Success Criteria bullets in both Phase blocks converted to plain `- ` bullets; `## Progress` left unchanged.

### F2 — No error handling for the alert form's new async instrument fetch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 — Alert form: type→instrument cascade
- **Detail**: Today, `alert-form.ts`'s instrument options are a static array — they can't fail to load. After this change, `instrumentTypes`/`instrumentOptions` come from `InstrumentsService.list()` calls that can reject (network blip, session expiry mid-form). The plan documents the *ordering* risk (constructor must eagerly trigger the type-filtered fetch) but never says what happens if that fetch fails: both selects would silently render empty, with no error shown and no way to retry short of closing and reopening the dialog. `alert-list.ts` already has a `loadError` signal for exactly this class of failure on its own `list()` call — the form has no equivalent.
- **Fix A ⭐ Recommended**: Add a `loadError` signal to `alert-form.ts`, mirroring `alert-list.ts`'s pattern
  - Strength: Reuses an established, already-reviewed error-display pattern from the same feature area; user gets a visible signal instead of two empty dropdowns.
  - Tradeoff: One more signal + a small template block in a form that's already gaining meaningful complexity.
  - Confidence: HIGH — direct precedent exists one file away.
  - Blind spot: Whether to also offer a retry action, or just show the message (existing `loadError` in alert-list.ts has no retry either — likely fine to match that).
- **Fix B**: Accept silent-empty-selects as an acceptable edge case
  - Strength: Zero additional code; the endpoint is same-origin and session-gated, so failures should be rare.
  - Tradeoff: A user hitting this mid-session sees a dead-looking form with no explanation — harder to diagnose in support.
  - Confidence: MED — rarity is a reasonable bet, but unverified.
  - Blind spot: Session-expiry timing relative to dialog-open isn't analyzed.
- **Decision**: FIXED via Fix A — plan's Phase 2 §3 now adds a `loadError` signal to `alert-form.ts` (mirroring `alert-list.ts`), and §4/Manual Verification updated to show/verify the error state.

### F3 — New service introduces the first stateless (non-signal-cache) pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §2 — New instruments service
- **Detail**: Both existing Angular services in this codebase (`auth.service.ts`, `alerts.service.ts`) hold a `signal`-based cache and expose it as read-only app state. The plan's new `InstrumentsService` is a bare `http.get` wrapper with no signal — a deliberate, justified choice ("2 rows, no other consumer yet"), but it's a new pattern in an area where only one pattern has existed so far. A future consumer (S-07's history view) may copy whichever shape it finds first without knowing this one was a conscious exception.
- **Fix**: Add a one-line comment in `instruments.service.ts` explaining why it deliberately skips the signal-cache pattern the other two services use, so a future reader doesn't treat the omission as an oversight to "fix."
- **Decision**: FIXED — upgraded during triage from "add a comment" to an actual signal-cache implementation: `InstrumentsService` now fetches the full registry once (`ensureLoaded()`), caches it in a signal, and exposes a `computed()` of distinct types; the alert form filters by type via its own `computed()` over the cached signal instead of a per-type-change fetch. This also reverses the plan's earlier "re-fetch `?type=` on type change" decision (see plan-brief.md).

### F4 — POST/PUT's insert-then-reselect isn't atomic

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — Alerts route: joined response shape
- **Detail**: `INSERT/UPDATE ... RETURNING id` and the follow-up joined `SELECT` are two sequential awaited calls, not a single atomic operation. If the write succeeds but the re-select throws, the client receives an error even though the alert was actually created/updated — self-healing on the next `GET /api/alerts`, not data loss, but worth knowing this is expected behavior rather than a bug if it's ever reported.
- **Fix**: None needed — just worth a one-line code comment near `fetchAlertById` noting the two calls are sequential, not transactional, so a future reader doesn't "fix" it by trying to wrap them in something D1 doesn't support anyway.
- **Decision**: FIXED — upgraded during triage from "document the gap" to actually closing it: `POST`/`PUT` now use `env.DB.batch([writeStmt, selectStmt])` (the same primitive `scheduled.ts` already uses), which D1 executes as a single atomic unit. Both statements bind values known ahead of time (request body / path param), so no `RETURNING id` → separate re-select round trip is needed at all. The `fetchAlertById` helper originally proposed for the re-select is no longer needed.
