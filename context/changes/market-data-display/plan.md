# S-04: Market Data Display Implementation Plan

## Overview

Show each alert's current price (or RSI, for RSI-type alerts) next to its threshold, and repair the alert creation/edit form so it selects instruments through the `instruments` registry (type → name) instead of the raw ticker literals the frontend still hardcodes. This closes the frontend breakage F-03 deliberately left open: the backend already speaks `ticker`/`^VIX`/`^NDX`, but `alerts.service.ts`, `alert-form.ts`, `alert-list.ts`, and `delete-alert-confirm` still speak `instrument`/`VIX`/`NASDAQ100`.

## Current State Analysis

- **The frontend is currently broken against the backend.** F-03's migration renamed `alerts.instrument` → `alerts.ticker` (values `^VIX`/`^NDX`), and `alerts.ts` now validates via `lookupTicker(db, body.ticker)`. But `alerts.service.ts`'s `Alert`/`CreateAlertPayload` interfaces, `alert-form.ts`'s form group and submit payload, `alert-list.ts`'s `INSTRUMENT_LABELS` map, and `delete-alert-confirm.ts`'s data shape all still use `instrument: 'VIX' | 'NASDAQ100'`. This was an explicitly accepted regression during F-03, expected to be fixed here.
- **No endpoint exposes `market_data` today.** `GET /api/alerts` (`src/worker/routes/alerts.ts:107-117`) returns only alert columns — no price, no RSI, no instrument name.
- **`GET /api/instruments` (`src/worker/routes/instruments.ts`) deliberately returns only `{ ticker, name, type }`** — F-03 omitted `rsi_eligible` and `provider` as "internal routing/validation details, no current consumer needs them client-side." That consumer now exists: the alert form must know whether a selected instrument supports RSI to show/hide the RSI option, the way it does today via a hardcoded `instrument !== 'VIX'` check (`alert-form.ts:86`).
- **`instruments.type` is `CHECK`-constrained to `'index'` only** (`migrations/0008_instrument_registry.sql`) — there is no second type in the database yet. A GPW-company type is a future, unplanned migration.
- **Every table needed already has the right columns.** `market_data(ticker, price, rsi, updated_at)` and `instruments(ticker, name, type, rsi_eligible, provider)` already exist post-F-03 — this change needs no schema migration, only query and response-shape changes.
- **D1/SQLite's `INSERT ... RETURNING` / `UPDATE ... RETURNING` cannot reference joined tables** — only columns of the table being written. `alerts.ts`'s `POST`/`PUT` handlers currently build their JSON response directly from the `RETURNING` clause (`ALERT_ROW_COLUMNS`); once the response needs `instruments`/`market_data` columns too, those handlers must pair the write with a joined `SELECT` — via `env.DB.batch()` (see Critical Implementation Details), not a sequential `RETURNING id` + separate re-`SELECT`.
- **`test/worker/instruments.test.ts` pins the response shape to exactly 3 keys** (`Object.keys(instrument).sort()` → `['name', 'ticker', 'type']`). Adding `rsiEligible` is a deliberate, expected break of that assertion, not accidental scope creep.

## Desired End State

- `GET /api/alerts` (and the `POST`/`PUT` response bodies) return, per alert: `id, ticker, instrumentName, instrumentType, alertType, threshold, notificationEmail, createdAt, updatedAt, currentPrice, currentRsi` — `currentPrice`/`currentRsi` are `null` when `market_data` has no row yet for that ticker (before the first cron run, or a provider outage).
- `GET /api/instruments` additionally returns `rsiEligible` (aliased from `rsi_eligible`) alongside the existing `ticker`/`name`/`type`.
- The alert form presents a **type** select (today: a single "Index" option, sourced from the distinct types the registry actually returns — not hardcoded) that filters an **instrument** select showing instrument **names** (e.g. "NASDAQ-100"), not raw tickers. The RSI alert-type option is shown/hidden based on the selected instrument's `rsiEligible`, not a hardcoded ticker literal.
- The alert list's expanded detail panel shows the real current price (all alerts) and current RSI (RSI-type alerts only), falling back to the existing "No data" text when the value is `null`, plus a new line showing the alert's underlying ticker. The collapsed summary row is unchanged (still instrument / alert type / threshold), now reading `instrumentName` instead of looking it up in a hardcoded map.
- Verify via: `npm run test:worker`, `npm run typecheck`, `npm run build` all pass; manual exercise of create/edit/list/delete against local dev confirms the type→instrument cascade, RSI gating, and current-value display all work end to end.

