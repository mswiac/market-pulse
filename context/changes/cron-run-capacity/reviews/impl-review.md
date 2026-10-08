<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cron Run Capacity

- **Plan**: context/changes/cron-run-capacity/plan.md
- **Scope**: All phases (3 of 3)
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

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

### F1 — Duplicate emails when the post-send D1 write fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/alert-evaluation.ts (send, then single DB.batch)
- **Detail**: All emails of a run go out in one Resend request, then one `DB.batch()` records trigger_events and disarms. If that batch fails, every sent alert stays `armed = 1` with no event row, so the next run (or a concurrent admin `/cron/run`) re-sends all of them while the condition holds. Before this change the exposure window was one alert; now it is the whole run. A network error after Resend accepted the request (marked transient) has the same effect.
- **Fix A ⭐ Recommended**: Send with an `Idempotency-Key` header derived from the sorted alert ids and the UTC date.
  - Strength: no extra D1 query; also covers the network-error-after-accept case.
  - Tradeoff: relies on Resend's idempotency window (24 h) and on the key semantics for `/emails/batch`.
  - Confidence: MED — believed supported on the batch endpoint, not verified in this session.
  - Blind spot: Resend behaviour when the same key arrives with a different body.
- **Fix B**: Claim before sending: `UPDATE alerts SET armed = 0 WHERE id IN (...) AND armed = 1`, send only the claimed rows, restore `armed = 1` for transient failures.
  - Strength: also removes the cron-vs-admin race; works without relying on Resend.
  - Tradeoff: one extra D1 query and a restructure of the send/write order.
  - Confidence: HIGH — plain SQL semantics.
  - Blind spot: a crash between claim and send loses that notification (fails closed).
- **Decision**: FIXED via Fix A (Idempotency-Key = SHA-256 of the batch payload; Resend docs confirm the header on /emails/batch, 24h window)

### F2 — HTTP 429/408 from Resend treated as permanent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/resend.ts (`transient: response.status >= 500`)
- **Detail**: A 429 (rate limit) or 408 marks the chunk non-transient, so every alert in it is disarmed with a `failed` event and is never retried. Batching raises the blast radius from one notification to up to 100.
- **Fix**: `transient: response.status >= 500 || response.status === 429 || response.status === 408`, with a test for 429.
- **Decision**: FIXED (429 and 408 now transient; test added)

### F3 — New alerts compute their initial armed state from stale market_data

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts:131-150 (`computeArmed`)
- **Detail**: Instruments without an alert are no longer refreshed (user decision), so their `market_data` row ages. Creating the first alert on such an instrument computes `armed` from that old value: a stale price that already crosses the threshold starts the alert disarmed, and it then needs a 10% retreat before it can fire, even if the real price is just below the threshold. Previously `market_data` was refreshed daily for every instrument.
- **Fix A ⭐ Recommended**: Treat a `market_data` row older than the 12-hour freshness limit as missing (armed = 1), sharing one constant with alert evaluation.
  - Strength: tiny change; evaluation already skips stale rows, so a wrongly-armed alert cannot fire on old data.
  - Tradeoff: an alert whose condition is already true against fresh data fires at the first evaluation after the next fetch.
  - Confidence: HIGH — mirrors the "no row yet" branch already in `computeArmed`.
  - Blind spot: UI messaging for that first-run case is unchanged.
- **Fix B**: Fetch the instrument's data synchronously when an alert is created on a stale ticker.
  - Strength: exact initial state.
  - Tradeoff: adds a Yahoo call and failure mode to alert creation.
  - Confidence: MED — larger change in a user-facing route.
  - Blind spot: request-time subrequest budget on that route.
- **Decision**: FIXED via Fix B (alert create/edit refreshes market_data older than 12h or missing via refreshInstruments, single attempt; a failed refresh falls back to stored data)

