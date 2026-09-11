# Admin Endpoint and Panel UI to Manually Trigger the Daily Cron Pipeline — Implementation Plan

## Overview

Add an authenticated admin endpoint, `POST /api/admin/cron/run`, that manually re-runs the production cron pipeline (fetch closes → RSI → evaluate alerts → send emails) on demand and returns a structured JSON summary of what happened, **plus** a new admin-panel page (`/admin/cron-run`) that is the required way to trigger it — a confirm dialog, a trigger button, and a results panel rendering that summary. This closes GitHub issue #150 (updated 2026-09-11): a backend-only endpoint does not satisfy the issue: "the endpoint must be operable entirely from that form; it is not meant to be a curl-only/hidden action."

## Current State Analysis

- `handleScheduled(env): Promise<void>` (`src/worker/scheduled.ts:36`) orchestrates the whole pipeline: loads the instrument registry, fetches closes per ticker with retry, computes RSI, upserts `market_data`/`price_history`, then calls `evaluateAlerts(env)` (`scheduled.ts:84`).
- `evaluateAlerts(env): Promise<void>` (`src/worker/lib/alert-evaluation.ts:99`) loads all alerts joined with instrument/market data, fires emails via `sendAlertEmail` (`resend.ts:18`) for armed alerts whose condition is met, records each firing in `trigger_events`, and disarms/re-arms alerts.
- **Neither function returns anything today** — all visibility into what happened is `console.log`/`console.error` calls. There is no structured summary anywhere in the codebase.
- Error isolation is already per-ticker (`scheduled.ts:47-81`) and per-alert (`alert-evaluation.ts:116-170`). Only two failure modes abort a whole stage: the instrument-registry query failing (`scheduled.ts:41-44`) and the alerts-load query failing (`alert-evaluation.ts:110-113`).
- `src/worker/index.ts:36` wires `scheduled: (_controller, env, _ctx) => handleScheduled(env)` — the cron path currently discards whatever `handleScheduled` returns.
- `src/worker/routes/admin.ts` establishes the admin-route pattern: `adminRoutes.use('*', sessionMiddleware, adminMiddleware)` (admin.ts:17), handlers return `c.json(payload, status)`, errors use `{ error: string, code: string }`.
- **The admin panel is not a single hub with sections — it is one routed page per admin action**, each its own standalone component sharing `AdminService`: `/admin` (fetch market data, `admin-panel.ts`), `/admin/add-instrument`, `/admin/remove-instrument`, `/admin/remove-user` (`src/app/app.routes.ts:20-39`), all gated by `adminGuard` and listed in `src/app/core/shell/shell.html:64-83` under a collapsible "Admin" nav toggle, alphabetically ordered by their **Polish** nav label.
- Every existing admin component follows an identical skeleton: standalone, Angular Material, plain `signal`/`computed` state (no reactive/template forms), a `submitting` signal gating a `canSubmit` computed, a `loading`/`loadError` pair for any initial data fetch, and `MatSnackBar.open(...)` for both success and error feedback via a per-file `ERROR_MESSAGES: Record<string, string>` keyed on the backend's `code` field, falling back to a `GENERIC_ERROR` (e.g. `admin-panel.ts:25-37,139-148`; `remove-instrument.ts:18-24,153-162`).
- A confirmation step (`MatDialog`, plain Confirm/Cancel — no typed confirmation) exists only for the two destructive actions (`remove-instrument.ts:107-120` → `RemoveInstrumentConfirm`, `remove-instrument-confirm.ts`); the non-destructive market-data fetch has none. `remove-instrument`'s flow first calls a GET "impact preview" endpoint to populate the dialog with a blast-radius count before opening it (`remove-instrument.ts:92-105`).
- No existing admin action displays a structured/tabular result — every one shows a single- or dual-number confirmation string in a snackbar. This will be the app's first structured-results panel.
- `AdminService` (`admin-panel.service.ts`) has one method per endpoint, each a thin `Observable<T>` wrapper: `return this.http.post<T>(url, body)` — no try/catch, errors propagate as `HttpErrorResponse` through the observable's error channel (`admin-panel.service.ts:55-88`).
- `InstrumentsService.instruments()` (`src/app/features/instruments/instruments.service.ts`) already exposes `{ ticker, name, type, ... }[]` app-wide via `ensureLoaded()` — usable to map tickers in the new summary to human-readable instrument names.

