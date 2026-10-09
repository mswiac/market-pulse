<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cron Failure Email

- **Plan**: context/changes/cron-failure-email/plan.md
- **Scope**: Phases 1-2 of 2
- **Date**: 2026-10-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: `npm run test:worker` (346), `npm run test:ci` (155), typecheck and lint pass. Manual 2.7 (first real cron run after deploy) is intentionally open.

## Findings

### F1 — One root cause can produce two mails per day

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts:66-78, src/worker/lib/alert-evaluation.ts:187
- **Detail**: A ticker whose fetch failed at 16:30/23:00 UTC is also stale at the 23:15 evaluation, so the fetch mail and the evaluation mail report the same cause. A permanent failure (e.g. a delisted ticker with an alert) mails up to 2-3 times per weekday indefinitely.
- **Fix A ⭐ Recommended**: Keep both and document it in the README.
  - Strength: Stale-in-evaluation is the only signal when a fetch cron never fired at all, which the user explicitly asked to catch.
  - Tradeoff: Duplicate mails when the fetch itself already reported.
  - Confidence: HIGH — deliberate scope decision during planning.
  - Blind spot: Daily volume under a long outage is untested in practice.
- **Fix B**: Report stale tickers in evaluation only if the same run's fetch did not already report them.
  - Strength: One mail per cause.
  - Tradeoff: Needs state shared between invocations (D1), outside the minimal scope.
  - Confidence: LOW — invocations are independent.
  - Blind spot: None significant.
- **Decision**: ACCEPTED via Fix A (kept both mails; documented in README)

### F2 — Admin manual run now returns 207 for stale data, untested and undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/admin.ts:143-147, context/foundation/admin-panel-notes.md
- **Detail**: Stale tickers and load failures now land in `errors`, so `POST /cron/run` (evaluate) answers 207 instead of 200. Intended, but no admin test covers it and the notes only say the route sends no mail.
- **Fix**: Add an admin test (stale market data gives 207 with the ticker in `errors`) and one sentence in admin-panel-notes.md.
- **Decision**: FIXED (admin test for 207 on stale data; note in admin-panel-notes.md)

### F3 — Failed alert emails branch of the evaluation notice is untested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/scheduled.test.ts:816, src/worker/scheduled.ts:62
- **Detail**: The test "reports stale market data and failed alert emails" only asserts the stale part; the `emails.status === 'failed'` mapping has no test.
- **Fix**: Add a test where a firing alert's Resend send is rejected (e.g. 403) and assert the notice contains `alert <id> <ticker>: email failed:`; keep the stale test name accurate.
- **Decision**: FIXED (test for failed alert email in the evaluation notice)

### F4 — Notifier catch branch is not covered

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/cron-failure-notice.test.ts:63-75, src/worker/lib/cron-failure-notice.ts:28-30
- **Detail**: "request itself throws" passes through `postBatch`'s own catch (`result.ok === false`), not the notifier's `catch`. A missing `RESEND_VERIFIED_EMAIL` (TypeError in `sendAlertEmailBatch`) is the real case that branch exists for and is not tested.
- **Fix**: Add a test calling `notifyCronFailure({ ...env, RESEND_VERIFIED_EMAIL: undefined }, ...)` and assert it resolves and logs.
- **Decision**: FIXED (test for missing RESEND_VERIFIED_EMAIL)

### F5 — Unexpected-exception test depends on the first `Date.now()` call

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/scheduled.test.ts:849-861
- **Detail**: `mockImplementationOnce` on `Date.now` is consumed by whichever code calls it first, so a runtime or pool update could make this test pass or fail for the wrong reason. It also uses `vi.restoreAllMocks()` while the file otherwise restores per spy.
- **Fix**: Force the throw deterministically, e.g. make `env.DB.prepare` throw on a call that sits outside `evaluateAlerts`' own try/catch, and restore with `mockRestore()`.
- **Decision**: FIXED (deterministic throw via UPDATE alerts prepare)

### F6 — Problem text edge cases

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/scheduled.ts:36, 62, 64
- **Detail**: (a) `t.error` is optional in the type, so a missing value would print "TICKER: undefined"; (b) `runAndReport` uses `err.message` while the rest of the worker uses `String(err)`; (c) when the D1 batch fails, every ticker carries the same long error, giving up to 20 identical lines; (d) "email failed" can be wrong when the mail went out but the D1 write failed afterwards.
- **Fix**: Use `t.error ?? 'unknown error'`, `String(err)` in `runAndReport`, and collapse identical lines into one with a count.
- **Decision**: FIXED (unknown error fallback, String(err), grouped identical errors, dropped misleading "email failed" prefix)

### F7 — Plan wording drift (informational)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/worker/scheduled.ts:57-65
- **Detail**: Messages carry the prefixes `failed to load instruments:` and `email failed:`, not written in the plan. Behavior matches the plan's intent; no code change needed. A test for "no mail from the admin route" named in the plan is also absent (covered indirectly: `handleCron` is the only caller of the notifier).
- **Fix**: None required; accept.
- **Decision**: ACCEPTED (no change needed)
