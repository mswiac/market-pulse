# Instrument History View (S-07) Implementation Plan

## Overview

Add a dedicated, routed page where a user picks an instrument type and a specific instrument via two comboboxes, then sees that instrument's closing price and RSI for each of the last 30 days in a table. Reachable from a new dropdown menu in the app toolbar.

## Current State Analysis

- `price_history` (`ticker`, `date`, `close`, unique on `(ticker, date)`) is written daily by `scheduled.ts` but has no read endpoint today — `alerts.ts` and `instruments.ts` only touch `instruments`/`market_data`.
- `calculateRSI()` in `src/worker/lib/rsi.ts` computes Wilder's RSI but returns only the latest scalar value; it discards the running averages needed to know RSI on any earlier day. There is no existing series-producing variant.
- `instruments.rsi_eligible` already flags `^VIX` as `0` (never has RSI) and `^NDX` as `1` — this is the same flag alert-form and the RSI-eligibility triggers (migration `0009`) already use, so history's "hide RSI for non-eligible instruments" behavior is consistent with the rest of the app.
- Production `price_history` currently holds ~21-22 rows per ticker (2026-06-24 → 2026-07-23) — fewer than the ~44 days (30 display + 14 RSI lookback) needed for a fully-populated 30-day RSI series. The feature must degrade gracefully, not assume full history exists.
- No frontend route is "real" yet: `app.routes.ts` only has `''` (home), `register`, `login`. `AlertList` is embedded directly in `Home`; `AlertForm` opens as a `MatDialog`. This change adds the app's first genuinely routed feature page.
- `InstrumentsService` (`src/app/features/instruments/instruments.service.ts`) already caches the instrument registry and exposes `types`/`instruments` signals; `AlertForm` already implements the exact two-combobox (type → instrument) filtering UX this feature needs, entirely client-side over the cached list.
- Neither `mat-table` nor `mat-menu` is used anywhere in the frontend yet (`alert-list` uses `mat-expansion` cards) — both are first uses, but both are standard Angular Material modules already available via `@angular/material`.

## Desired End State

A user can open a menu from the toolbar, choose "Instrument history", land on `/history`, pick an instrument type and instrument, and see a table of the last available days (up to 30) with date, closing price, and — only for RSI-eligible instruments — RSI. Verify by: logging in, opening the menu, navigating to the page, switching between `^VIX` and `^NDX`, and confirming the RSI column appears only for `^NDX`.

### Key Discoveries:

- `src/worker/lib/rsi.ts:1-31` — `calculateRSI` computes via a simple-mean seed over the first `period` changes, then Wilder's smoothing for the rest; the fix is to make the smoothing loop itself record every intermediate value rather than only the last.
- `src/worker/routes/instruments.ts:9` — `sessionMiddleware` is already applied at the router level, so a new route added to the same router is authenticated for free.
- `src/worker/index.ts:16-18` — new API routes must be registered before the `app.get('*', ...)` SPA-fallback catch-all at line 25.
- `src/app/features/alerts/alert-form/alert-form.ts:56-59` — the exact `computed()`-based client-side type→instrument filter this feature reuses.

## What We're NOT Doing

- No new instrument types or changes to the `instruments.type` CHECK constraint.
- No admin panel and no trigger/alert-history page (S-06) — the new toolbar menu is structured to hold future entries, but only the one "Instrument history" item is built now.
- No charting library or visual chart — table display only, per the "no new dependency" decision.
- No backfilling or seeding of historical `price_history` data — the page displays whatever the daily cron has already accumulated.
- No date-range picker, pagination, or configurable window size — fixed most-recent-30-days.
- No caching layer on the new endpoint — data volume (2 instruments, ≤44 rows each) doesn't warrant it.

## Implementation Approach

Backend-first: extend the RSI library to produce a full per-day series (Phase 1), expose it through a new nested route on the existing authenticated `instruments` router (Phase 2), then build the frontend page and its toolbar entry point, reusing the alert-form's proven type→instrument filtering pattern (Phase 3).

## Critical Implementation Details

- **RSI lookback windowing**: the endpoint must fetch `30 + 14 = 44` days of `price_history` (not just 30) so the RSI value for the *earliest displayed* day can be computed — RSI at index `i` needs `period` prior closes. Rows come back from SQL ordered however the query specifies; they must be re-ordered strictly oldest→newest before feeding `calculateRSISeries`, then the resulting series is sliced back down to the last 30 entries for display. Getting this ordering wrong silently produces a reversed or garbage RSI series without throwing.

## Phase 1: RSI series calculation

### Overview

Extend `src/worker/lib/rsi.ts` so Wilder's smoothing produces a value for every input day, not just the last, while keeping `calculateRSI`'s existing single-value contract and output unchanged for current callers (`scheduled.ts`).

