<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Adopt Angular i18n ($localize) to move Polish strings out of source code

- **Plan**: context/changes/i18n-migration/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-07-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

- Git scope: 4 commits (63dd425, 16dde04, 2e40fa1, 2a12304). `git diff --stat` against the pre-change tree shows exactly the 21 files the plan specified (config + 9 source files + 2 xlf files + change-folder docs + package-lock.json) — no unplanned files.
- Automated checks re-run at review time: `npm run typecheck` — pass. `grep -rn "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" src/app --include=*.html --include=*.ts` — no matches. `npm run build` — exits 0, produces `dist/market-pulse/browser/pl/index.html` with `<base href="/">`.
- Manual verification (Progress 1.5, 2.5-2.7, 3.3, 3.4): all confirmed by the user during this session, including a real production deploy (`https://marketpulse.gogitams.workers.dev`, version `840f60da`) and hands-on testing of alert creation, which surfaced and led to fixing an unrelated pre-existing gap (D1 migration `0005_create_alerts.sql` had never been applied to the remote database — applied during this session, tracked separately, not part of this plan's scope).
- Two sub-agent passes (plan-drift + safety/pattern) independently read all 21 changed source/config files in full against the plan's per-file contracts. No drift, no missing ids, no extra ids, no untranslated `messages.pl.xlf` entries, `VIX_RSI_ERROR` sentinel confirmed untouched and unaffected by localization.

## Findings

### F1 — Shared i18n id across two unrelated form errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-form/alert-form.html:27,39
- **Detail**: The threshold field's "required" `mat-error` and the notificationEmail field's "required" `mat-error` both use `i18n="@@alertForm.threshold.errorRequired"`. This was an explicit, deliberate choice in the plan ("`alertForm.threshold.errorRequired` is reused for both 'Field required.' occurrences") — implementation matches the plan exactly, so this is not drift. It's flagged because the plan's own choice breaks the "one id per semantic string" convention followed everywhere else in this change (12 other reused-id cases all reuse for the *same* semantic field, e.g. `alertList.detail.noData`). If the two fields' error wording ever needs to diverge, whoever edits `messages.pl.xlf` has to know this id secretly covers two unrelated fields, which the id's own name (`alertForm.threshold.*`) doesn't suggest.
- **Fix**: Split into a dedicated `alertForm.notificationEmail.errorRequired` id in `alert-form.html:39`, and add the matching (currently-identical) trans-unit to `messages.xlf` and `messages.pl.xlf`.
- **Decision**: FIXED