### Key Discoveries

- `alerts.ts`'s existing `lookupTicker()` (`SELECT ticker, rsi_eligible FROM instruments WHERE ticker = ?`) already validates instrument existence and RSI eligibility server-side — Phase 1 only changes what the *response* includes, not the validation logic.
- `scheduled.test.ts` already demonstrates the pattern for seeding `market_data` rows directly via `env.DB` inside a test (`test/worker/scheduled.test.ts`) — Phase 1's new alerts test that exercises a non-null `currentPrice`/`currentRsi` follows the same pattern.
- The existing `showRsiOption()` / instrument-reset wiring in `alert-form.ts` (`instrument === 'VIX'` checks in the constructor's `valueChanges` subscriptions) is the exact logic that needs generalizing from a hardcoded ticker literal to a registry-driven `rsiEligible` lookup — the reactive-forms shape (subscribe, reset validators, reset value) stays the same.

## What We're NOT Doing

- No database migration — every column this plan reads or exposes already exists post-F-03.
- Not adding a second instrument type (GPW company) or its ingestion pipeline — `instruments.type` stays `CHECK`-constrained to `'index'`; the type selector is built to already support a second type once one exists, but shows exactly one option today.
- Not distinguishing "not yet available" (no cron run yet) from "temporarily unavailable" (provider outage) in the UI — both render the existing generic "No data" text.
- Not adding a "data as of `<date>`" timestamp next to the current price/RSI.
- Not changing the alert list's collapsed summary-row layout — current price/RSI stay inside the expandable detail panel only, per user decision.
- Not building S-07's 30-day history view or S-05's email notifications — separate roadmap slices that will consume this same registry/market-data plumbing later.
- Not adding a `type` query-param call from the frontend to `GET /api/instruments` — the new `InstrumentsService` fetches the full (unfiltered) registry once and caches it in a signal, matching `alerts.service.ts`'s/`auth.service.ts`'s established pattern; per-type filtering happens client-side via `computed()`. The backend's `?type=` filter (built in F-03) stays as-is for other/future consumers.

## Implementation Approach

Two phases, mirroring F-03's backend-then-frontend split — each leaves the app in a working, fully-tested state:

1. **Backend response shape** — extend `GET/POST/PUT /api/alerts` to join `instruments`/`market_data`, and extend `GET /api/instruments` with `rsiEligible`. Backward compatible in the sense that no currently-working consumer breaks (the frontend is already broken pre-Phase-1, per F-03's accepted regression) — but it's real code + test churn, and phase boundary alone justifies keeping it separate from the frontend rewrite.
2. **Frontend repair + registry-driven form** — fix the four broken files and build the type→instrument cascading select, consuming the shape Phase 1 now serves.

## Critical Implementation Details

- **`RETURNING` can't join, and two sequential round-trips aren't atomic.** Both `alerts.ts`'s `POST` and `PUT` handlers must change from a single `INSERT/UPDATE ... RETURNING <columns>` to a joined re-`SELECT`. Plan review (F4) rejected a naive `RETURNING id` → separate awaited `SELECT` (a non-atomic two-round-trip window: the write could succeed while the second call fails) in favor of `env.DB.batch([writeStmt, selectStmt])`, matching the `batch()` primitive `scheduled.ts` already uses — both statements are fully bindable ahead of time (from the request body or path param, not a returned id), so batching them needs no chicken-and-egg workaround. Introduce one shared SQL fragment (see Phase 1 §1) instead of duplicating the join three times.
- **Extending `GET /api/instruments`'s response breaks a currently-passing, intentionally-strict test** (`Object.keys(instrument).sort()` pinned to 3 keys). This is expected — update the test alongside the route change in the same commit, not as an afterthought.
- **Async instrument-list loading changes the form's initial-render story, but only for the one underlying fetch.** Today, `instrument`/`alertType` options are static arrays known synchronously at form construction. After this change, the full instrument registry arrives asynchronously via `InstrumentsService.ensureLoaded()` (called once, cached in a signal for the app's lifetime — see Phase 2 §2). Because `instrumentOptions` is a `computed()` filtering that cached signal by a locally-tracked `selectedInstrumentType` signal (not a second network fetch per type), there's no ordering hazard to manage: `selectedInstrumentType` is initialized synchronously from `data?.alert?.instrumentType ?? ''` at construction (same as the form control), and `instrumentOptions`/`showRsiOption()` simply resolve correctly whenever `ensureLoaded()`'s underlying HTTP call resolves — no eager-fetch-in-constructor trick needed.
- **`InstrumentsService`'s signal cache invalidates the earlier per-type-fetch decision.** Plan review (F3) revised the original design (a fresh `GET /api/instruments?type=` request on every type change) to a single unfiltered fetch cached in a signal, filtered client-side via `computed()` — chosen for consistency with `alerts.service.ts`/`auth.service.ts`'s established signal-cache pattern, and as a side effect this also removes the per-type-change network round-trip.

## Phase 1: Backend — join instrument/market data into alert responses

### Overview

`GET/POST/PUT /api/alerts` return instrument name/type and current price/RSI alongside each alert; `GET /api/instruments` additionally returns `rsiEligible`. No schema changes — only query and response-shape changes, plus the corresponding test updates.

### Changes Required:

#### 1. Alerts route: joined response shape

**File**: `src/worker/routes/alerts.ts`

**Intent**: Replace the single-table `ALERT_ROW_COLUMNS` `RETURNING` shape with a shared joined `SELECT` (alerts × instruments × market_data) used by `GET` directly, and by `POST`/`PUT` via `env.DB.batch()` (since `RETURNING` cannot reference joined tables, and a separate sequential re-`SELECT` after `RETURNING id` would create a non-atomic two-round-trip window — plan-review F4). Validation logic (`lookupTicker`, `normalizeAlertType`, `validateThreshold`, the `rsi_eligible` guard) is unchanged.

**Contract**:

```sql
-- ALERT_SELECT (shared fragment)
SELECT
  a.id,
  a.ticker,
  i.name AS instrumentName,
  i.type AS instrumentType,
  a.alert_type AS alertType,
  a.threshold,
  a.notification_email AS notificationEmail,
  a.created_at AS createdAt,
  a.updated_at AS updatedAt,
  m.price AS currentPrice,
  m.rsi AS currentRsi
FROM alerts a
JOIN instruments i ON i.ticker = a.ticker
LEFT JOIN market_data m ON m.ticker = a.ticker
```

- `GET /`: `${ALERT_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`.
- `POST /`: run `env.DB.batch([insertStmt, selectStmt])` — `insertStmt` is `INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email) VALUES (?, ?, ?, ?, ?)` (no `RETURNING` needed); `selectStmt` is `${ALERT_SELECT} WHERE a.user_id = ? AND a.ticker = ? AND a.alert_type = ? AND a.threshold = ?`. Both statements bind values already known from the validated request body — neither depends on the other's result — so `batch()` (the same primitive `scheduled.ts` already uses for its own multi-statement writes) executes them as one atomic unit. Return the select result's first row with `201`. The existing `UNIQUE` catch branch wraps the whole `batch()` call, unchanged in behavior.
- `PUT /:id`: same shape — `env.DB.batch([updateStmt, selectStmt])`, both filtered by the same known `id` + `user_id` (from the path param and session, not a returned value). If the select result has no row, return `404` — this covers both "alert doesn't exist" and "belongs to another user" identically to today's `RETURNING`-based null check, since a non-matching `id`/`user_id` pair yields zero rows from both statements. Otherwise return that row with `200`. The `UNIQUE` catch branch is unchanged.
- `LEFT JOIN market_data` (not `JOIN`) so alerts for a ticker with no market data yet still appear, with `currentPrice`/`currentRsi` as `null`.
- Delete the now-unused `ALERT_ROW_COLUMNS` constant. No separate `fetchAlertById` helper is needed — `ALERT_SELECT` is inlined with the appropriate `WHERE` clause at each of the three call sites.

#### 2. Instruments route: add `rsiEligible`

**File**: `src/worker/routes/instruments.ts`

**Intent**: Serve `rsi_eligible` (aliased to camelCase, matching the rest of the API's aliasing convention) alongside the existing three fields.

**Contract**: Both branches' `SELECT` become `SELECT ticker, name, type, rsi_eligible AS rsiEligible FROM instruments ...` (filtered or unfiltered, as today).

#### 3. Test updates: alerts

**File**: `test/worker/alerts.test.ts`

**Intent**: Update existing assertions to expect the new fields; add one new test exercising a non-null join result.

**Contract**:
- Every `toMatchObject`/`toEqual` assertion on a created/listed/updated alert gains `instrumentName`/`instrumentType` matching the ticker used (`'VIX'`/`'index'` for `^VIX`, `'NASDAQ-100'`/`'index'` for `^NDX`) and `currentPrice: null, currentRsi: null` (no test in this file seeds `market_data`).
- New test: seed a `market_data` row directly via `env.DB` (mirroring the pattern in `test/worker/scheduled.test.ts`) for a ticker, create an alert for that ticker, and assert `GET /api/alerts` returns the seeded `price`/`rsi` as `currentPrice`/`currentRsi` for that alert.

#### 4. Test updates: instruments

**File**: `test/worker/instruments.test.ts`

**Intent**: Update the response-shape assertion and expected payloads to include `rsiEligible`.

**Contract**: The exact-key-set assertion becomes `['name', 'rsiEligible', 'ticker', 'type']`; the `arrayContaining` expected objects become `{ ticker: '^VIX', name: 'VIX', type: 'index', rsiEligible: 0 }` and `{ ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: 1 }`.

### Success Criteria:

#### Automated Verification:

- Worker unit tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Against local dev (`npm run worker:dev`), `curl` `GET /api/alerts` with a session cookie for a user with at least one alert, and confirm `instrumentName`/`instrumentType`/`currentPrice`/`currentRsi` are present (seed a `market_data` row locally first to see a non-null value)
- `curl` `GET /api/instruments` and confirm `rsiEligible` is present (`0` for `^VIX`, `1` for `^NDX`)

**Implementation Note**: After this phase's automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Frontend — repair ticker fields + registry-driven form

### Overview

Fix the four frontend files still speaking `instrument`/`VIX`/`NASDAQ100`, add an `InstrumentsService`, and rebuild the alert form's instrument selection as a type→name cascade backed by the registry, with RSI-option visibility driven by `rsiEligible` instead of a hardcoded ticker check.

### Changes Required:

#### 1. Alerts service: field rename + new fields

**File**: `src/app/features/alerts/alerts.service.ts`

**Intent**: Match the Phase 1 response shape.

**Contract**: `Alert` interface: rename `instrument` → `ticker`; add `instrumentName: string`, `instrumentType: string`, `currentPrice: number | null`, `currentRsi: number | null`. `CreateAlertPayload`: rename `instrument` → `ticker`. No method signatures change.

#### 2. New instruments service

**File**: `src/app/features/instruments/instruments.service.ts` (new)

**Intent**: Signal-based cache mirroring `AlertsService`'s/`AuthService`'s established pattern (plan-review F3) — the full instrument registry is fetched once per app session and reused; per-type filtering is a `computed()` over the cached signal rather than a fresh request per type.

**Contract**:

```ts
export interface Instrument {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: number;
}

@Injectable({ providedIn: 'root' })
export class InstrumentsService {
  private readonly http = inject(HttpClient);

  private readonly _instruments = signal<Instrument[]>([]);
  readonly instruments = this._instruments.asReadonly();
  readonly types = computed(() => [...new Set(this._instruments().map((i) => i.type))]);

  private loaded = false;

  ensureLoaded(): Observable<Instrument[]> {
    if (this.loaded) return of(this._instruments());
    return this.http.get<Instrument[]>('/api/instruments').pipe(
      tap((instruments) => {
        this._instruments.set(instruments);
        this.loaded = true;
      }),
    );
  }
}
```

#### 3. Alert form: type→instrument cascade

**File**: `src/app/features/alerts/alert-form/alert-form.ts`

**Intent**: Replace the hardcoded `<mat-option>` pair and the `instrument !== 'VIX'` RSI-visibility check with a registry-driven type select that filters an instrument select, and RSI-option visibility driven by the selected instrument's `rsiEligible`.

**Contract**:
- Inject `InstrumentsService`. Add `protected readonly selectedInstrumentType = signal(this.data?.alert?.instrumentType ?? '')` (tracks the type select's current value reactively, since a `computed()` can't read a `FormControl` directly), `protected readonly instrumentTypes = this.instrumentsService.types` (re-exposes the service's computed signal), `protected readonly instrumentOptions = computed(() => this.instrumentsService.instruments().filter((i) => i.type === this.selectedInstrumentType()))`, and `protected readonly loadError = signal(false)` (mirrors `alert-list.ts`'s existing `loadError` pattern for the same class of failure — a fetch supporting the view, not the submit action, failing).
- Form group: replace the `instrument` control with `instrumentType` (initial value `data?.alert?.instrumentType ?? ''`) and `ticker` (initial value `data?.alert?.ticker ?? ''`), both `Validators.required`.
- Constructor, on top of the existing subscriptions:
  - Call `instrumentsService.ensureLoaded()` once. On error, set `loadError.set(true)`. On success (or if already cached, since `ensureLoaded()` is idempotent), if not in edit mode and `instrumentType` is still unset, set it to `instrumentTypes()[0]` — this in turn flows into `instrumentOptions()` automatically since it's derived from the now-populated cache, no separate "populate instrumentOptions" step needed.
  - `this.form.controls.instrumentType.valueChanges.subscribe((type) => { this.selectedInstrumentType.set(type); ... })`: keeps `selectedInstrumentType` in sync, then — only when the user has actually changed the type away from the alert's original (not on programmatic initial set, which doesn't fire `valueChanges` anyway) — selects the first instrument in the newly filtered `instrumentOptions()` and resets `alertType` to `'PRICE'` if that instrument isn't `rsiEligible`.
  - Generalize the existing `ticker`-driven reset: when `ticker` changes, look up the new instrument's `rsiEligible` in `instrumentOptions()`; if falsy and `alertType` is currently `'RSI'`, reset `alertType` to `'PRICE'` (replaces the `instrument === 'VIX'` check).
- `showRsiOption()`: `return !!this.instrumentOptions().find((i) => i.ticker === this.form.controls.ticker.value)?.rsiEligible;` (defaults to `false` while the cache hasn't loaded yet).
- `onSubmit()`: payload becomes `{ ticker, alertType, threshold, notificationEmail }` — `instrumentType` is a client-side filter aid, not sent to the backend.

#### 4. Alert form template: type + instrument selects

**File**: `src/app/features/alerts/alert-form/alert-form.html`

**Intent**: Add a type `mat-select` above the instrument `mat-select`; both driven by the new signals instead of static `<mat-option>` literals.

**Contract**: Type select: `@for (type of instrumentTypes(); track type)` with a small display-label lookup (`{ index: $localize`:@@alertForm.instrumentType.index:Index` }`, falling back to the raw value for an unknown future type) — mirrors the existing `ALERT_TYPE_LABELS` pattern. Instrument select: `@for (instrument of instrumentOptions(); track instrument.ticker)`, option `[value]="instrument.ticker"` displaying `instrument.name`. When `loadError()` is `true`, show a message (new i18n id, e.g. `@@alertForm.error.instrumentsLoadFailed`) in place of the selects and disable the submit button — mirrors `alert-list.ts`'s `@if (loadError()) { ... } @else { ... }` gating.

#### 5. Alert list: drop hardcoded labels, use real data

**File**: `src/app/features/alerts/alert-list/alert-list.ts`

**Intent**: Remove the hardcoded instrument-label map now that the backend serves the display name directly; simplify RSI-detail gating; sort by the displayed name.

**Contract**: Delete `INSTRUMENT_LABELS` and `instrumentLabel()`. `SortableColumn` becomes `'instrumentName' | 'alertType' | 'threshold'`. `showCurrentRsi(alertType: string): boolean` drops the `instrument` parameter — becomes `return alertType === 'RSI';` (an RSI-type alert can only exist for an `rsi_eligible` ticker, enforced at creation/update time). `deleteAlert()` builds `DeleteAlertConfirmData` using `alert.instrumentName` directly.

#### 6. Alert list template: real values + ticker line

**File**: `src/app/features/alerts/alert-list/alert-list.html`

**Intent**: Bind real `currentPrice`/`currentRsi` instead of static "No data" placeholders; add a ticker line to the detail panel; summary row reads `instrumentName` directly.

**Contract**: Summary row: `{{ alert.instrumentName }}` (was `{{ instrumentLabel(alert.instrument) }}`). Detail panel: `@if (alert.currentPrice !== null) { {{ alert.currentPrice | number: '1.2-2' }} } @else { <span i18n="@@alertList.detail.noData">No data</span> }`, same pattern for `currentRsi` gated by `showCurrentRsi(alert.alertType)`; add `<p><strong i18n="@@alertList.detail.ticker">Ticker:</strong> {{ alert.ticker }}</p>`.

#### 7. Delete confirm: rename field

**File**: `src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts`

**Intent**: Match the renamed source field.

**Contract**: `DeleteAlertConfirmData.instrument` → `instrumentName`.

#### 8. Delete confirm template: use renamed field

**File**: `src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.html`

**Intent**: Match the renamed field.

**Contract**: `{{ data.instrument }}` → `{{ data.instrumentName }}`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Frontend build succeeds: `npm run build`

#### Manual Verification:

- Create a new PRICE alert via the type→instrument cascade in local dev; confirm the correct `ticker` is sent and the instrument name (not raw ticker) displays in the list
- Create a new RSI alert for NASDAQ-100; confirm the RSI option is hidden for a non-`rsiEligible` instrument and shown for an `rsiEligible` one
- Edit an existing alert; confirm the type/instrument/threshold fields preselect correctly and the RSI option's visibility matches the current instrument
- Confirm the alert list's detail panel shows current price/RSI (or "No data" when `market_data` has no row) and the new ticker line
- Delete an alert; confirm the confirmation dialog shows the instrument name correctly
- Simulate an instruments-fetch failure while the form is open (e.g. stop the local worker mid-session or block the request in devtools); confirm the form shows an error message and disables submission instead of leaving two empty selects

**Implementation Note**: After this phase's automated verification passes, pause here for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- `GET /api/alerts` returns `instrumentName`/`instrumentType`/`currentPrice`/`currentRsi`, with the latter two `null` when no `market_data` row exists and populated when one does
- `POST`/`PUT /api/alerts` responses carry the same joined shape as `GET` (via the `env.DB.batch()` write + re-select)
- `GET /api/instruments` includes `rsiEligible` matching each seeded instrument's actual eligibility

### Integration Tests:

- None beyond the existing `vitest-pool-workers` worker test suite — no new integration surface beyond what's covered above. Frontend has no unit tests (`skipTests: true` project-wide); frontend correctness is verified via `typecheck` + `build` + the manual steps above.

### Manual Testing Steps:

1. `curl` `GET /api/alerts` and `GET /api/instruments` locally, with and without seeded `market_data`, to confirm the joined fields (Phase 1).
2. Full create/edit/list/delete cycle through the rebuilt form and list in local dev, covering both a PRICE alert on a non-RSI-eligible instrument and an RSI alert on an RSI-eligible one (Phase 2).

## Performance Considerations

None beyond existing patterns — `instruments` and `market_data` each have 2 rows today; the added joins are trivial single-digit-row operations, comparable in cost to the existing per-request session lookup.

## Migration Notes

None — this change requires no D1 migration. Every column read or exposed here (`market_data.price/rsi`, `instruments.rsi_eligible`) already exists in the schema landed by F-02/F-03.

## References

- Roadmap: `context/foundation/roadmap.md` (S-04: `market-data-display`)
- PRD: FR-009 ("User can view the current index value alongside each alert on the list")
- Prior joined-response and phase-split precedent: `context/archive/2026-07-25-instrument-registry/plan.md` (F-03)
- Endpoint this change extends: `src/worker/routes/instruments.ts`, `test/worker/instruments.test.ts` (F-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend — join instrument/market data into alert responses

#### Automated

- [x] 1.1 Worker unit tests pass: `npm run test:worker`
- [x] 1.2 Type checking passes: `npm run typecheck`

#### Manual

- [ ] 1.3 `curl` confirms `GET /api/alerts` returns instrumentName/instrumentType/currentPrice/currentRsi correctly
- [ ] 1.4 `curl` confirms `GET /api/instruments` includes rsiEligible

### Phase 2: Frontend — repair ticker fields + registry-driven form

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Frontend build succeeds: `npm run build`

#### Manual

- [ ] 2.3 Create a PRICE alert via the type→instrument cascade; correct ticker sent, name displayed
- [ ] 2.4 Create an RSI alert; RSI option correctly shown/hidden per instrument eligibility
- [ ] 2.5 Edit an existing alert; fields preselect correctly
- [ ] 2.6 Alert list detail panel shows current price/RSI (or No data) and ticker
- [ ] 2.7 Delete an alert; confirmation dialog shows instrument name correctly
- [ ] 2.8 Instruments-fetch failure shows an error and disables submission (no empty selects)