### Changes Required:

#### 1. RSI series function

**File**: `src/worker/lib/rsi.ts`

**Intent**: Extract the existing smoothing loop into a new `calculateRSISeries(closes, period = 14)` that returns one `number | null` per input close (index-aligned with `closes`), `null` wherever fewer than `period + 1` closes are available up to that index. Reimplement `calculateRSI` as a thin wrapper that returns the last entry of that series, so both functions share one code path and existing behavior for `calculateRSI` is unchanged.

**Contract**: `calculateRSISeries(closes: number[], period?: number): (number | null)[]` — same length as `closes`; index `i` holds the RSI as of `closes[i]` (or `null` if `i < period`). `calculateRSI` keeps its current signature (`number | null`) and existing test expectations must still pass unmodified.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker`

#### Manual Verification:

- None for this phase — pure library logic, fully covered by automated tests.

---

## Phase 2: Instrument history endpoint

### Overview

Add `GET /api/instruments/:ticker/history` returning the last 30 days of `{date, close, rsi}` for a ticker, computed with the lookback buffer from Phase 1's series function.

### Changes Required:

#### 1. History route

**File**: `src/worker/routes/instruments.ts`

**Intent**: Add a new `GET /:ticker/history` handler on the existing `instrumentsRoutes` router (inherits `sessionMiddleware` auth already applied at the router level). Look up the ticker in `instruments`; 404 if unknown. Query the last 44 rows from `price_history` for that ticker ordered newest-first, reverse to oldest-first, compute the RSI series (only when `rsi_eligible`), zip `{date, close, rsi}` per day, then keep only the last 30 entries.

**Contract**: Response body `{ ticker: string, rsiEligible: boolean, history: Array<{ date: string; close: number; rsi: number | null }> }`, status 200. Unknown ticker → `{ error: 'unknown instrument' }`, status 404. `history` is ordered oldest→newest and has at most 30 entries (fewer if less history exists yet); `rsi` is `null` for every entry when `rsiEligible` is `false`, and also `null` for entries still inside the 14-day lookback ramp-up even when `rsiEligible` is `true`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker` (new tests in `test/worker/instruments.test.ts`: unknown ticker → 404; `^VIX` → `rsiEligible: false` and every `rsi` is `null`; `^NDX` with seeded price_history → `rsiEligible: true` and `rsi` populated once enough lookback rows exist; unauthenticated request → 401; result has at most 30 entries even when more than 44 rows exist; result count matches available rows when fewer than 30 exist)

#### Manual Verification:

- `curl` (or browser fetch while logged in) against `/api/instruments/^NDX/history` and `/api/instruments/^VIX/history` on local dev returns sane, correctly-ordered data matching what's in local D1's `price_history`.

---

## Phase 3: Frontend history page and navigation

### Overview

Build the routed `/history` page (two comboboxes + table) and add a toolbar dropdown menu entry point to reach it.

### Changes Required:

#### 1. History HTTP service

**File**: `src/app/features/instrument-history/instrument-history.service.ts` (new)

**Intent**: Thin `@Injectable({ providedIn: 'root' })` service exposing `getHistory(ticker: string): Observable<InstrumentHistoryResponse>` that calls `GET /api/instruments/${ticker}/history`, matching `InstrumentsService`'s injection style (`inject(HttpClient)`).

**Contract**: `InstrumentHistoryResponse { ticker: string; rsiEligible: boolean; history: { date: string; close: number; rsi: number | null }[] }` — mirrors the Phase 2 endpoint response exactly.

#### 2. History page component

**File**: `src/app/features/instrument-history/instrument-history.ts` (new), `instrument-history.html` (new), `instrument-history.scss` (new)

**Intent**: Standalone component reusing `InstrumentsService.ensureLoaded()`/`types`/`instruments` exactly as `AlertForm` does, but with plain signals instead of `ReactiveFormsModule` (this page has no form to submit — just two filters), since it's a read-only browsing view rather than a data-entry form. On instrument selection, call `InstrumentHistoryService.getHistory()` and render a `mat-table` with `date`/`close` columns always, plus a `rsi` column only when the loaded response's `rsiEligible` is `true`. Show a caption noting how many of the last 30 days are actually available (e.g. "Showing 22 of last 30 days") whenever fewer than 30 rows come back.

**Contract**: Selector `app-instrument-history`; component class `InstrumentHistory` (matches the existing no-`Component`-suffix naming of `Home`, `AlertList`, `AlertForm`). Signals: `selectedInstrumentType`, `selectedTicker`, `instrumentOptions` (computed, filtered like `alert-form.ts:57-59`), `history`, `rsiEligible`, `loadError` (instruments failed to load), `historyError` (history fetch failed). `displayedColumns` computed from `rsiEligible`.

#### 3. Route registration

