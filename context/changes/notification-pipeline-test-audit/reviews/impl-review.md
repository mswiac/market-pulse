<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Notification/Evaluation Pipeline Regression Audit

- **Plan**: context/changes/notification-pipeline-test-audit/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-08-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

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

### F1 — 5xx/429 Resend responses are never tagged `transient`, so they permanently disarm the alert

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/resend.ts:41-51
- **Detail**: The `transient` discriminator only fires from the `catch` block around the raw `fetch()` call (network/DNS/timeout, resend.ts:24-39). A *resolved* but failing HTTP response — including a Resend-side 5xx (upstream outage) or 429 (rate limit), both textbook retryable conditions — falls through to `return { ok: false, error: message }` at resend.ts:50 with no `transient` flag. Downstream, `alert-evaluation.ts:137`'s `isTransientFailure` check treats that as permanent and pushes `UPDATE alerts SET armed = 0`, permanently disarming the alert on what is plausibly a temporary Resend-side blip — the same "missed notification" failure mode risk #2 names as a core product failure. This was an explicit, in-scope plan decision (the plan's Contract for resend.ts states the non-ok-response path "is unchanged and never sets `transient`"), not implementation drift — but it means risk #2 is only partially closed: a network-level throw now retries safely, while a server-side error response from Resend itself still doesn't.
- **Fix A ⭐ Recommended**: Extend `transient: true` to the non-ok branch when `response.status >= 500`, parallel to the existing fetch-throw case.
  - Strength: Closes the gap this phase's design intent was aiming for (retry-worthy failures shouldn't permanently disarm) without reopening the "no retry loop" scope decision — it's a small additive branch plus one new resend.test.ts case (assert `transient: true` for a 502/503 response).
  - Tradeoff: 429 (rate limit) is arguably also transient but is client-side throttling rather than a server failure — needs a separate decision on whether to fold it in too, and status-code-based heuristics are inherently approximate (e.g. some APIs return non-retryable 5xx for permanent misconfiguration).
  - Confidence: HIGH — same pattern already established by the fetch-throw case in the same file, same result shape, no new architecture.
  - Blind spot: Resend's actual retry semantics for specific 5xx codes aren't documented locally — this assumes standard HTTP server-error-is-often-transient semantics rather than Resend-specific guidance.
- **Fix B**: Leave as-is; record this as a known, named limitation (e.g. a one-line addition to test-plan.md's risk #2 Risk Response Guidance row) rather than changing code.
  - Strength: Keeps this phase's diff exactly as planned and reviewed; zero additional code risk.
  - Tradeoff: Risk #2 ("missed notification is core product failure") stays partially open for the 5xx/429 case, and nothing in the shipped plan or test-plan.md currently names this as a remaining gap — a future reader could mistakenly believe risk #2 is fully closed.
  - Confidence: MEDIUM — correct as a minimal-diff choice, but leaves a real (if narrow) product-reliability gap undocumented.
  - Blind spot: How often Resend actually returns 5xx/429 in practice is unmeasured — could be a very low-probability event not worth the code change at all.
- **Decision**: FIXED (Fix A) — `resend.ts:50` now sets `transient: response.status >= 500`; `resend.test.ts`'s 422 and 502 cases updated to assert `transient: false`/`transient: true` respectively (429 left as future work, not folded in). `npm run typecheck` and `npm run test:worker` (191/191) both pass after the change.

### F2 — test-plan.md §6.3 undercounts resend.test.ts's cases ("four" vs actual five)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:170
- **Detail**: The newly-written §6.3 cookbook text says "See `test/worker/resend.test.ts` for all four cases against Resend," but the file has five cases — the unverified-recipient scenario (a real, distinct outcome with its own test at resend.test.ts:32-40) isn't enumerated or counted. Documentation-only; no shipped code or test is affected.
- **Fix**: Update the count to "five" and briefly mention the unverified-recipient case alongside the other four in the §6.3 prose.
- **Decision**: FIXED — test-plan.md §6.3 now names the pre-flight-rejection case explicitly, notes the transient-vs-permanent status-code distinction (added by F1's fix), and says "five cases."

## Notes

Two parallel sub-agents reviewed this change: one traced every planned change (resend.ts, alert-evaluation.ts, all three test files, test-plan.md §3/§6.1/§6.3) against the plan's stated Intent/Contract and confirmed MATCH on every item — the transient/permanent disarm boolean logic is exactly as specified, all planned test cases exist with correct assertions, and no unplanned files or scope creep were found anywhere in the diff. The second sub-agent scanned for security/performance/reliability/data-safety issues and compared pattern conventions against `market-data.ts` and its sibling test files; it independently surfaced the F1 gap above, confirmed the resend.ts↔alert-evaluation.ts error-handling divergence from market-data.ts's convention is justified (not a defect — `sendAlertEmail` needs a structured result to write `email_status`/`email_error` and decide disarm, which a bare throw can't provide), confirmed the new `describe('buildEmail')` block doesn't pollute the D1-backed `describe('evaluateAlerts')` block in the same file, and confirmed exporting `buildEmail` while `AlertEvalRow` stays unexported causes no typecheck/build issue (`tsc -p tsconfig.worker.json --noEmit` clean; no `.d.ts` output in this project's build). Automated verification was independently re-run in the main review context: `npm run typecheck` and `npm run test:worker` (191/191 tests, 13 files) both pass.
