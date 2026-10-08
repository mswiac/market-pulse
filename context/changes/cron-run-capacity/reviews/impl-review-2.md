<!-- IMPL-REVIEW-REPORT -->
# Implementation Review (second pass): Cron Run Capacity

- **Plan**: context/changes/cron-run-capacity/plan.md
- **Scope**: Whole change, focused on commit 5d92797 (fixes after the first review). First review: reviews/impl-review.md (F1-F10, all triaged).
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks on the committed state: typecheck, lint, 321 worker tests and `npm run build` all pass. The drift agent reported no DRIFT or MISSING; its claim that no test covers the 30-day window on the alerts route was checked and is wrong (test/worker/alerts.test.ts asserts a 31-day period range).

## Findings

### F1 — An on-demand refresh can defeat the evaluation freshness guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts:130-140, src/worker/lib/alert-evaluation.ts:155-160
- **Detail**: The on-demand refresh uses the same upsert as the cron, so it stamps `market_data.updated_at = now`. While a market is open, Yahoo returns the partial intraday bar, which is stored as price/high/low/rsi. If the nightly fetch then fails for that ticker, the evaluation 15 minutes later sees a row under 12 h old and evaluates it: an email titled "close" carries an intraday value and the alert is disarmed. Before the on-demand refresh existed, that row would have been over 24 h old and skipped.
- **Fix A ⭐ Recommended**: Rows written by the on-demand path are stamped as non-final (`updated_at = 0` for a new row, unchanged for an existing one), so evaluation always skips them until a cron fetch overwrites them.
  - Strength: closes the hole at the source; the cron stays the only writer of "final" timestamps.
  - Tradeoff: `ensureFreshMarketData` then refetches on every create/edit for a ticker that has no cron-written row yet (bounded by F2's timeout).
  - Confidence: MED — needs an option on `refreshInstruments` and a test for both row states.
  - Blind spot: UI shows a "current" price whose stored timestamp is old; nothing displays `updated_at` today.
- **Fix B**: Accept and document: it needs an intraday on-demand refresh, then a failed nightly fetch for that ticker, then evaluation within 12 h.
  - Strength: no code change.
  - Tradeoff: a wrong "close" email is possible in that corner.
  - Confidence: HIGH — the sequence is narrow.
  - Blind spot: Yahoo outages are exactly when the cron fails.
- **Decision**: ACCEPTED: needs a stale ticker, an alert created during the session and a failed nightly fetch; documented as a known limitation in the plan's Review Addendum

### F2 — A failing ticker makes every create/edit call Yahoo, and the call has no timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts:130-140, src/worker/lib/market-data.ts:51
- **Detail**: The 12 h check protects only the success path. If the fetch fails, nothing is written, so every POST and PUT for that ticker retries Yahoo, and any authenticated user can repeat it. The Yahoo `fetch` has no timeout, so a hanging Yahoo holds the user's alert-saving request until the runtime cuts it off; saving is "not blocked on error", not "never blocked".
- **Fix**: Add an optional timeout (about 4 s via `AbortSignal.timeout`) threaded through `refreshInstruments` to `fetchDailyCloses`, used only by the on-demand path. Skip a negative cache.
  - Strength: bounds the latency a user can see; small change.
  - Tradeoff: repeated Yahoo calls for a permanently failing ticker remain (authenticated, bounded per request).
  - Confidence: HIGH — standard pattern.
  - Blind spot: timeout aborts the in-flight request but not a Yahoo-side rate-limit counter.
- **Decision**: FIXED (on-demand refresh passes a 4s AbortSignal timeout through refreshInstruments to fetchDailyCloses; repeated Yahoo calls for a permanently failing ticker accepted; tests added)

### F3 — PUT refreshes before it knows the alert exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts (PUT, `ensureFreshMarketData` before the UPDATE)
- **Detail**: `PUT /alerts/999999` with a valid body makes a Yahoo call and a D1 write before returning 404, because the ownership check happens only inside the later batch. POST ending in a 409 duplicate has the same cost.
- **Fix**: In PUT, check that the alert exists for this user with a cheap SELECT before refreshing; leave the POST duplicate case.
- **Decision**: FIXED (PUT checks that the alert exists for the user before refreshing market data; test added; the POST duplicate case left as is)

### F4 — Concurrent first creates for one stale ticker fetch twice

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts:130-140
- **Detail**: Two simultaneous requests both pass the freshness check and both call Yahoo. The writes are idempotent upserts, so nothing is corrupted.
- **Fix**: Accept.
- **Decision**: SKIPPED: accepted; the duplicate fetch is idempotent and bounded by the 12h check

### F5 — Plan addendum misses the `fullWindow` option and the PUT ordering

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/cron-run-capacity/plan.md (Review Addendum)
- **Detail**: `refreshInstruments` gained a `fullWindow` option (30-day window, skips stored history) that is only recorded indirectly in the first review.
- **Fix**: Add one sentence about `fullWindow` to the addendum (and the F1/F2/F3 outcomes once decided).
- **Decision**: FIXED (Review Addendum now covers fullWindow, the 4s timeout and the PUT ordering)

### F6 — A route depends on the cron module

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/worker/routes/alerts.ts:7
- **Detail**: `routes/alerts.ts` imports `refreshInstruments` from `scheduled.ts`. There is no runtime cycle (the other imports of `Env` are type-only), but a route depending on the cron entry module is odd coupling; moving the function to `lib/` next to `market-data.ts` would remove it.
- **Fix**: Optional: move `refreshInstruments` (and its helpers) to `src/worker/lib/`.
- **Decision**: FIXED (refreshInstruments and its helpers moved to src/worker/lib/market-refresh.ts; scheduled.ts keeps routing, runFetchPhase and handleScheduled; routes/alerts.ts no longer imports the cron module)

### F7 — Resend 409 for a concurrent identical request is treated as permanent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/resend.ts (transient classification)
- **Detail**: With an Idempotency-Key, Resend answers 409 when an identical request is still in flight. The code marks 409 as non-transient, so those alerts would be disarmed as failed. The scenario needs two overlapping evaluations of the same batch and is extremely rare. Wrongful duplicate suppression by the key itself is not a realistic risk: the email text carries the UTC date and the values.
- **Fix**: Accept, or add 409 to the transient statuses.
- **Decision**: FIXED (409 added to the transient statuses; the key is a payload hash, so the same-key-different-payload variant cannot occur; test extended)