**File**: `src/app/app.routes.ts`

**Intent**: Add a lazy-loaded route for the new page, guarded the same way `''` (home) is.

**Contract**: `{ path: 'history', loadComponent: () => import('./features/instrument-history/instrument-history').then((m) => m.InstrumentHistory), canActivate: [authGuard] }`, inserted before the `**` wildcard redirect.

#### 4. Toolbar navigation menu

**File**: `src/app/features/home/home.ts`, `src/app/features/home/home.html`

**Intent**: Replace the current bare toolbar (logout button only) with a `mat-menu` dropdown (first use in the app) containing one item, "Instrument history", linking to `/history`. Structure it as a generic menu now so future entries (trigger history once S-06 ships, an eventual admin panel) can be appended as additional `mat-menu-item` entries later — but build only this one entry.

**Contract**: `home.ts` adds `MatMenuModule` and `RouterLink` to its `imports` array. `home.html` adds a menu-trigger icon button (`mat-icon-button` + `matMenuTriggerFor`) to the existing `mat-toolbar`, and a `<mat-menu>` with one `<a mat-menu-item routerLink="/history">` entry, alongside the existing logout button (not replacing it).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Production build succeeds: `npm run build`
- Full CI script passes: `npm run ci`

#### Manual Verification:

- Log in, open the toolbar menu, click "Instrument history", land on `/history`.
- Select type "Index", then `^NDX` — table shows date/close/RSI rows, most recent day last or first (confirm ordering reads naturally), RSI populated for rows with enough lookback.
- Switch to `^VIX` — RSI column disappears entirely; only date/close remain.
- Confirm the "Showing N of last 30 days" caption appears and matches the actual row count when fewer than 30 days exist.
- Refresh directly on `/history` (not via in-app navigation) — page loads correctly (route guard + lazy-load work on direct navigation).
- Log out and try navigating directly to `/history` — redirected to `/login`.

---

## Testing Strategy

### Unit Tests:

- `calculateRSISeries`: matches `calculateRSI`'s existing reference values at the last index; returns `null` for indices before enough lookback; full-length array output.
- History endpoint: 404 for unknown ticker, 401 unauthenticated, correct `rsiEligible` per instrument, correct `null`/populated RSI split across the lookback ramp-up, correct truncation to 30 entries, correct partial-history behavior (fewer than 30 rows available).

### Integration Tests:

- None beyond the existing `@cloudflare/vitest-pool-workers` integration-style tests in `test/worker/instruments.test.ts` (full HTTP round-trip via `exports.default.fetch`), which already cover auth + response shape for this router.

### Manual Testing Steps:

1. Run `npm run migrate:local` if not already applied (no new migration in this change, but confirms local D1 is current).
2. `npm run worker:dev` and `npm start` (or however local dev is normally run) — log in, exercise the full navigation → history page → instrument switch flow described in Phase 3's Manual Verification.

## Performance Considerations

Each history request reads at most 44 rows from D1 and computes RSI over at most 44 closes — negligible cost at current data volume (2 instruments). No pagination or caching needed at this scale.

## Migration Notes

No database migration required — `instruments` and `price_history` already have every column this feature reads.

## References

- Roadmap: `context/foundation/roadmap.md` — S-07
- Related pattern: `src/app/features/alerts/alert-form/alert-form.ts:56-59` (type→instrument client-side filter)
- Related pattern: `src/worker/routes/alerts.ts:163-166` (route param validation / 404 style)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: RSI series calculation

#### Automated

- [x] 1.1 Type checking passes: npm run typecheck
- [x] 1.2 Worker unit tests pass: npm run test:worker

### Phase 2: Instrument history endpoint

#### Automated

- [ ] 2.1 Type checking passes: npm run typecheck
- [ ] 2.2 Worker unit tests pass: npm run test:worker (new instrument-history endpoint tests)

#### Manual

- [ ] 2.3 curl/browser fetch against /api/instruments/^NDX/history and /api/instruments/^VIX/history on local dev returns correctly-ordered data

### Phase 3: Frontend history page and navigation

#### Automated

- [ ] 3.1 Type checking passes: npm run typecheck
- [ ] 3.2 Production build succeeds: npm run build
- [ ] 3.3 Full CI script passes: npm run ci

#### Manual

- [ ] 3.4 Log in, open toolbar menu, navigate to /history via "Instrument history" entry
- [ ] 3.5 Select ^NDX — table shows date/close/RSI, ordering reads naturally, RSI populated where lookback allows
- [ ] 3.6 Switch to ^VIX — RSI column disappears entirely
- [ ] 3.7 "Showing N of last 30 days" caption appears and matches actual row count
- [ ] 3.8 Direct refresh on /history works correctly
- [ ] 3.9 Logged out, direct navigation to /history redirects to /login