### Key Discoveries:

- **This app is internationalized**: source strings are English, tagged `$localize` (in `.ts`) or `i18n="@@id"` (in `.html`), with Polish translations living in `src/locale/messages.pl.xlf` (`sourceLocale: "en-US"`, target `pl`, `angular.json:42-50`). The **production** build config — which is `ng build`'s default (`angular.json:98`, and thus what `npm run build` / `npm run ci` run) — sets `i18nMissingTranslation: "error"` (`angular.json:83-84`): any new `$localize`/`i18n` string without a matching `<trans-unit id="...">` entry in `messages.pl.xlf` makes the build **fail**, not just warn. See Critical Implementation Details.
- `test/worker/scheduled.test.ts` imports `worker` directly and calls `worker.scheduled(controller, env, ctx)` (not `exports.default.fetch`) because the Workers RPC boundary can't structured-clone a `ScheduledController` — the cron handler in `index.ts:36` must keep returning something serialization-safe.
- `admin.test.ts` already mocks `fetch` via `vi.stubGlobal('fetch', ...)`; the new route's tests need the same technique but must route two different external destinations (Yahoo chart API `query1.finance.yahoo.com` and Resend's `api.resend.com`) from one mock.
- `trigger_events` has no column distinguishing a manually-triggered run from a scheduled cron run — confirmed accepted gap, not adding one (see What We're NOT Doing).

## Desired End State

An admin (session-authenticated, email in `ADMIN_EMAILS`) navigates to `/admin/cron-run` from the sidebar, clicks "Uruchom pipeline", confirms in a dialog, and sees — on the same page, without touching curl or production logs — a results panel listing every ticker's fetch outcome, the alerts-evaluated count, every fired alert's email outcome (with instrument names, not raw tickers), and any errors. The backend endpoint (`POST /api/admin/cron/run`) is the same call this UI makes; it is not exposed as a separate, UI-less capability.

**Verification**: `npm run typecheck`, `npm run test:worker`, `npm run lint`, and `npm run build` (which exercises the i18n-completeness check) all pass; a manual walkthrough in the browser — click, confirm, observe a real sandboxed email fire for a seeded crossing alert, see it reflected in the results panel — succeeds.

## What We're NOT Doing

- No dry-run/preview mode — the endpoint always executes the real pipeline, exactly like the scheduled cron.
- No new `trigger_events` column to distinguish manual vs. scheduled runs.
- No concurrency lock against overlapping manual triggers — the pipeline's idempotent upserts make re-running it safe for the market-data stage. **Known accepted risk**: this does NOT fully cover `evaluateAlerts`'s armed→fire path — it does a plain `SELECT` then a later `UPDATE ... SET armed = 0` with no locking in between, so two truly overlapping runs (two admin clicks in quick succession, or a manual trigger racing the real scheduled cron) could both read the same alert as `armed = 1` and both send a real duplicate email before either write clears the flag. Accepted as a low-probability risk given single-admin, infrequent manual use.
- No "last run" persistence or history for this page — the results panel is ephemeral, cleared on navigation/reload, matching the deliberate choice not to add a runs-history table.
- No new Angular `.spec.ts` files — matches this project's hard rule ("Never generate spec files — `skipTests: true` is set globally") and every prior admin-panel-family change, which relied on manual QA for the frontend.
- No Playwright E2E test for this flow in this change — manual browser QA only (see Phase 3's Manual Verification).
- No changes to the Cron Trigger schedule (`wrangler.toml:17`) or to `/__scheduled` behavior.

## Implementation Approach

Backend: refactor `handleScheduled` and `evaluateAlerts` to accumulate and return structured summary objects instead of `Promise<void>`, changing nothing about their internal control flow. The scheduled cron handler explicitly discards the returned value via an `async` wrapper so its own contract and existing tests are unaffected. A new `POST /api/admin/cron/run` route calls `handleScheduled(c.env)` directly and maps the returned summary to a JSON response, using `207` when the summary contains any ticker/email/stage-level error and `200` otherwise (207 is a 2xx status — Angular's `HttpClient` treats it as a normal success response, delivered via `next()` exactly like 200, so the frontend needs no special-casing for it).

Frontend: a new routed page `/admin/cron-run` (sibling to the other admin pages, not a section bolted onto `/admin`), following the exact `signal`/`computed` skeleton every other admin component uses, with one addition — a confirm dialog before the POST (mirroring `remove-instrument`'s dialog pattern, but with no async impact-preview step first, since there's nothing to preview) — and one new pattern: an inline results panel rendering the returned summary instead of a single-line snackbar, since a snackbar can't show the per-ticker/per-alert breakdown the backend is built to return.

## Critical Implementation Details

**i18n build gate**: Every new `$localize`/`i18n="@@id"` string this plan introduces needs a matching `<trans-unit id="...">` entry added to `src/locale/messages.pl.xlf` with a Polish `<target>`. `npm run build` (production config, part of `npm run ci`) sets `i18nMissingTranslation: "error"` and will fail the build if any is missing — this is not optional polish, it is a hard gate. Phase 3 lists every new i18n id that needs a translation entry.

**Scheduled handler return-type change is call-site sensitive**: `index.ts:36` currently reads `scheduled: (_controller, env, _ctx) => handleScheduled(env)`. Once `handleScheduled` returns `Promise<CronRunSummary>` instead of `Promise<void>`, rewrite this explicitly as `scheduled: async (_controller, env, _ctx) => { await handleScheduled(env); }` so the handler's own return type stays `Promise<void>` regardless of what `handleScheduled` returns, and `scheduled.test.ts`'s existing `runScheduled()` helper keeps working unchanged.

## Phase 1: Return structured summaries from the pipeline

### Overview

Change `evaluateAlerts` and `handleScheduled` to build and return summary objects capturing exactly what happened, with zero change to existing behavior, retries, DB writes, or logging. This phase touches only `src/worker/lib/alert-evaluation.ts`, `src/worker/scheduled.ts`, and `src/worker/index.ts` — no new route yet.

### Changes Required:

#### 1. Alert evaluation summary type and accumulation

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: `evaluateAlerts` should return what it did — how many alerts it evaluated, and the outcome of every email it attempted to send — instead of only logging. The per-alert `try/catch` isolation (lines 116-170) stays exactly as-is; each iteration additionally appends a result to the returned summary.

**Contract**: Export a new `AlertEvaluationSummary` interface: `{ alertsEvaluated: number; emails: Array<{ alertId: number; ticker: string; status: 'sent' | 'failed'; error?: string }>; errors: string[] }`. Change `evaluateAlerts(env: Env): Promise<void>` to `evaluateAlerts(env: Env): Promise<AlertEvaluationSummary>`. `alertsEvaluated` is `alerts.length` from the existing query result (line 109) — count every loaded alert, not just ones that fired. Only alerts that actually reach the `sendAlertEmail` call (line 131, the `armed === 1` + condition-met branch) push an entry into `emails`.

The per-alert `try/catch` (lines 116-170) wraps both the armed→fire branch and the not-armed→re-arm-check branch — a caught exception doesn't necessarily mean an email send failed. Track this with a `let reachedSend = false` set to `true` immediately before the `sendAlertEmail` call (line 131); in the catch block, push `{ alertId: alert.id, ticker: alert.ticker, status: 'failed', error: String(err) }` to `emails` only when `reachedSend` is `true`, otherwise push `` `alert ${alert.id}: ${String(err)}` `` to the summary's `errors` array. This keeps a re-arm-write failure (or any other non-send exception) from being misreported as a failed email.

On the early-return failure path (line 110-113, alerts-load query fails), return `{ alertsEvaluated: 0, emails: [], errors: [] }` — the stage-level error itself is surfaced by `handleScheduled` (see #2 below), not duplicated here.

#### 2. Cron run summary type and accumulation

**File**: `src/worker/scheduled.ts`

**Intent**: `handleScheduled` should build a top-level summary combining per-ticker outcomes with the `AlertEvaluationSummary` from step 1, plus any stage-level errors (registry load failure). The per-ticker `try/catch` isolation (lines 47-81) stays exactly as-is; each iteration additionally appends a result.

**Contract**: Export a new `CronRunSummary` interface: `{ tickers: Array<{ ticker: string; status: 'ok' | 'error'; error?: string }>; alertsEvaluated: number; emails: AlertEvaluationSummary['emails']; errors: string[] }`. Change `handleScheduled(env: Env): Promise<void>` to `handleScheduled(env: Env): Promise<CronRunSummary>`.
- On the registry-load failure path (lines 41-44), keep the existing `console.error` and return `{ tickers: [], alertsEvaluated: 0, emails: [], errors: [String(err)] }` instead of a bare `return`.
- Inside the per-ticker loop: on success, push `{ ticker, status: 'ok' }`; on the caught error (line 79-81), keep the existing `console.error` and additionally push `{ ticker, status: 'error', error: String(err) }`. The `closes.length === 0` early-`continue` counts as `status: 'ok'`.
- After the loop, call `const alertSummary = await evaluateAlerts(env)` (replacing the current bare `await evaluateAlerts(env)` at line 84) and merge its `alertsEvaluated`/`emails`/`errors` into the returned `CronRunSummary` (concatenate `alertSummary.errors` onto the per-ticker errors collected so far).

#### 3. Preserve the scheduled cron handler's own contract

**File**: `src/worker/index.ts`

**Intent**: The exported `scheduled` handler must keep returning `Promise<void>` regardless of `handleScheduled`'s new return type — see Critical Implementation Details above.

**Contract**: Change `scheduled: (_controller, env, _ctx) => handleScheduled(env)` (line 36) to `scheduled: async (_controller, env, _ctx) => { await handleScheduled(env); }`.

#### 4. Update existing tests for the new return type

**File**: `test/worker/scheduled.test.ts`, `test/worker/alert-evaluation.test.ts`

**Intent**: Existing tests call `evaluateAlerts`/`handleScheduled` and assert on DB side effects only — confirm no existing assertion depends on the old `void` return, and add new assertions that the returned summary shape matches what actually happened in each scenario.

**Contract**: `scheduled.test.ts`'s `await expect(runScheduled()).resolves.toBeUndefined()` continues to pass unchanged (`runScheduled()`'s own return type stays `Promise<void>`). Add new test cases that call `handleScheduled(env)` and `evaluateAlerts(env)` directly (not through `worker.scheduled`, which no longer exposes the return value) to assert on the summary contents for: all-tickers-succeed, one-ticker-fails, registry-load-fails, and (in `alert-evaluation.test.ts`) an alert firing successfully, a Resend send failure, and a non-armed alert whose re-arm `UPDATE` throws (asserting the error lands in `errors`, not `emails`, per the `reachedSend` guard above).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker`
- Lint passes: `npm run lint`

#### Manual Verification:

- None — this phase has no user-visible or admin-visible surface yet; Phase 3 is where manual browser verification happens.

---

## Phase 2: Admin endpoint

### Overview

Add `POST /api/admin/cron/run` to `admin.ts`, using the `CronRunSummary` from Phase 1 to build the JSON response and pick the status code.

### Changes Required:

#### 1. New admin route

**File**: `src/worker/routes/admin.ts`

**Intent**: Expose the pipeline as an on-demand admin action, following the exact auth/response conventions already used by every other route in this file (no request body).

**Contract**: `adminRoutes.post('/cron/run', async (c) => { ... })`, placed alongside the other routes (e.g. after `/market-data`). Calls `const summary = await handleScheduled(c.env)` (import `handleScheduled` and `CronRunSummary` from `../scheduled`). Determine `hasFailures` as: `summary.errors.length > 0 || summary.tickers.some((t) => t.status === 'error') || summary.emails.some((e) => e.status === 'failed')`. Return `c.json(summary, hasFailures ? 207 : 200)`. `sessionMiddleware` + `adminMiddleware` (already applied via `adminRoutes.use('*', ...)`) is the entire guard surface.

#### 2. Route-level tests

**File**: `test/worker/admin.test.ts`

**Intent**: Cover this route with the same test shape as every other admin route: 401 (no session), 403 (non-admin), and success paths for both the all-clear (200) and partial-failure (207) cases, verifying the response body's structure and that the pipeline's real side effects (D1 writes, Resend call) actually happened.

**Contract**: Add a `describe('POST /cron/run', ...)` block. Mock `fetch` with `vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => { ... }))`, branching on whether the URL is the Yahoo chart endpoint (`query1.finance.yahoo.com`) vs. the Resend endpoint (`api.resend.com`). Test cases: 401 no session; 403 non-admin; 200 with a well-formed summary and no fired emails when nothing crosses; 207 when a ticker fetch fails (that ticker marked `status: 'error'`); an armed alert crossing its threshold fires an email (`emails` contains a `status: 'sent'` entry) and inserts a `trigger_events` row (direct D1 verification).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker`
- Lint passes: `npm run lint`

#### Manual Verification:

- `curl -X POST` the endpoint locally (via `wrangler dev --local`) as a logged-in admin — confirm the `200`/`207` JSON summary shape matches what Phase 3's UI will consume. This is a backend smoke test only; the issue's actual acceptance criterion (operable from the form) is verified in Phase 3.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Phase 3: Admin panel UI — trigger page, confirm dialog, results panel

### Overview

Add the admin-panel UI that is the required way to trigger the endpoint: a new routed page, a confirm dialog, a results panel, a nav link, and the Polish translations the i18n build gate requires.

### Changes Required:

#### 1. Service method and summary types

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Mirror the backend's `CronRunSummary` shape as frontend-owned TypeScript interfaces (this file already duplicates each backend response shape independently — e.g. `MarketDataFetchResult` — rather than importing worker types), and add the one new HTTP call.

**Contract**: Add `export interface CronRunTickerResult { ticker: string; status: 'ok' | 'error'; error?: string }`, `export interface CronRunEmailResult { alertId: number; ticker: string; status: 'sent' | 'failed'; error?: string }`, and `export interface CronRunSummary { tickers: CronRunTickerResult[]; alertsEvaluated: number; emails: CronRunEmailResult[]; errors: string[] }`. Add `triggerCronRun(): Observable<CronRunSummary> { return this.http.post<CronRunSummary>('/api/admin/cron/run', {}); }`, following the exact zero-wrapping pattern every other method in this file uses.

#### 2. Confirm dialog component

**File**: `src/app/features/admin/cron-run-confirm/cron-run-confirm.ts`, `cron-run-confirm.html`

**Intent**: A plain Confirm/Cancel dialog warning that this sends real emails to real users, opened before the POST fires — mirroring `remove-instrument-confirm`'s structure exactly, but with no `MAT_DIALOG_DATA` input (there's no per-instance data to show — this dialog's content is static, unlike the ticker/alert-count-specific `RemoveInstrumentConfirm`).

**Contract**: `CronRunConfirm` component, selector `app-cron-run-confirm`, imports `[MatButtonModule, MatDialogModule]`, template with `mat-dialog-title` ("Uruchomić pipeline crona?" / i18n id `cronRunConfirm.title`), a body paragraph warning that this may send real emails and cannot be undone (i18n id `cronRunConfirm.body`), and `mat-dialog-actions` with Cancel (`mat-dialog-close`, i18n id `cronRunConfirm.cancel`) and a `color="warn"` Confirm button (`[mat-dialog-close]="true"`, i18n id `cronRunConfirm.confirm`) — same structural shape as `remove-instrument-confirm.html`.

#### 3. Trigger page component

**File**: `src/app/features/admin/cron-run/cron-run.ts`, `cron-run.html`, `cron-run.scss`

**Intent**: The page that opens the confirm dialog, calls `triggerCronRun()` on confirmation, and renders the returned summary as a results panel enriched with instrument names.

**Contract**: Standalone component `CronRun`, selector `app-cron-run`, `templateUrl`/`styleUrl` per convention. Injects `AdminService`, `InstrumentsService`, `MatDialog`. State: `submitting = signal(false)` (gates the trigger button — no `canSubmit` computed is needed beyond `!submitting()`, since there's no form to validate), `result = signal<CronRunSummary | null>(null)` (drives the results panel), `submitError` handling via the same `ERROR_MESSAGES`/`GENERIC_ERROR`/`HttpErrorResponse.error.code` pattern as every other admin component (this endpoint's only realistic non-2xx codes are the shared 401/403 — no request-specific validation codes exist since there's no request body). Calls `instrumentsService.ensureLoaded()` in the constructor purely to populate the name-lookup map used when rendering the results panel — this does NOT gate the trigger button's availability (the trigger action itself needs no instrument data); if the lookup hasn't resolved by render time, fall back to the raw ticker string.

`onTriggerClick()`: opens `CronRunConfirm` via `dialog.open(CronRunConfirm).afterClosed().subscribe((confirmed) => { if (confirmed) this.run(); })` — no `data` object, unlike `remove-instrument`'s dialog open call, since there's nothing to preview first. `run()`: sets `submitting.set(true)`, `result.set(null)`, calls `adminService.triggerCronRun().subscribe({ next: (summary) => { this.submitting.set(false); this.result.set(summary); }, error: (err) => { this.submitting.set(false); this.showError(err); } })`.

Template layout: a trigger button (disabled while `submitting()`, showing a `mat-progress-spinner` alongside it while `submitting()` is true — the first admin action to spinner the submit itself, not just an initial page load, since this request can take noticeably longer than the existing single-call admin actions). Below it, `@if (result(); as summary)`, render:
- A tickers `mat-table` (add `MatTableModule` to imports), mirroring `trigger-history.ts`/`.html`'s exact structure (`[dataSource]="summary.tickers"`, `matColumnDef`/`matHeaderCellDef`/`matCellDef` per column, `mat-header-row`/`mat-row` with a `displayedColumns` array): columns for the resolved instrument name (ticker → name via a lookup helper, falling back to the raw ticker), `status`, and `error` (blank when absent), with a warn-colored row/cell for `status === 'error'`.
- An "alerts evaluated" count (plain text, not a table).
- An emails `mat-table`, same pattern, columns for resolved instrument name, alert id, `status` translated to a Polish label ("Wysłano"/"Nieudane"), and `error` (blank when absent), warn-styled for `status === 'failed'`.
- An errors list (if `summary.errors.length > 0`) for stage-level failures not tied to one ticker/alert — a plain `@for` list, not a table, since these are bare strings with no per-row columns to define.

#### 4. Route and navigation

**File**: `src/app/app.routes.ts`, `src/app/core/shell/shell.html`

**Intent**: Register the new page the same way every other admin page is registered, and add it to the collapsible Admin nav section in its correct alphabetical (by Polish label) position.

**Contract**: In `app.routes.ts`, add `{ path: 'admin/cron-run', loadComponent: () => import('./features/admin/cron-run/cron-run').then((m) => m.CronRun), canActivate: [adminGuard] }` alongside the other `admin/*` routes. In `shell.html`'s admin nav panel (inside the existing `@if (adminExpanded())` block), add `<a mat-list-item class="nested-item" routerLink="/admin/cron-run" routerLinkActive="active-link"><span matListItemTitle i18n="@@shell.nav.adminCronRun">Run pipeline</span></a>`. Polish label "Uruchom pipeline" sorts alphabetically **before** "Usuń instrument"/"Usuń użytkownika" (Uruchom < Usuń) and after "Pobierz dane giełdowe" — final nav order: Dodaj instrument, Pobierz dane giełdowe, Uruchom pipeline, Usuń instrument, Usuń użytkownika. Move the new `<a>` to that position in the list, not appended at the end.

#### 5. Extend the existing admin-gate E2E coverage

**File**: `e2e/admin-gate-redirect.spec.ts`

**Intent**: This existing Playwright test already asserts, exhaustively, that a non-admin is redirected away from every admin route. Adding a fifth admin route without updating it would silently leave `/admin/cron-run` outside that coverage — this is a one-line addition to an existing, already-passing test, not a new E2E test (which remains out of scope per What We're NOT Doing).

**Contract**: Add `'/admin/cron-run'` as a new entry in the `ADMIN_ROUTES` array (lines 22-27). No other change to this file — the existing `for` loop picks up the new route automatically.

#### 6. Polish translations

**File**: `src/locale/messages.pl.xlf`

**Intent**: Satisfy the i18n build gate (see Critical Implementation Details) — every `i18n="@@id"`/`$localize` id introduced in changes #2-#4 needs a `<trans-unit>` entry here.

**Contract**: Add one `<trans-unit id="..." datatype="html"><source>...</source><target>...</target></trans-unit>` block per new id: `shell.nav.adminCronRun`, `cronRunConfirm.title`, `cronRunConfirm.body`, `cronRunConfirm.cancel`, `cronRunConfirm.confirm`, `cronRun.title`, `cronRun.submit`, `cronRun.loadingSpinnerAriaLabel` (or similar, matching whatever aria-label the spinner needs per the accessibility pattern in `remove-instrument.html:9`), `cronRun.result.tickersHeading`, `cronRun.result.alertsEvaluated`, `cronRun.result.emailsHeading`, `cronRun.result.statusSent`, `cronRun.result.statusFailed`, `cronRun.result.statusOk`, `cronRun.result.statusError`, `cronRun.result.errorsHeading`, plus any `ERROR_MESSAGES`/`GENERIC_ERROR` ids in `cron-run.ts` (`cronRun.error.forbidden`, `cronRun.error.generic`). Exact id list is finalized during implementation as strings are written — this is the authoritative checklist to cross off, not a literal final set.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Production build succeeds (exercises the i18n-completeness gate): `npm run build`
- Angular unit tests still pass (no new specs added, but existing ones must not break): `npm run test:ci`
- Extended admin-gate E2E coverage passes (informational per this project's e2e CI convention, not a `npm run ci` gate): `npx playwright test admin-gate-redirect`

#### Manual Verification:

- Log in as the admin user, open the sidebar, confirm "Uruchom pipeline" appears in the correct alphabetical position and navigates to `/admin/cron-run`.
- Click the trigger button — confirm the confirm dialog appears with Cancel/Confirm; clicking Cancel does nothing (no request sent, button re-enabled).
- Confirming with no crossing alerts — confirm the results panel shows all tickers as OK, zero emails, zero errors, using instrument names (not raw tickers).
- Seed a local alert whose threshold is already crossed by local market data, trigger again from the UI — confirm a real (sandboxed, `RESEND_VERIFIED_EMAIL`-restricted) email attempt fires, the results panel shows that alert's email as sent (with the instrument's name), and a new `trigger_events` row appears in local D1.
- Force a ticker-fetch failure (e.g. temporarily break network/mock) — confirm the results panel shows that ticker as an error with a message, styled distinctly from the OK rows.
- Log in as a non-admin — confirm `/admin/cron-run` is unreachable (redirected, matching every other `admin/*` route's existing guard behavior).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `evaluateAlerts` returns correct `alertsEvaluated`/`emails`/`errors` for: no alerts, one alert not armed, one armed alert not crossing threshold, one armed alert crossing threshold (success + Resend failure), one alert whose evaluation throws before vs. after reaching the send call.
- `handleScheduled` returns correct `tickers`/`errors` for: all tickers succeed, one ticker fails after retries, registry-load query fails.

### Integration Tests:

- `POST /api/admin/cron/run` end-to-end through `admin.test.ts`, covering auth gating (401/403) and the full pipeline chain (fetch → write → evaluate → email) with both Yahoo and Resend mocked via one `fetch` stub.

### Manual Testing Steps:

1. Backend smoke test via curl (Phase 2) — confirms the JSON contract before the UI consumes it.
2. Full browser walkthrough (Phase 3) — nav link, dialog, trigger, results panel, real sandboxed email, non-admin gating. This is the authoritative acceptance test for the issue's UI requirement.

## Performance Considerations

None beyond what the existing cron already does — same instrument count (currently 2-3), same retry budget, run synchronously within one Worker request.

## Migration Notes

None — no schema changes in this plan.

## References

- Origin: GitHub issue #150 (https://github.com/mswiac/market-pulse/issues/150), updated 2026-09-11 to require the admin-panel UI
- Admin route conventions: `src/worker/routes/admin.ts`
- Admin panel component conventions: `src/app/features/admin/admin-panel.ts`, `remove-instrument/remove-instrument.ts`, `remove-instrument-confirm/remove-instrument-confirm.ts`
- i18n config: `angular.json:42-50,83-84,98`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Return structured summaries from the pipeline

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 7ffa024
- [x] 1.2 Worker unit tests pass: `npm run test:worker` — 7ffa024
- [x] 1.3 Lint passes: `npm run lint` — 7ffa024

### Phase 2: Admin endpoint

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck`
- [x] 2.2 Worker unit tests pass: `npm run test:worker`
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [ ] 2.4 curl smoke test against local `wrangler dev` returns matching summary shape

### Phase 3: Admin panel UI — trigger page, confirm dialog, results panel

#### Automated

- [ ] 3.1 Typecheck passes: `npm run typecheck`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Production build succeeds (i18n completeness): `npm run build`
- [ ] 3.4 Angular unit tests still pass: `npm run test:ci`
- [ ] 3.5 Extended admin-gate E2E coverage passes: `npx playwright test admin-gate-redirect`

#### Manual

- [ ] 3.6 Nav link appears in correct alphabetical position and navigates correctly
- [ ] 3.7 Confirm dialog appears on click; Cancel aborts with no request sent
- [ ] 3.8 No-crossing run shows all-OK results panel with instrument names
- [ ] 3.9 Seeded crossing alert produces real sandboxed email + results panel reflects it + `trigger_events` row appears
- [ ] 3.10 Forced ticker failure shown as an error row, visually distinct from OK rows
- [ ] 3.11 Non-admin cannot reach `/admin/cron-run`
