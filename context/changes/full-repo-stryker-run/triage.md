# Full-repo Stryker run: results and survivor triage

Issue: #190 (follow-up to #187). Run date: 2026-10-09.

## How the runs were done

- **Worker**: `npx stryker run` (profile `stryker.config.json`, all of `src/worker`, 19 files, 1759 mutants). 17 min 22 s.
- **Angular**: `stryker.config.app.json` could not run unmodified on the whole of `src/app`. The Stryker-instrumented code fails Angular's AOT compile in the dry run (NG2012 on `imports: [...]`, NG1010 on decorator arguments, TS2322/TS2532 on narrowed template types). Workaround used for the baseline: a temporary copy of the profile with `mutator.excludedMutations: ["ArrayDeclaration", "ObjectLiteral"]` and `src/app/features/dashboard/dashboard.ts` excluded. 1089 mutants in 35 files, 91 min.
- **Not measured for Angular**: every `ArrayDeclaration` / `ObjectLiteral` mutant, and `dashboard.ts` entirely (it fails to compile under instrumentation even on its own, with those mutators off). Both are limits of the command-runner profile, not test findings.

## Worker scores

| File | Baseline | After new tests |
| --- | --- | --- |
| **All files** | **89.54%** (168 survived, 16 no coverage) | n/a (baseline only) |
| lib/admin.ts | 100.00 | n/a |
| lib/alert-evaluation.ts | 93.55 | 94.01 |
| lib/cron-failure-notice.ts | 77.78 | 96.30 |
| lib/email.ts | 100.00 | n/a |
| lib/instruments.ts | 77.78 | n/a |
| lib/market-data.ts | 97.01 | n/a |
| lib/market-refresh.ts | 79.84 | 86.82 |
| lib/password.ts | 96.49 | n/a |
| lib/price-history.ts | 100.00 | n/a |
| lib/resend.ts | 97.01 | n/a |
| lib/rsi.ts | 95.24 | n/a |
| lib/session.ts | 77.94 | 98.53 |
| routes/admin.ts | 85.26 | n/a |
| routes/alerts.ts | 94.94 | n/a |
| routes/auth.ts | 78.35 | 86.60 |
| routes/instruments.ts | 96.23 | n/a |
| routes/trigger-events.ts | 88.24 | n/a |
| index.ts | 84.62 | n/a |
| scheduled.ts | 91.04 | 97.01 |

The control run covered `scheduled.ts`, `cron-failure-notice.ts`, `session.ts`, `routes/auth.ts`, `alert-evaluation.ts` and `market-refresh.ts` (605 mutants, 92.23% total, 6 min 49 s).

## Angular scores (baseline)

Total 56.75% (595 killed, 23 timed out, 471 survived). The low total is dominated by files that have no spec at all:

| Group | Files | Score | Reading |
| --- | --- | --- | --- |
| No spec exists | `core/auth/*` (guards, `auth.service`, interceptor), `core/shell`, `cron-run.ts`, `alerts.service.ts`, `instruments.service.ts`, `dashboard.service.ts`, `instrument-history*`, `trigger-history*`, `home.ts`, `app.routes.ts`, `app.config.ts` | 0% | Not weak assertions: nothing exercises them. Belongs to the e2e work (#183 to #186), not to survivor triage. |
| Spec exists, gaps | `alert-list.ts` 48.31 (now 76.40), `add-instrument.ts` 73.12 (now 84.95), `instrument-picker.ts` 74.23 (now 96.91), `instrument-search.ts` 74.19 (now 93.55), `remove-instrument.ts` 85.53 (now 92.11), `admin-panel.ts` 85.00 (now 90.00), `alert-form.ts` 88.89 (now 97.04), `remove-user.ts` 92.41 (now 96.20), `login.ts` 85.71 (now 100), `register.ts` 84.00 (now 92.00) | | Triaged below. |
| Fine | `alert-filter.ts`, `dashboard-filter.ts` | 100% | |

Angular control runs (same temporary profile): `alert-list.ts`, `add-instrument.ts`, `remove-instrument.ts` (258 mutants, 23 min) gave 84.11% total; `instrument-picker.ts`, `instrument-search.ts`, `instrument-types.ts`, `alert-form.ts`, `remove-user.ts`, `admin-panel.ts`, `login.ts`, `register.ts` (467 mutants, 44 min) gave 94.86% total.

## Survivor decisions

Survivors are recorded per group, not per mutant: the full per-mutant list is in the HTML report (`reports/mutation/mutation.html`, gitignored) and the run output.

### Killed by new tests (this change)

| Area | Survivors | New test |
| --- | --- | --- |
| `scheduled.ts` notice builder | `emails.filter(status === 'failed')` removed, group join `', '`, `?? []` seed | A sent alert email is not listed as a problem in the notice; same-reason tickers are joined as `A, B: error`. |
| `cron-failure-notice.ts` | `omitted > 0` boundary, line join, `!result.ok` log | Exact notice text; 20 problems add no "more" line and log no error. |
| `alert-evaluation.ts` | stale limit `>` vs `>=` | Data exactly 12 h old is still evaluated. |
| `market-refresh.ts` | "budget exhausted" message variants, retry delay branch, sort before RSI | Exact budget message for a never-tried ticker; delays between attempts only; RSI over a fetch that fills a gap in stored history. |
| `session.ts` | cookie flags on clear, 401 bodies, cookie refresh on every authed request, renewal `>=` boundary | Auth and session tests (unknown session id clears the cookie, refresh re-issues 7-day cookie, http clear is not `Secure`, exact-threshold renewal). |
| `routes/auth.ts` | non-object / non-string password and email on login and register | Malformed JSON, missing and non-string fields return the generic message. |
| `alert-list.ts` | sorting, delete confirm flow, edit dialog, load error, detail rows | New `AlertList sorting`, `actions` and `details` specs. |
| `add-instrument.ts` | currency / suffix / RSI setters and form reset | Non-default payload submitted and reset to defaults. |
| `remove-instrument.ts` | load error and empty catalogue states | Two new specs. |
| `remove-user.ts`, `admin-panel.ts` | loading spinner, load error, empty list | New specs for each state. |
| `instrument-picker.ts` | type order, invalid hint conditions, touched / dirty, `writeValue(null)`, `displayWith`, full catalogue offered after a selection, typed text kept after an outside clear | Eight new specs. |
| `instrument-search.ts` | query trimming, prefix vs suffix, sorting within each ranking group | Two new specs. |
| `alert-form.ts` | non-numeric threshold, defaults without an alert, no signed-in user, pre-filled RSI range | Five new specs. |
| `login.ts`, `register.ts`, `instrument-types.ts` | empty initial values, creatable type list | One spec each. |

### Left, with reason

| Survivor | Reason |
| --- | --- |
| `console.error` / `console.warn` message text (`alert-evaluation.ts`, `market-refresh.ts`, `cron-failure-notice.ts`, `routes/*`) | Log text only; the user-visible outcome (notice, summary, status code) is asserted. |
| `routes/admin.ts` `error:` message strings (about 30) | The tests assert the machine-readable `code`; the UI maps codes to its own messages. |
| `scheduled.ts:19` `scope = ""` default | Equivalent: `scope === 'all'` is false for both `'alerts'` and `''`. |
| `alert-evaluation.ts:173` `firingValue === null` | Unreachable: a null RSI is already skipped by the `value === null` guard above. |
| `alert-evaluation.ts:193,232`, `market-refresh.ts:213` empty-batch guards | Equivalent in effect: an empty batch is a no-op. |
| `instruments.ts:26,41` empty `types` guard | Equivalent: `IN ()` returns no rows in SQLite. |
| `market-refresh.ts:154` `filter(rsi_eligible)` | Only changes which tickers have stored closes loaded; no observable difference. |
| `market-refresh.ts:174-180` empty-closes guard | Documented as unreachable in the source. |
| `auth.ts:23` dummy password hash literal, `session.ts:13` base64url argument | Timing-equalisation constant and id encoding; not observable through the API. |
| `auth.ts:64` non-UNIQUE database error rethrow | Needs an injected non-UNIQUE failure on the user insert; low value. |
| Optional chaining on `COUNT(*)` rows in `routes/admin.ts` | Equivalent: a `COUNT` query always returns a row. |
| `$localize` message literals in Angular components | Translation source text; the translated strings are checked by the i18n build. |
| `register.ts:33,50` clearing `emailError` and `markAsTouched` after a conflict | The visible state is driven by the `{ server: true }` error set in the same handler; not separable from it in a component test. |
| `alert-form.ts:50,120,149` (`optional: false`, number guard on blur, `instanceof HttpErrorResponse`) | Equivalent: the dialog always supplies data, `Number.isFinite` rejects non-numbers on its own, and a non-HTTP error falls through to the same generic message. |
| `remove-user.ts:48,64` initial `loading`, `id === null` guard | The id guard is unreachable (`canSubmit` already requires an id); the initial value is overwritten before first render. |
| `instrument-picker.ts:46,51,112`, `instrument-search.ts:6,20` | Equivalent: `toUpperCase` vs `toLowerCase` applied to both sides, a blank query handled by the empty-string path, and `shownTicker` seeds with no observable effect. |
| Angular `ArrayDeclaration` / `ObjectLiteral` / `dashboard.ts` | Not measurable with this profile (see above). |

### Still open

- Files with no spec at all (`core/auth/*`, `core/shell`, `cron-run.ts`, the `*.service.ts` files, `instrument-history*`, `trigger-history*`, `home.ts`, `app.routes.ts`, `app.config.ts`): not survivors but missing tests. They belong to the e2e work (#183 to #186).
