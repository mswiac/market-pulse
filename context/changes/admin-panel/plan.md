# Admin Panel Implementation Plan

## Overview

Add an admin-only panel that lets an allowlisted administrator manually fetch/refresh market data (close/high/low) for a chosen instrument over a chosen date range, on demand — independent of the daily cron's fixed lookback window. This backs the roadmap slice `S-09` and directly resolves the "self-backfill window" gap flagged during `S-08`'s plan review (RSI lookback vs. the cron's ~21-trading-day fetch).

## Current State Analysis

- **Auth**: cookie-based sessions, D1-backed (`src/worker/lib/session.ts`). `sessionMiddleware` only exposes `userId` on the request context — no email, no role. `GET /api/me` (`src/worker/routes/auth.ts:109-120`) is the only place that resolves `userId` → `{ id, email }`, and it's what the Angular `AuthService` calls once at bootstrap to populate `currentUser` (`src/app/core/auth/auth.service.ts`).
- **No role concept exists anywhere** — grep for `admin`/`role` across `src/worker` and `src/app` returns nothing. This is the first authorization tier beyond "each user manages only their own alerts" (the flat role model documented in `CLAUDE.md`).
- **Routing/shell**: `src/app/app.routes.ts` has one `authGuard`-protected parent route with lazy-loaded children; `src/app/core/shell/shell.html` renders the sidebar via `<mat-nav-list>`. Adding a tile/route is a copy-paste of the existing "Instruments"/"Triggered alerts" pattern.
- **Instrument selection UI**: `src/app/features/instrument-history/instrument-history.ts`/`.html` already implements the exact type→instrument two-combobox pattern needed here, backed by `InstrumentsService` (`src/app/features/instruments/instruments.service.ts`).
- **Market data fetch**: `fetchDailyCloses(symbol)` in `src/worker/lib/market-data.ts` hits Yahoo's chart API with a hardcoded `range=1mo` query param. `src/worker/scheduled.ts` calls it once per instrument, then upserts every returned day into `price_history` (`ON CONFLICT (ticker, date) DO UPDATE`) and the single latest day into `market_data` (`ON CONFLICT (ticker) DO UPDATE`) — both in one `env.DB.batch(statements)` call.
- **Secrets**: no `[vars]` block in `wrangler.toml`. Local dev secrets live in `.dev.vars` (plain `KEY=value`); remote secrets go through `wrangler secret put <NAME>` (human-run, matches `RESEND_API_KEY`/`PASSWORD_PEPPER`).

## Desired End State

An administrator (email present, case-insensitively, in the `ADMIN_EMAILS` allowlist) sees an "Admin" tile in the sidebar below "History". Opening it shows a form: category + instrument combobox (identical pattern to the instrument-history page) and two date inputs (from/to). Submitting calls a new endpoint that fetches exactly that date range from Yahoo and overwrites the corresponding `price_history` rows, then shows a confirmation with the number of days written. A non-admin never sees the tile in normal use (lazy-loaded route + guard), and even if the UI is bypassed client-side, the backend independently re-validates the session and admin email on every request — the server, not the client, is the authorization boundary.

### Key Discoveries:

- `fetchDailyCloses`'s only caller is `scheduled.ts` (`src/worker/scheduled.ts:15,40`) — safe to change its signature since there's exactly one existing call site to update.
- The `price_history` upsert (`scheduled.ts:44-49`) is already a self-contained `.map()` producing prepared statements with no `market_data` coupling — a clean extraction into a shared helper.
- `/api/me`'s D1 lookup already fetches the user's email in the exact place needed to also compute `isAdmin` — no extra query required.

## What We're NOT Doing

- Not touching `market_data` (the single-row "current value" table alerts are evaluated against) from the admin endpoint. Admin-picked date ranges are historical and arbitrary — writing the latest day of an arbitrary range into `market_data` could regress the "current" price/RSI to a stale value and break live alert evaluation until the next cron run. `market_data` stays cron-only.
- Not adding a DB-backed roles/permissions table. `ADMIN_EMAILS` is an env var/secret, checked per-request — matches the project's flat-role baseline with the smallest possible footprint for a single admin action.
- Not building any panel action beyond the one fetch/backfill form. The panel is structured to add more admin actions later, but none are built now.
- Not adding rate limiting or audit logging on the new endpoint — out of scope for a single-admin, low-frequency internal tool.
- Not changing `calculateRSI`/RSI display logic — `price_history` has no RSI column; RSI for display is already computed on read (`src/worker/routes/instruments.ts:62-63`), so backfilled rows are picked up automatically without any RSI-specific work here.

## Implementation Approach

Four phases, each independently shippable: (1) extend the data-fetch layer to take an explicit date range and extract the shared upsert helper, with zero behavior change for the existing cron; (2) add the admin-gated backend endpoint that uses that extended layer; (3) wire up frontend routing/guard/sidebar visibility; (4) build the panel UI itself. Backend-first ordering means the endpoint is fully testable via `vitest` before any UI exists.

## Critical Implementation Details

**Security boundary**: `isAdmin` on `AuthUser`/`currentUser()` is UX-only — it hides the sidebar tile and blocks the Angular route via `adminGuard`. It must never be treated as authorization. The admin endpoint independently re-derives admin status from the session's `userId` → DB email → `ADMIN_EMAILS` comparison on every request, exactly like every other authenticated route in this codebase re-validates rather than trusting client state.

**Date range → Yahoo query params**: Yahoo's chart API accepts `period1`/`period2` (Unix seconds, UTC) as an alternative to `range`. Convert `from`/`to` (`YYYY-MM-DD`) to Unix seconds via `Date.parse(`${date}T00:00:00Z`) / 1000`. The cron's default range becomes `period2 = now`, `period1 = now - 30 days` — computed at the call site in `scheduled.ts`, not inside `fetchDailyCloses`, so the function itself has no notion of "default."

## Phase 1: Data layer — date-range fetch + shared upsert helper

### Overview

Replace `fetchDailyCloses`'s hardcoded `range=1mo` with explicit `from`/`to` parameters, update the cron call site to pass its existing default range (no behavior change), and extract the `price_history` upsert into a helper both the cron and the new admin route can call.

### Changes Required:

#### 1. Yahoo fetch signature

**File**: `src/worker/lib/market-data.ts`

**Intent**: `fetchDailyCloses` takes an explicit date range instead of a hardcoded lookback window, so both the cron and the admin endpoint can drive it with different ranges through one code path.

**Contract**: `fetchDailyCloses(symbol: string, from: string, to: string): Promise<DailyClose[]>` where `from`/`to` are `YYYY-MM-DD`. All 9 existing single-argument call sites in `test/worker/market-data.test.ts` need a `from`/`to` argument added — none assert on the URL string, so this is a mechanical signature update, not a logic change. Internally builds the Yahoo URL with `period1`/`period2` (Unix seconds) instead of `range`, per the conversion in "Critical Implementation Details" above. Everything downstream of the URL build (response parsing, ascending-timestamp validation, null-close filtering) is unchanged, **except**: a structurally-valid response that parses to zero closes now returns `[]` instead of throwing `MarketDataFetchError`. Today's cron (fixed ~30-day window) never legitimately hits zero results, so this only matters once the admin endpoint (Phase 2) allows arbitrary ranges — e.g. a weekend-only range is a valid "0 trading days" outcome, not a fetch failure. `MarketDataFetchError` is still thrown for genuine failures: non-OK HTTP status, invalid JSON, a `chart.error` payload, missing/malformed `timestamp`/`close` arrays, or non-ascending timestamps.

#### 2. Cron call site

**File**: `src/worker/scheduled.ts`

**Intent**: Preserve today's cron behavior exactly — it must keep fetching the same ~30-day window it does now, just expressed as explicit dates instead of relying on `fetchDailyCloses`'s old default.

**Contract**: `fetchWithRetry` (and its caller `fetchDailyCloses` invocation) computes `to = today's YYYY-MM-DD` and `from = 30 days before today` at call time, and passes them through. `RETRY_ATTEMPTS`/`RETRY_DELAY_MS` retry wrapper is untouched. Per Phase 1's `fetchDailyCloses` change above, `closes` can now theoretically be `[]` (previously guaranteed non-empty or thrown) — add a guard around `latest = closes[closes.length - 1]` to skip that ticker's `price_history`/`market_data` writes for the day if `closes.length === 0`, rather than writing `latest = undefined` fields. This path is unreachable in practice for the cron's 30-day window (always ≥ ~21 trading days) but must exist for type/runtime safety now that the function's contract allows it.

#### 3. Shared upsert helper

**File**: `src/worker/lib/market-data.ts` (co-locate with `fetchDailyCloses` — same module owns "how we get and store price history")

**Intent**: Extract the `price_history` upsert (currently inline in `scheduled.ts:44-49`) into a reusable function so the admin route in Phase 2 doesn't duplicate the SQL, and so both write paths can never drift out of sync.

**Contract**: `upsertPriceHistory(db: D1Database, ticker: string, closes: DailyClose[]): D1PreparedStatement[]` returns the array of prepared statements (same `INSERT ... ON CONFLICT (ticker, date) DO UPDATE` shape as today) — caller decides whether/how to batch them (`scheduled.ts` pushes its own `market_data` statement into the same batch; the admin route batches only these). Pure statement-building, no `db.batch()` call inside — keeps the helper testable without a live D1 round-trip and keeps batching (with `market_data` or without) the caller's decision.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Worker tests pass: `npm run test:worker`
- Existing scheduled-handler tests still pass unchanged (confirms cron behavior is identical): `npm run test:worker -- scheduled`

#### Manual Verification:

- Hit the real Yahoo endpoint directly with `period1`/`period2` for a known symbol (e.g. `curl 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?period1=<unix>&period2=<unix>&interval=1d'`) and confirm the response shape and returned date range match expectations — this is the plan's riskiest unverified assumption, and confirming it before Phase 2 avoids building the full admin route on top of a broken premise.

---

## Phase 2: Backend — admin-gated fetch endpoint

### Overview

Add `ADMIN_EMAILS` wiring, extend `GET /api/me` with `isAdmin`, and add `POST /api/admin/market-data` that validates input, calls the Phase 1 data layer, and writes only to `price_history`.

### Changes Required:

#### 1. Env + local dev secret

**File**: `src/worker/index.ts`

**Intent**: Type the new binding so the admin route and `/me` can read it.

**Contract**: Add `ADMIN_EMAILS: string;` to the `Env` interface (comma-separated list, e.g. `"a@x.com,b@y.com"`).

**File**: `.dev.vars`

**Intent**: Local-dev value for the new binding, following the existing plain `KEY=value` convention.

**Contract**: Append `ADMIN_EMAILS=mateusz.swiac@gmail.com` (the account used for local testing).

#### 2. Admin-email check helper + admin middleware

**File**: `src/worker/lib/admin.ts` (new)

**Intent**: One shared function for "is this email an admin" (used by both `/me` and the admin middleware), plus a reusable `adminMiddleware` that gates the new admin route the same way `sessionMiddleware` gates every other authenticated route — this is the first two-tier auth check in the codebase, and it should follow the existing auth-as-middleware idiom rather than an inline check in the route handler, so future admin routes can reuse it directly.

**Contract**:
- `isAdminEmail(adminEmailsEnv: string, email: string): boolean` — splits `adminEmailsEnv` on `,`, trims each entry, lowercases both sides before comparing.
- `adminMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { userId: number } }>` — runs after `sessionMiddleware` (reads `c.get('userId')`, so it must be chained second), looks up the user's email via `c.env.DB` (same `SELECT email FROM users WHERE id = ?` shape as `/me`), calls `isAdminEmail`, and either calls `next()` or returns `403 { error: 'forbidden' }`.

#### 3. `/api/me` gains `isAdmin`

**File**: `src/worker/routes/auth.ts`

**Intent**: The frontend needs to know admin status to show/hide the sidebar tile and gate the route — `/me` is the one place that already resolves the session to an email.

**Contract**: Response body becomes `{ id, email, isAdmin }`, computed via `isAdminEmail(c.env.ADMIN_EMAILS, user.email)` right before the existing `c.json(user, 200)`.

#### 4. Admin route

**File**: `src/worker/routes/admin.ts` (new)

**Intent**: Authenticated + admin-only endpoint that fetches a caller-specified ticker and date range from Yahoo and overwrites the matching `price_history` rows.

**Contract**: `POST /api/admin/market-data`, mounted as `app.route('/api/admin', adminRoutes)` in `src/worker/index.ts` (inserted alongside the other `app.route` calls, before the SPA catch-all). Route file registers `adminRoutes.use('*', sessionMiddleware, adminMiddleware)` (same two-middleware chain pattern other route files use for `sessionMiddleware` alone) before the handler — authorization is fully resolved by the time the handler runs, which only does request-body validation. Request body: `{ ticker: string, from: string, to: string }` (dates `YYYY-MM-DD`). Validation, all `400 { error: '<reason>' }` on failure (ticker existence check reuses the `lookupTicker`-style DB lookup pattern from `alerts.ts` — that comparison is about the *data-validation* shape, not the auth check, which is fully handled by `adminMiddleware` above):
  - `ticker` must exist in `instruments` (reuse the same `SELECT ... FROM instruments WHERE ticker = ?` lookup pattern as `alerts.ts`'s `lookupTicker`).
  - `from`/`to` must parse as valid `YYYY-MM-DD` dates, `from <= to`, `to` not after today (UTC), and `(to - from)` not exceeding 730 days.
  On success: calls `fetchDailyCloses(ticker, from, to)`, builds statements via `upsertPriceHistory`, runs `env.DB.batch(statements)` (skip the `batch()` call entirely when `closes.length === 0` — nothing to write), responds `200 { ticker, from, to, daysWritten: closes.length }` in both cases. Per Phase 1's updated `fetchDailyCloses` contract, an empty result (e.g. a weekend-only range) is a valid `daysWritten: 0` response, not an error — a `MarketDataFetchError` thrown from `fetchDailyCloses` now only ever represents a genuine failure (bad symbol, Yahoo error, malformed response) and maps to `502 { error: 'market data fetch failed' }`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- New route tests pass: `npm run test:worker -- admin` covering: 401 with no session, 403 for a logged-in non-admin, 400 for unknown ticker / invalid date order / future `to` date / range over 730 days, 200 with correct `price_history` row count and `ON CONFLICT` overwrite of pre-existing rows for an admin, 200 with `daysWritten: 0` for a range containing no trading days, 502 on a mocked Yahoo failure
- Full worker suite still green: `npm run test:worker`

#### Manual Verification:

- Via `curl` or a REST client against `wrangler dev --local`: log in as the local admin account, `POST /api/admin/market-data` with a real ticker + short date range, confirm `daysWritten` matches the range's trading days and `price_history` rows are updated (`npx wrangler d1 execute marketpulse-db --local --command "SELECT * FROM price_history WHERE ticker = '^NDX' ORDER BY date DESC LIMIT 5"`)
- Same request from a logged-in non-admin session confirms `403`

---

## Phase 3: Frontend — routing, guard, sidebar visibility

### Overview

Surface admin status on the client, add a route guard, and conditionally show the sidebar tile — all UX-only, per the security boundary already established in Phase 2.

### Changes Required:

#### 1. `AuthUser` gains `isAdmin`

**File**: `src/app/core/auth/auth.service.ts`

**Intent**: Mirror the backend's `/me` response shape so the rest of the app can read admin status off `currentUser()`.

**Contract**: `AuthUser` interface gains `isAdmin: boolean`. No other change — `checkSession()`/`login()`/`register()` already just deserialize whatever `/me`/`/login`/`/register` return.

Note: `/register` and `/login` responses don't include `isAdmin` today (Phase 2 only touched `/me`) — those two routes should also start returning it for type consistency, using the same `isAdminEmail` check, since `AuthUser` is shared across all three call sites and a `login()` response without `isAdmin` would leave `currentUser().isAdmin` `undefined` until the next `/me` call.

#### 2. Admin guard

**File**: `src/app/core/auth/admin.guard.ts` (new)

**Intent**: Block navigation to the admin route for non-admins, mirroring `auth.guard.ts`'s structure exactly.

**Contract**: `adminGuard: CanActivateFn` — `authService.currentUser()?.isAdmin ? true : router.createUrlTree(['/'])` (redirect home, not to `/login`, since this guard only matters for already-authenticated users — `authGuard` on the parent route already handles the unauthenticated case).

#### 3. Route

**File**: `src/app/app.routes.ts`

**Intent**: New lazy-loaded child route, guarded by both the existing `authGuard` (inherited from the parent) and the new `adminGuard`.

**Contract**: Add `{ path: 'admin', loadComponent: () => import('./features/admin/admin-panel').then((m) => m.AdminPanel), canActivate: [adminGuard] }` alongside the existing `history`/`history/triggers` children.

#### 4. Sidebar tile

**File**: `src/app/core/shell/shell.html`, `src/app/core/shell/shell.ts`

**Intent**: Show an "Admin" tile below the History section, only for admins.

**Contract**: `shell.ts` exposes `protected readonly isAdmin = computed(() => this.user()?.isAdmin ?? false);`. `shell.html` wraps a new `<a mat-list-item routerLink="/admin" ...>` block (same structure as the "Alerts" tile) in `@if (isAdmin())`, placed after the History section's closing `}`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Log in as the admin account (email in local `ADMIN_EMAILS`) → "Admin" tile visible in sidebar, `/admin` reachable
- Log in as a non-admin account → "Admin" tile absent, direct navigation to `/admin` redirects to `/`

---

## Phase 4: Frontend — admin panel UI

### Overview

Build the panel itself: instrument selection (reusing the S-07 combobox pattern) plus a date range, wired to the Phase 2 endpoint, with a result/error banner.

### Changes Required:

#### 1. Admin service

**File**: `src/app/features/admin/admin.service.ts` (new)

**Intent**: Thin HTTP wrapper for the new endpoint, matching the existing service pattern (e.g. `instruments.service.ts`).

**Contract**: `fetchMarketData(ticker: string, from: string, to: string): Observable<{ ticker: string; from: string; to: string; daysWritten: number }>` — `POST /api/admin/market-data`.

#### 2. Admin panel component

**File**: `src/app/features/admin/admin-panel.ts`, `admin-panel.html`, `admin-panel.scss` (new)

**Intent**: Category + instrument comboboxes exactly like `instrument-history.ts`/`.html` (same `InstrumentsService` injection, same `computed()` filtering pattern, same template structure), plus two native `<input type="date">` fields (from/to) and a submit button. On submit, calls `AdminService.fetchMarketData` and shows either a success banner with `daysWritten` or an inline error message.

**Contract**: Standalone component, `imports: [MatFormFieldModule, MatSelectModule, MatButtonModule, MatCardModule]` (no `DecimalPipe` needed here, unlike `instrument-history`). Signals: `selectedInstrumentType`, `instrumentOptions` (same computed pattern), `selectedTicker`, `fromDate`/`toDate` (plain signals bound via `[(ngModel)]` or reactive form — follow whichever binding style `instrument-history.ts` uses for its comboboxes, extended with two form fields for dates), `submitting`, `result` (`{ daysWritten: number } | null`), `submitError` (`string | null`). Submit button `disabled` while `submitting()` is true or the form is incomplete.

#### 3. i18n

**Files**: `src/locale/messages.xlf`, `src/locale/messages.pl.xlf`

**Intent**: All new user-facing strings need `i18n="@@key"` template attributes and matching English/Polish trans-units, per project convention.

**Contract**: New keys under an `adminPanel.*` namespace: `adminPanel.title`, `adminPanel.type.label`, `adminPanel.instrument.label`, `adminPanel.from.label`, `adminPanel.to.label`, `adminPanel.submit`, `adminPanel.result.success` (ICU or interpolated with `daysWritten`), `adminPanel.result.error`. Plus `shell.nav.admin` for the sidebar tile label. Run `npm run extract-i18n` after adding `i18n` attributes to regenerate `messages.xlf`, then hand-translate the new `<trans-unit>` entries into `messages.pl.xlf` (same process as every prior i18n addition this project).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Production build succeeds: `npm run build`
- Full CI passes: `npm run ci`

#### Manual Verification:

- As admin: open `/admin`, pick a category → instrument list filters correctly (same behavior as the Historia page)
- Pick a real instrument + a short recent date range → submit → success banner shows correct day count
- Verify via D1 (`npx wrangler d1 execute marketpulse-db --local --command "..."`) that `price_history` rows for that range were actually written/overwritten
- Submit an invalid range (e.g. `from` after `to`, or `to` in the future) → inline error shown, no request succeeds
- Confirm Polish translations render correctly (`npm start` runs `development-pl` config by default)

---

## Testing Strategy

### Unit Tests:

- `market-data.test.ts`: `fetchDailyCloses` builds the correct `period1`/`period2` URL for a given `from`/`to`; `upsertPriceHistory` produces the expected statement shape for a `DailyClose[]` input.
- `admin.test.ts` (new): full auth/validation/success/failure matrix listed in Phase 2's Automated Verification.
- `scheduled.test.ts`: existing tests continue to pass unmodified, confirming the cron's default-range behavior is unchanged.

### Integration Tests:

- None beyond the `vitest` + `@cloudflare/vitest-pool-workers` route tests already used throughout this codebase (real D1 test binding).

### Manual Testing Steps:

1. Log in as admin, confirm sidebar tile + route access; log in as non-admin, confirm both are hidden/blocked.
2. Submit a valid fetch for a recent short range; verify `price_history` rows and the success banner's day count.
3. Submit a fetch for an older range (e.g. 60 days back) covering dates not in the cron's normal window; verify those rows are written and `market_data` is untouched (compare `market_data.updated_at` before/after — must not change).
4. Submit an already-covered range (overlapping today's cron data) and confirm existing rows are overwritten with identical values (no duplicate rows, `ON CONFLICT` path exercised).
5. Try each validation failure (unknown ticker, from > to, future date, range > 730 days) and confirm a clear error, no partial writes.
6. Attempt the endpoint directly (`curl`) with a non-admin session cookie → confirm `403` and no data change.

## Performance Considerations

A 730-day range is ~500 trading days — one Yahoo fetch plus one `D1.batch()` of ~500 prepared statements. This is well within D1's per-batch statement limits and Workers' free-tier request-duration budget (this is I/O-bound waiting on the Yahoo fetch and D1 round-trip, not CPU-bound like the PBKDF2 hashing cap noted elsewhere in this project) — no chunking needed at this scale.

## Migration Notes

No D1 schema migration — `ADMIN_EMAILS` is an env var/secret, not a database column. Remote deploy needs one manual step: `wrangler secret put ADMIN_EMAILS` (human-run, per `CLAUDE.md`'s "destructive production actions are human-only" — this isn't destructive but follows the same "secrets are set by the human, not the agent" pattern already used for `RESEND_API_KEY`).

After this ships, `CLAUDE.md`'s Architecture section ("flat role model — each user manages only their own alerts") should be updated to note the admin exception — tracked as a Phase 2 follow-up note, not a separate phase, since it's a one-line doc edit alongside the code that introduces the exception.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-09
- Related gap this resolves: `context/archive/2026-08-02-daily-high-low-evaluation/` (S-08 plan-review F2, self-backfill window)
- Combobox pattern reused: `src/app/features/instrument-history/instrument-history.ts:28-101`, `.html:10-26`
- Upsert pattern extracted from: `src/worker/scheduled.ts:44-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — date-range fetch + shared upsert helper

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 7bbda44
- [x] 1.2 Worker tests pass: `npm run test:worker` — 7bbda44
- [x] 1.3 Existing scheduled-handler tests still pass unchanged: `npm run test:worker -- scheduled` — 7bbda44

#### Manual

- [x] 1.4 Real Yahoo period1/period2 request confirmed working via curl before starting Phase 2 — 7bbda44

### Phase 2: Backend — admin-gated fetch endpoint

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 3a6fb4a
- [x] 2.2 New route tests pass: `npm run test:worker -- admin` — 3a6fb4a
- [x] 2.3 Full worker suite still green: `npm run test:worker` — 3a6fb4a

#### Manual

- [x] 2.4 Admin curl request against local dev writes/overwrites price_history correctly with matching daysWritten — 3a6fb4a
- [x] 2.5 Same request from a non-admin session returns 403 — 3a6fb4a

### Phase 3: Frontend — routing, guard, sidebar visibility

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — 7ba2208
- [x] 3.2 Production build succeeds: `npm run build` — 7ba2208

#### Manual

- [x] 3.3 Admin account sees sidebar tile and can reach /admin — 7ba2208
- [x] 3.4 Non-admin account: tile absent, direct navigation to /admin redirects to / — 7ba2208

### Phase 4: Frontend — admin panel UI

#### Automated

- [x] 4.1 Typecheck passes: `npm run typecheck`
- [x] 4.2 Production build succeeds: `npm run build`
- [x] 4.3 Full CI passes: `npm run ci`

#### Manual

- [x] 4.4 Category → instrument combobox filtering works like the Historia page
- [x] 4.5 Valid submit shows success banner with correct day count
- [x] 4.6 D1 confirms price_history rows written/overwritten for the submitted range
- [x] 4.7 Invalid range shows inline error, no request succeeds
- [x] 4.8 Polish translations render correctly
