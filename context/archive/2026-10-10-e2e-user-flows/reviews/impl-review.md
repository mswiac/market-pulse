<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E User Flows

- **Plan**: context/changes/e2e-user-flows/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run during review: full Playwright suite `42 passed`; `prettier --check` clean on all new files (3 older specs were already unformatted on main).

## Findings

### F1 — Float arithmetic can make the edit test flaky

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/alerts-edit.spec.ts:30
- **Detail**: `newThreshold = oldThreshold + 0.5` is floating-point arithmetic. For 72 of the 89,000 possible `uniqueThreshold()` values the sum is not a clean 2-decimal number (e.g. 12.840000000000002), so the exact `toBe(newThreshold)` check against the stored value would fail although the app is correct (about 0.08% of runs).
- **Fix**: `const newThreshold = Number((oldThreshold + 0.5).toFixed(2));`
- **Decision**: FIXED — rounded newThreshold with toFixed(2).

### F2 — "No POST sent" assertions are vacuous

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/alerts-validation.spec.ts (empty, zero and RSI cases)
- **Detail**: None of the three client-side tests clicks "Utwórz alert". The button is disabled, so `posts` is empty by construction and `expect(posts).toHaveLength(0)` can never fail. The `toBeDisabled()` check alone does not prove the invalid threshold is the cause (another invalid control would also disable it).
- **Fix A ⭐ Recommended**: Drop the `posts` bookkeeping and assert the threshold control itself is invalid (`aria-invalid="true"`) next to the disabled button.
  - Strength: Every remaining assertion can fail; ties the disabled state to the tested field.
  - Tradeoff: Loses the explicit "nothing sent" wording.
  - Confidence: HIGH — Material sets aria-invalid on touched invalid inputs.
  - Blind spot: Not yet confirmed that the pl build exposes aria-invalid on the spinbutton.
- **Fix B**: Keep `posts` and add a forced click (`click({ force: true })`) before asserting zero POSTs.
  - Strength: Proves the guard even if the disabled binding regressed.
  - Tradeoff: A forced click on a disabled control is unusual and may be flagged as brittle.
  - Confidence: MED — depends on how Angular handles form submit when invalid.
  - Blind spot: ngSubmit guard (`form.invalid`) behaviour not checked in a browser.
- **Decision**: FIXED via Fix A (variant) — dropped the vacuous POST bookkeeping; each client-side test now asserts toHaveAccessibleDescription(message) on the threshold control. aria-invalid was tried first but Material does not set it for the empty-field case.

### F3 — Threshold locator matches substrings

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/alerts-api.ts (`thresholdPattern`), used in e2e/alerts-edit.spec.ts and e2e/alerts-validation.spec.ts
- **Detail**: The pattern is not anchored, so `55.50` also matches `155.50` and any price in the button name. `toHaveCount(0)` (old value gone) and `toHaveCount(1)` (no second row) can fail on an unrelated alert, and a click on the panel could hit strict mode. Collisions are rare (~1e-5 per pair) but the edit test already needs an API check to work around the same weakness.
- **Fix**: Anchor the number with lookarounds that forbid adjacent digits, separators and no-break spaces: `(?<![\d., ])…(?!\d)`.
- **Decision**: FIXED — thresholdPattern anchored with lookarounds.

### F4 — Account-flow test 3 does not prove "not logged in"; password label not exact

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/account-flow.spec.ts (test 3, `submitCredentials`)
- **Detail**: Test 3 is titled "does not log in" but only checks the message and `/register`; test 2 also asserts no dashboard heading. `getByLabel('Hasło')` is not `exact`, so a future "Powtórz hasło" field would break strict mode.
- **Fix**: Add `expect(page.getByRole('heading', { name: 'Pulpit' })).toHaveCount(0)` to test 3 and use `{ exact: true }` for the password label.
- **Decision**: FIXED — test 3 asserts no dashboard heading; password label is exact.

### F5 — Minor plan drift and manual Progress rows without durable evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/e2e-user-flows/plan.md (Phase 1 contract, Progress rows 1.4, 1.5, 2.3, 3.3)
- **Detail**: `createAlert` takes `(request, threshold, alertType)` with a fixed ticker instead of the planned `{ ticker, alertType, threshold }`, and `alerts-api.ts` adds `uniqueThreshold` / `thresholdPattern`; same intent, no behaviour impact. Manual rows are ticked, but their evidence (deliberate breaks, empty local D1) lives only in the session transcript, not in the repo.
- **Fix**: Leave as is; optionally note the signature in the plan.
- **Decision**: SKIPPED — left as is (cosmetic).

## Dismissed after verification

- Claim that the price row in `alerts-current-value.spec.ts` is not asserted: false, the `E2E-PRICE ... 123,45 USD` assertion exists.
- Claim that "Pole wymagane." can come from another field: only touched controls show errors and only the threshold is touched in that test.
- Local data dependency on `^NDX` / NASDAQ-100: accepted, matches the existing specs.
