---
date: 2026-08-25T00:54:15+02:00
researcher: Claude Code
git_commit: 07bef807fa741107e5303433e9b70ba019c3fa16
branch: test/stryker-session-auth-triage
repository: mswiac/market-pulse
topic: "Ground test-plan.md refresh: PR #91 mutation-testing sweep + new Risk #8 (admin panel zero component coverage)"
tags: [research, codebase, test-plan, mutation-testing, stryker, angular, admin-panel, component-tests]
status: complete
last_updated: 2026-08-25
last_updated_by: Claude Code
---

# Research: Ground test-plan.md refresh — mutation-testing sweep + admin panel coverage gap

**Date**: 2026-08-25T00:54:15+02:00
**Researcher**: Claude Code
**Git Commit**: [07bef80](https://github.com/mswiac/market-pulse/blob/07bef807fa741107e5303433e9b70ba019c3fa16)
**Branch**: test/stryker-session-auth-triage
**Repository**: mswiac/market-pulse

## Research Question

`context/foundation/test-plan.md` was last refreshed 2026-08-22 (3 days ago) and all four proposed rollout phases have since shipped. Two things have changed since then that the doc doesn't yet reflect:

1. A full-repo Stryker mutation-testing triage (PR #91, commits `8a2884f`..`07bef80`, 2026-08-24/25) closed coverage gaps across all of `src/worker/**` — test-only, no production code changed, done directly with no `context/changes/`/`context/archive/` folder.
2. A new risk surfaced in user interview: the admin panel (Angular, `src/app/features/admin/`) has **zero** component-test coverage despite handling destructive, irreversible actions (instrument/user removal) and non-trivial form logic (type→suffix mapping).

This research grounds both: (a) exactly what PR #91 tested, to correctly document it in §4/§7/§8 without changing the risk map, and (b) exact file:line evidence for a new Risk #8 (admin panel), including DI points, dialog flow, and payload shapes — the concrete inputs a future rollout phase (§3 Phase 5) needs to write component tests.

## Summary

**PR #91** is confirmed test-only: 6 commits (`8a2884f`..`07bef80`), ~823 lines added across 12 `test/worker/*.test.ts` files, zero `src/` production lines touched. It closed named mutation survivors in session/auth boundary logic, cron date-arithmetic, email normalization, malformed-response handling, down-direction alert firing, and several D1/error-propagation edge cases. `stryker.config.json`'s `mutate` glob (`src/worker/**/*.ts`) is unchanged — scope was already `src/worker/**`, this sweep just raised the score within that scope. No risk-map delta: this is coverage-hardening of already-identified risks (#1, #2, #6), not a new risk.

**Risk #8 (admin panel) is real and precisely as described in the change notes**, with two corrections from the notes' own framing:
- The 6-component list from the change notes is exactly right (verified against `find src/app/features/admin -type f`): `admin-panel`, `add-instrument`, `remove-instrument`, `remove-instrument-confirm`, `remove-user`, `remove-user-confirm`. Zero `.spec.ts` files exist for any of them — confirmed via `find src/app -name "*.spec.ts"`, which returns only `alert-form.spec.ts` and `register.spec.ts`.
- **Correction**: none of the 6 admin components use `FormGroup`/`FormControl` — all are Angular-signal-based (`signal`/`computed`), so §6.5's "drive the FormGroup directly" cookbook pattern does not transfer as-is; a Phase 5 plan needs a signal-driven variant instead (see Architecture Insights).
- **Correction**: `add-instrument.ts` has no *currency* validation gap as the change notes speculated — `currency` always has a default from a fixed 3-value list and is never truly empty via the UI. The real untested logic there is the **type→suffix mapping** (`.WA` auto-fill for `pl_stock`, only on type change, not overwriting manual edits) and ticker-uppercasing-on-blur.
- The two `*-confirm` dialog components don't inject `MatDialogRef` in their component class at all — confirm/cancel wiring is template-only via `mat-dialog-close` directives, which still require a `MatDialogRef` stub in tests (the directive injects it internally). `remove-instrument.ts`/`remove-user.ts` inject `MatDialog` (non-optional) to *open* those dialogs — a distinct DI point from `MatDialogRef`.
- `frontend-test-bootstrap` (§3 Phase 3, shipped) explicitly scoped admin panel **out**, reasoning it was "required-only" validation like Login — this research shows that framing undersold the actual complexity (type→suffix mapping, a two-step impact-preview→confirm→delete flow, non-optional `MatDialog` injection).

## Detailed Findings

### PR #91 — Mutation-testing sweep (grounds §4, §7, §8; no risk-map change)

All 6 commits are test-only, tagged `Refs #91`/`(#91)`, dated 2026-08-24/25, no accompanying `context/changes/` or `context/archive/` folder (done directly on this branch):

| Commit | Test files touched | Lines added | Gap closed |
|---|---|---|---|
| `8a2884f` test(session-auth) | `test/worker/auth.test.ts`, `test/worker/session.test.ts` (new) | 160 | Session expiry/renewal boundaries (inclusive now-boundary, sliding-renewal thresholds), Set-Cookie security attributes (HttpOnly/Secure/SameSite/Max-Age), auth input-length boundaries |
| `7ba9389` test(scheduled-admin) | `test/worker/admin.test.ts`, `test/worker/scheduled.test.ts` | 167 | Cron's 30-day lookback date arithmetic, 3-retry budget; `admin.ts` zero-coverage branches (`ticker_required`, `invalid_dates`, currency-regex bypass) |
| `c5da6af` test(index-email) | `test/worker/email.test.ts`, `test/worker/index.test.ts` | 45 | `normalizeEmail` type-guard/trim/whitespace-only cases, `EMAIL_PATTERN` anchor edges, `GET /api/health` smoke test |
| `5a56027` test(market-data-password) | `test/worker/market-data.test.ts`, `test/worker/password.test.ts` | ~99 | Malformed Yahoo response shapes (previously crashed raw instead of throwing `MarketDataFetchError`); malformed stored-hash edge cases in `verifyPassword` |
| `9a3465a` test(alert-evaluation) | `test/worker/alert-evaluation.test.ts` | 161 | Down-direction firing/re-arm (previously only "up" tested), inclusive-threshold boundaries both directions, RSI-vs-price-fallback regression guard |
| `07bef80` test(alerts-trigger-events-admin-resend-rsi) | `admin-lib.test.ts`, `admin.test.ts`, `alerts.test.ts`, `resend.test.ts`, `rsi.test.ts`, `trigger-events.test.ts` | 191 | Wrong-type guards + inclusive thresholds in `alerts.ts`, D1 non-UNIQUE error propagation, `limit=0` pagination, `isAdminEmail` trimming, Resend request-shape/retry-boundary assertions, RSI flat-series (`0/0→100`, not `NaN`) |

**Totals**: 6 commits, 12 distinct `test/worker/*.test.ts` files (`admin.test.ts` touched twice), ~823 lines of test code added, 0 production lines changed.

`stryker.config.json` (repo root) — unchanged by this sweep, confirms scope:
```json
{
  "mutate": ["src/worker/**/*.ts"],
  "thresholds": { "high": 80, "low": 60, "break": null },
  "vitest": { "related": false }
}
```
`src/app/**` (Angular) is not and has never been in mutation-testing scope. There is no dedicated `npm run stryker` script — it's invoked directly via `npx stryker run` (optionally narrowed with `--mutate`), matching `CLAUDE.md`'s documented guidance (already present, no update needed there).

### Risk #8 — Admin panel component-test gap, per component

All 6 files confirmed via `find src/app/features/admin -type f`; zero `.spec.ts` files exist (`find src/app -name "*.spec.ts"` → only `alert-form.spec.ts`, `register.spec.ts`).

**1. `admin-panel.ts` + `admin-panel.service.ts`** (container — manual market-data backfill form)
- Injects `InstrumentsService` (`admin-panel.ts:46`), `AdminService` (`:47`), `MatSnackBar` (`:48`) — no dialog.
- Signal-based, no `FormGroup`: `selectedInstrumentType`, `selectedTicker`, `fromDate`, `toDate`, `submitting`, `loadError` (`:53-67`); `canSubmit` computed guard (`:69-71`) — no `mat-error`/touched-state validation UI.
- Constructor: `instrumentsService.ensureLoaded()` → picks first type, calls `onTypeChange` (`:73-81`); error → `loadError` renders an error block (`admin-panel.html:4-7`).
- Payload: `POST /api/admin/market-data` `{ ticker, from, to }` (ISO date strings) (`:112`, `admin-panel.service.ts:55-57`).
- Error-code map: `ticker_required, invalid_dates, invalid_range_order, future_to_date, range_too_large, unknown_instrument, fetch_failed, write_failed, forbidden` (`:24-34`).

**2. `add-instrument/add-instrument.ts`**
- Injects `InstrumentsService` (`:47`), `AdminService` (`:48`), `MatSnackBar` (`:49`) — no dialog, no `ActivatedRoute`.
- Signal-based: `type`, `ticker`, `name`, `currency` (default from fixed 3-value list `['EUR','PLN','USD']`), `rsiEligible` (default `true`), `suffix`, `submitting` (`:53-59`). `canSubmit` = ticker+name trimmed non-empty AND not submitting (`:61`) — no explicit currency guard (can't be empty via UI regardless).
- **Type→suffix mapping**: `SUFFIX_DEFAULTS = { pl_stock: '.WA' }` (`:19-21`); `onTypeChange` sets suffix only on type change, doesn't fight manual edits (`:67-72`). `CREATABLE_INSTRUMENT_TYPES = ['index', 'pl_stock', 'us_stock']` (`src/app/features/instruments/instrument-types.ts:6`).
- Ticker uppercasing on blur mutates DOM input value + signal together (`:81-86`) — needs `fireEvent.blur` in a test.
- On success: `resetForm()` (`:125-132`), `instrumentsService.reload().subscribe()` (`:115`), success snackbar.
- Payload: `POST /api/admin/instruments` `{ type, ticker, name, currency, rsiEligible, suffix }` (trimmed) (`:109-110`, `admin-panel.service.ts:59-68`).
- Error codes: `forbidden, invalid_body, instrument_type_invalid, instrument_ticker_required, instrument_name_required, instrument_currency_invalid, instrument_rsi_eligible_invalid, instrument_duplicate_ticker` (`:26-35`).

**3. `remove-instrument/remove-instrument.ts`**
- Injects `InstrumentsService` (`:32`), `AdminService` (`:33`), `MatSnackBar` (`:34`), **`MatDialog`, non-optional** (`:35`).
- Signal-based; `canSubmit` = ticker selected AND not submitting (`:53`).
- **Confirm-dialog flow**: `onSubmit()` (`:76-89`) → `adminService.getInstrumentImpact(ticker)` (GET, pre-confirmation) → `openConfirmDialog(ticker, alertsCount)` (`:91-104`) opens `RemoveInstrumentConfirm` with `data: { ticker, alertsCount }` → `.afterClosed().subscribe(confirmed => ...)`: confirmed → `removeInstrument(ticker)`; else → `submitting.set(false)`, no service call.
- Payloads: impact `GET /api/admin/instruments/{ticker}/impact`, delete `DELETE /api/admin/instruments/{ticker}` (`admin-panel.service.ts:70-76`).
- Error codes: `forbidden, unknown_instrument` (`:17-20`).

**3b. `remove-instrument-confirm/remove-instrument-confirm.ts`** (dialog content)
- Only injects `MAT_DIALOG_DATA` (`:16`) — **no `MatDialogRef` in the component class**; confirm/cancel are template-only via `mat-dialog-close` / `[mat-dialog-close]="true"` directives (`remove-instrument-confirm.html:15-16`). The directive itself injects `MatDialogRef`, so a test's `TestBed` providers still need a `MatDialogRef` stub even though the component class never references it directly.
- Template: shows `data.ticker`, conditional `data.alertsCount > 0` warning, fixed irreversibility text (`:5-8`).

**4. `remove-user/remove-user.ts`**
- Injects `AdminService` (`:31`), `MatSnackBar` (`:32`), **`MatDialog`, non-optional** (`:33`).
- Signal-based: `users`, `selectedUserId`, `submitting`, `loadError`, `noUsers` computed (`:35-42`); `canSubmit` = `selectedUserId() !== null && !submitting()` (`:42`).
- Constructor calls `fetchUsers()` directly (`:44-46`, `AdminService.listUsers()` at `:96-105`) — a different init pattern than the `ensureLoaded()` used elsewhere.
- **Confirm-dialog flow**: `onSubmit()` (`:52-65`) → `adminService.getUserImpact(id)` → `openConfirmDialog(id, email, alertsCount, triggerEventsCount)` (`:67-80`) opens `RemoveUserConfirm` with `data: { email, alertsCount, triggerEventsCount }` (note: `id` stays in the outer closure, not passed into dialog data) → `.afterClosed()`: confirmed → `removeUser(id)`; else → reset `submitting`.
- `removeUser(id)` (`:82-94`): calls delete, re-fetches user list on success (`:86`).
- Payloads: impact `GET /api/admin/users/{id}/impact`, delete `DELETE /api/admin/users/{id}`, list `GET /api/admin/users` (`admin-panel.service.ts:78-88`).
- Error codes: `forbidden, unknown_user, cannot_delete_self` (`:16-19`) — `cannot_delete_self` is server-enforced only; the component does not filter the current admin out of the rendered `users` list client-side.

**4b. `remove-user-confirm/remove-user-confirm.ts`** (dialog content)
- Same shape as 3b: only `MAT_DIALOG_DATA` injected (`:17`), no `MatDialogRef` in class, `mat-dialog-close` directives drive confirm/cancel (`remove-user-confirm.html:17-18`). Template shows `alertsCount > 0` and `triggerEventsCount > 0` warnings independently (`:5-12`).

### Existing Angular component-test pattern (§6.5) — applicability to admin components

Both existing spec files (`alert-form.spec.ts`, `register.spec.ts`) confirm §6.5's documented pattern: `render()` from `@testing-library/angular/zoneless`, an explicit provider stub for *every* injected token (including ones only the template needs, e.g. `ActivatedRoute` for `RouterLink`), plain-object service stubs (not spy objects), DOM-level assertions via `screen.findByText`/`queryByText`, and server-driven states triggered via a stubbed service method returning `throwError(...)`.

**Gap in the existing cookbook for admin components**: §6.5's flagship technique — casting to access a `protected FormGroup` and driving it via `.setValue()` — doesn't apply, since all 6 admin components are signal-based with no `FormGroup` anywhere. A Phase 5 plan needs an equivalent signal-driven variant: either simulate real user events (`fireEvent`/`change`/`blur`/`click`) end-to-end, or cast to access `protected` signals directly and call `fixture.detectChanges()` after external mutation (signal writes from outside a tracked context still need this nudge under zoneless). `MatDialog.open()` needs a stub returning a fake `MatDialogRef`-shaped object whose `afterClosed()` returns an `Observable` the test controls (to exercise both the confirm and cancel branches of `remove-instrument.ts`/`remove-user.ts`).

### Why frontend-test-bootstrap (§3 Phase 3) excluded the admin panel

`context/archive/2026-08-23-frontend-test-bootstrap/plan.md`, "What We're NOT Doing":
> "Not testing any component beyond Alert Form and Register (e.g. Login, Add Instrument, admin panel forms) — those are 'required-only' per test-plan.md risk #4 evidence and out of scope for this phase."

`plan-brief.md`'s Scope table, "Out of scope": "Any component beyond Alert Form and Register (Login, Add Instrument, admin panel forms)".

No `research.md` exists in that archive (only `change.md`, `plan-brief.md`, `plan.md`, `reviews/`) — the exclusion traces back to old test-plan.md risk #4 evidence, which bucketed admin panel forms as "required-only" by association with Login, not from any direct inspection. This research shows that bucketing undersold the actual surface: a non-trivial type→suffix mapping, a two-step impact-preview→confirm-dialog→delete flow duplicated across two components, and non-optional `MatDialog` injection — none of which is "just required-field validation."

## Code References

- `stryker.config.json` — mutation-testing scope (`mutate: ["src/worker/**/*.ts"]`), unchanged by PR #91
- `test/worker/session.test.ts` (new in `8a2884f`), `test/worker/auth.test.ts` — session/auth boundary coverage added by PR #91
- `test/worker/alert-evaluation.test.ts` (+161 lines in `9a3465a`) — down-direction firing coverage
- `src/app/features/admin/admin-panel.ts:46-133` — container component, market-data backfill form
- `src/app/features/admin/admin-panel.service.ts:55-88` — all admin HTTP payload shapes
- `src/app/features/admin/add-instrument/add-instrument.ts:19-21,53-137` — type→suffix mapping, signal state, submit flow
- `src/app/features/instruments/instrument-types.ts:6` — `CREATABLE_INSTRUMENT_TYPES`
- `src/app/features/admin/remove-instrument/remove-instrument.ts:35,76-118` — `MatDialog` injection, confirm-dialog flow
- `src/app/features/admin/remove-instrument-confirm/remove-instrument-confirm.ts:16` — `MAT_DIALOG_DATA` only, no `MatDialogRef`
- `src/app/features/admin/remove-instrument-confirm/remove-instrument-confirm.html:15-16` — `mat-dialog-close` directive wiring
- `src/app/features/admin/remove-user/remove-user.ts:33,44-94` — `MatDialog` injection, `fetchUsers()` init pattern, confirm-dialog flow
- `src/app/features/admin/remove-user-confirm/remove-user-confirm.ts:17` — `MAT_DIALOG_DATA` only
- `src/app/features/alerts/alert-form/alert-form.spec.ts:18-40` — reference pattern: dual `MatDialogRef`/`MAT_DIALOG_DATA` stubs, `FormGroup` cast trick
- `src/app/features/auth/register/register.spec.ts:17,49,57,61` — reference pattern: `ActivatedRoute` stub for template-only need, `throwError` server-error path, DOM `button[type="submit"]` click

## Architecture Insights

- **Signal-based forms, no `FormGroup`, anywhere in `src/app/features/admin/`.** All 6 admin components use `signal`/`computed` state with a hand-rolled `canSubmit` guard instead of Reactive Forms `Validators`. This is a real architectural divergence from `alert-form.ts`/`register.ts` (both `FormGroup`-based) that §6.5's cookbook doesn't yet cover — a Phase 5 plan must add a signal-driven testing pattern, not just reuse the `FormGroup`-cast trick verbatim.
- **Two distinct dialog DI shapes coexist**: the *opener* components (`remove-instrument.ts`, `remove-user.ts`) inject `MatDialog` (non-optional) and call `.open(...).afterClosed()`; the *dialog-content* components (`*-confirm.ts`) never inject `MatDialogRef` themselves — confirm/cancel is delegated entirely to the `mat-dialog-close` template directive, which internally requires `MatDialogRef` from the test's `TestBed` providers regardless. Tests for the confirm components need a `MatDialogRef` stub even though grep-ing the component class alone wouldn't reveal that need.
- **Impact-preview-before-confirm is a repeated two-step pattern**: both delete flows (`remove-instrument.ts`, `remove-user.ts`) fetch an "impact" (`alertsCount`, `triggerEventsCount`) via GET *before* opening the confirm dialog, then pass that data into the dialog rather than re-fetching after confirmation. A test asserting "delete only happens on confirm" needs to stub both the impact-GET and the delete-DELETE service methods, and assert the delete is called only after `afterClosed()` emits truthy.
- **Server-only business rules exist without client-side mirroring** (`cannot_delete_self` on `remove-user.ts` — the currently-logged-in admin isn't filtered out of the rendered user list client-side). This is a legitimate scope boundary for component tests: proving the error-code mapping renders correctly is in scope; proving self-deletion is actually prevented is a server-side integration-test concern already covered (or not) elsewhere, not a Risk #8 component-test gap.

## Historical Context (from prior changes)

- `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md` — established the current risk map (#1-#7) and the §6.5 Angular testing pattern conventions this research extends to a new risk.
- `context/archive/2026-08-23-frontend-test-bootstrap/plan.md` — the phase that shipped §6.5's pattern via Alert Form + Register, and explicitly scoped admin panel out (quoted above) on now-outdated reasoning.
- `context/archive/2026-08-02-admin-panel/`, `2026-08-09-admin-add-instrument/`, `2026-08-14-admin-remove-instrument/`, `2026-08-14-admin-remove-user/` — the four changes that built the 6 admin components now under review; not read in full for this research (out of scope — this research grounds current code state, not build history), but their change-ids map 1:1 to the component groupings found here (add-instrument, remove-instrument[-confirm], remove-user[-confirm]).
- No `context/changes/` or `context/archive/` folder exists for PR #91 (the mutation-testing sweep) — it was committed directly to this branch without going through `/10x-new`. Grounding for §4/§7/§8 comes entirely from `git log`/`git show`, not a change artifact.

## Related Research

- `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md` — prior full risk-map grounding (risks #1-#7)
- `context/archive/2026-08-23-frontend-test-bootstrap/plan.md` — Phase 3 scope decisions and exclusion rationale

## Open Questions

- Should Risk #8's Phase 5 also add a signal-driven cookbook sub-section to §6.5 (mirroring the existing `FormGroup`-cast pattern), or is a one-off pattern per component acceptable given only 6 components exist? (Affects how much of Phase 5 is "write tests" vs. "extend the cookbook.")
- `admin-panel.ts`'s manual market-data backfill form was not explicitly named in the change notes' 6-component list under discussion (it was implicit as component #1) — confirm during planning whether it's in scope for Phase 5 or deferred, since it's the one admin component with no confirm-dialog/delete semantics (lower blast-radius than the other 5).
- No `context/changes/` folder exists for PR #91 — worth deciding during planning whether that's acceptable going forward for pure test-only mutation-sweeps, or whether future sweeps should get a lightweight change folder for traceability.