### F4 — Little subrequest headroom on the admin full-run path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts (MAX_FETCH_ATTEMPTS_PER_RUN = 40), src/worker/routes/admin.ts
- **Detail**: The manual run executes both phases in one HTTP invocation, plus session and admin middleware queries. Worst case is about 46 queries from the pipeline plus 2-3 from middleware, close to the 50 limit; a second history chunk (more than 90 tickers) or more than 100 emails removes the margin. This assumes `DB.batch()` counts as one query, which the manual measurement (3.4) should settle.
- **Fix**: Lower the cap to about 36, or keep it and note in the constant's comment that the admin path has less headroom.
- **Decision**: ACCEPTED: resolved in #170, where fetch and evaluation become separate admin requests with their own budgets; no code change in this change

### F5 — One batch for all fetched tickers is all-or-nothing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts (single `env.DB.batch`)
- **Detail**: One bad row rolls back every ticker's write; all tickers report `error` and `market_data` ages until evaluation starts skipping alerts at 12 h. Safe (no false emails) but silent beyond logs. Accepted in the plan's approach.
- **Fix**: Accept, or on batch failure retry per ticker (costs subrequests, error path only).
- **Decision**: SKIPPED: covered by an admin failure notification, tracked in https://github.com/mswiac/market-pulse/issues/172; the bulk write stays all-or-nothing

### F6 — Missing test cases for new failure paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: test/worker/scheduled.test.ts
- **Detail**: No tests for: fetch-phase batch failure (all tickers `error`), `loadStoredCloses` failure fallback, an empty `closes` result, the IN split above 90 tickers, or `FETCH_CRON`/`EVALUATE_CRON` matching wrangler.toml.
- **Fix**: Add the first two and the wrangler.toml consistency test; the 90-ticker case only if cheap.
- **Decision**: FIXED (tests added: bulk-write rejection, history-read fallback, cron strings vs wrangler.toml; the >90-ticker IN split deliberately left untested)

### F7 — Plan drift: runEvaluationPhase not exported

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/worker/scheduled.ts (handleCron, handleScheduled)
- **Detail**: Plan Phase 3 names `runFetchPhase` and `runEvaluationPhase`; the latter does not exist, `evaluateAlerts` is called directly. Behaviour is identical. The infrastructure.md update was skipped on purpose (the file does not document the cron schedule). Extras not in the plan, all benign: `handleCron`, `FetchPhaseResult.loadError`, the history-read fallback, exported `chunk`.
- **Fix**: Add a short addendum to the plan noting the direct `evaluateAlerts` call.
- **Decision**: FIXED via plan addendum (## Review Addendum in plan.md)

### F8 — Manual rows 3.3 and 3.4 ticked without observable evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 3.3, 3.4
- **Detail**: Both are post-deploy checks (dashboard triggers, measured subrequests/CPU in the PR). No PR exists yet and nothing in the diff evidences them; they were ticked on the user's word.
- **Fix**: Record the measured numbers in the PR description when it is opened.
- **Decision**: SKIPPED: no change; measured subrequests/CPU to be recorded in the PR description when it is opened

### F9 — Cosmetic: log ordering, overwritten error, hand-synced cron strings

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/scheduled.ts
- **Detail**: The currency-correction log prints before the batch commits; the budget-exhausted error replaces the real last error in the summary; the cron strings are duplicated by hand from wrangler.toml (mismatch only yields a console.error). Resend batch validation is strict by default, so one invalid recipient would fail a whole chunk once a custom domain is verified (not reachable in the sandbox today).
- **Fix**: Move the log after the successful batch; keep the original error in the message; note the Resend strict-validation caveat next to the batch call.
- **Decision**: FIXED (currency-correction log after the write, last error kept when the attempt cap cuts a ticker off, Resend strict-validation note); cron strings already covered by the wrangler.toml consistency test

### F10 — RSI from stored history can include gaps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts (MIN_CLOSES_FOR_RSI = 15)
- **Detail**: A ticker with at least 15 stored closes but gaps older than the 7-day window (for example after a cron outage) gets an RSI over a gapped series, where the old code always used 30 dense days from Yahoo. Rare; the 15-close minimum also only just seeds RSI rather than stabilising it.
- **Fix**: Accept, or raise the threshold to about 20 stored closes so thin or gappy histories take the long-window path.
- **Decision**: FIXED differently (user's approach): alert create/edit refreshes with the full 30-day window, so RSI starts from a gap-free series; a cron outage longer than 7 days can still leave a gap in stored history and is accepted
