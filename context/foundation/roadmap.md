---
project: MarketPulse
version: 1
status: draft
created: 2026-06-21
updated: 2026-08-09
prd_version: 1
main_goal: low-complexity
top_blocker: skills
---

# Roadmap: MarketPulse

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline (confirmed 2026-06-21).
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Stock market alert platforms lock RSI-based alerts behind a paywall and limit free price alerts to 30-day windows, forcing users to reset them monthly or lose coverage. MarketPulse removes both restrictions: a user configures a threshold alert on VIX or NASDAQ-100 once, and the system sends an email notification on the day the condition is first met — with no expiry and no recurring manual action required. The target user is a retail investor who wants macro market context without daily chart-checking.

## North star

**S-02: User can create a price or RSI alert and see it in their alert list** — delivering this slice end-to-end proves that authentication, alert persistence, and the full user-facing CRUD layer work together. The market data pipeline (F-02 → S-04) and notification pipeline (S-05) are tackled immediately after.

> "North star" here means the smallest end-to-end slice whose successful delivery proves the core product structure works — placed as early as its prerequisites allow, because everything downstream only matters if this flow is solid.

## At a glance

| ID   | Change ID             | Outcome (user can …)                                      | Prerequisites  | PRD refs                        | Status   |
|------|-----------------------|-----------------------------------------------------------|----------------|---------------------------------|----------|
| F-01 | backend-scaffold      | (foundation) Hono Worker + D1 binding + users table       | —              | Access Control, NFR (isolation) | done     |
| F-01a | users-email-schema   | (foundation) users table: email as sole identifier        | F-01           | FR-001, FR-002                  | done     |
| F-02 | market-data-pipeline  | (foundation) cron fetches Stooq closes + calculates RSI   | F-01           | NFR (daily evaluation), BL      | done |
| S-01 | auth-and-registration | register, log in, and log out                             | F-01a          | FR-001, FR-002, FR-003          | done     |
| S-02 | alert-crud            | create a price/RSI alert and view the alert list          | S-01           | FR-004, FR-005                  | done     |
| S-03 | alert-edit-delete     | edit and delete an existing alert                         | S-02           | FR-006, FR-007                  | done     |
| F-03 | instrument-registry   | (foundation) `instruments` table + ticker migration + registry endpoint | S-02, F-02 | —                     | done |
| S-04 | market-data-display   | see current RSI/price value next to each alert; create an alert with instrument type + name (not raw ticker) | S-02, F-02, F-03 | FR-009 | done |
| S-07 | instrument-history-view | view 30-day price/RSI history for any instrument via two comboboxes | F-03 | —                    | done |
| S-05 | alert-notifications   | receive an email when an alert threshold is crossed       | S-04           | FR-008, FR-008a                 | done     |
| S-06 | trigger-history       | view a history of all previously triggered alerts         | S-05           | FR-010                          | done     |
| S-08 | daily-high-low-evaluation | get an alert notification even when the threshold was only crossed intraday, not at close | S-05      | FR-012                          | done     |
| S-09 | admin-panel            | (admin-only) manually fetch/backfill market data for a chosen instrument over a chosen date range | S-01, F-02, F-03 | —                       | done  |
| F-04 | stooq-provider-support | (foundation) fetch daily closes for a ticker from Stooq, as a second provider alongside Yahoo | F-02, F-03 | —                          | proposed |
| S-10 | admin-add-instrument   | (admin-only) add a new instrument to the registry — pick type (Index / Spółki PL / Spółki USA), enter ticker + company name | S-09, F-03 | —                          | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                       | Chain                               | Note                                                                            |
|--------|-----------------------------|-------------------------------------|---------------------------------------------------------------------------------|
| A      | Auth & alert CRUD           | `F-01` → `F-01a` → `S-01` → `S-02` → `S-03`  | Delivers the north star (S-02); S-03 is a refinement slice after it lands.      |
| B      | Data pipeline & notif.      | `F-02` → `F-03` → `S-04` → `S-05` → `S-06` → `S-08` | F-02 branches from F-01 parallel with S-01; S-04 joins Stream A at S-02; `F-03` also unlocks `S-07` (30-day history view), which runs parallel to S-04. `S-08` depends only on `S-05` and runs parallel to `S-06`. `S-09` crosses both streams — needs `S-01` (auth, Stream A) plus `F-02`/`F-03` (Stream B) — and can run any time after all three are done. |
| C      | Multi-provider instruments  | `F-03` → (`F-04` ∥ `S-10`, both also need `S-09`)   | `F-04` (Stooq fetch support) and `S-10` (admin add-instrument UI) are independent of each other — either can land first. `S-10` alone is usable for `type='us_stock'` instruments (Yahoo already fetches any US ticker); `type='pl_stock'` instruments added via `S-10` have no working fetch until `F-04` lands. |

## Baseline

What's already in place in the codebase as of 2026-06-21 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Angular 22 SPA scaffold; routes empty (`src/app/app.routes.ts:3`); live at `marketpulse.gogitams.workers.dev`
- **Backend / API:** absent — no Hono entry point; `wrangler.toml` serves SPA static assets only
- **Data:** absent — D1 declared in `wrangler.toml` but no schema, migrations, or DB client wired
- **Auth:** absent — no auth provider, JWT issuing/verification, or route guards
- **Deploy / infra:** present — Cloudflare native GitHub integration (not GitHub Actions); auto-deploy on PR (preview URL) and merge to main; app live at `marketpulse.gogitams.workers.dev`
- **Observability:** absent — `console.error()` only (`src/main.ts:6`); `wrangler tail` and Cloudflare dashboard logs available natively

## Foundations

### F-01: Backend scaffold

- **Outcome:** (foundation) Hono Worker entry point wired to D1 with the `users` table schema landed; Worker deploys to the Cloudflare Workers target alongside the Angular SPA.
- **Change ID:** `backend-scaffold`
- **PRD refs:** Access Control section (multi-user design, flat role model); NFR (user isolation — each user's data fully separated at the query level)
- **Unlocks:** S-01 (auth endpoints require the HTTP layer and the `users` table); F-02 (cron Worker needs the entry point); establishes the Workers deploy path used by all subsequent slices
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nothing can be deployed or exercised until this lands. Scope is deliberately minimal — a health-check route and a single table — so the first Workers deployment risk surfaces early rather than inside a large slice.
- **Status:** done

### F-01a: Users table schema — email as login identifier

- **Outcome:** (foundation) The `users` table uses `email` as the sole identifier and login credential. The separate `username` and `notification_email` columns are replaced by a single `email TEXT NOT NULL UNIQUE` column. A forward-only D1 migration (`0002_users_email_schema.sql`) applies the change to local and remote D1.
- **Change ID:** `users-email-schema`
- **PRD refs:** FR-001 (registration: email + password), FR-002 (login: email + password)
- **Unlocks:** S-01 (auth endpoints must match the finalised schema before any auth code is written)
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** F-01 migration (`0001_create_users.sql`) is already applied to production D1. The new migration must use `ALTER TABLE` or a shadow-table pattern — D1 does not support `DROP COLUMN` in all SQLite versions; verify support before writing the migration.
- **Status:** done

### F-02: Market data pipeline

- **Outcome:** (foundation) Cloudflare Cron Trigger fires daily, fetches closing prices for VIX and NASDAQ-100 from Stooq, stores raw closes in the `price_history` table, and writes the latest RSI to the `market_data` table for NASDAQ-100 (VIX alerts are price-only, per FR-004 — no RSI needed for VIX).
- **Change ID:** `market-data-pipeline`
- **PRD refs:** NFR (alert thresholds evaluated every calendar day — a missed evaluation is a core product failure); Business Logic section (daily closing data from Stooq; RSI derived from recent closes)
- **Unlocks:** S-04 (market-data-display needs current RSI/price in D1); S-05 (alert-notifications reads pre-computed RSI for threshold evaluation)
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - What is the exact Stooq bulk download URL and column format for VIX and NASDAQ-100, and does the format require a validation layer / circuit breaker? — Owner: user. Block: no (researchable during `/10x-plan`; resolve before writing the fetch layer).
- **Risk:** Stooq has no official API contract — endpoint URL, column names, and availability can change without notice. No cron retry on failure unless implemented in application code; a silently failing cron satisfies the NFR failure condition. CPU budget on the free Workers tier (10ms) may be tight; the $5/month paid tier raises this to 15 minutes and should be budgeted before production.
- **Status:** done

### F-03: Instrument registry

- **Outcome:** (foundation) `instruments` table (`ticker` PK, `name`, `type`, `rsi_eligible`, `provider`) replaces the hardcoded instrument lists scattered across the backend. A forward-only D1 migration seeds `^VIX` and `^NDX` and rewrites existing `price_history`, `market_data`, and `alerts` rows from `VIX`/`NASDAQ100` to the new ticker values (`ticker` is the value actually sent to the data provider, not an internal code). `GET /api/instruments` (optionally filtered by `type`) serves the registry to the frontend. The daily cron (`scheduled.ts`) and alert validation (`alerts.ts`) read from `instruments` instead of the hardcoded `YAHOO_SYMBOLS` map and `VALID_INSTRUMENTS`/`VALID_ALERT_TYPES` arrays.
- **Change ID:** `instrument-registry`
- **PRD refs:** — (internal refactor; instrument set stays VIX/NASDAQ-100, no PRD scope change)
- **Unlocks:** S-04 (edited scope needs instrument name/type/ticker from the registry); S-07 (history view needs the registry + endpoint)
- **Prerequisites:** S-02, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Renames the identifier used as the join key across three existing tables (`price_history.instrument`, `market_data.instrument`, `alerts.instrument`) from `VIX`/`NASDAQ100` to `^VIX`/`^NDX` — this is a data migration on existing rows, not just a new table. The existing `alerts` `CHECK` constraint (literal `'VIX'` match) must be replaced by an `rsi_eligible` lookup (or updated to the new literal `'^VIX'`) in the same migration, or existing alerts break.
- **Status:** done

### F-04: Stooq provider support

- **Outcome:** (foundation) A second market-data fetch path — alongside the existing Yahoo fetch in `src/worker/lib/market-data.ts` — retrieves daily closes (and high/low, per S-08) for a given ticker from Stooq. Dispatch is driven by `instruments.provider` (already `'yahoo'` for all current rows): instruments with `provider = 'stooq'` are fetched through the new path instead. The daily cron (`scheduled.ts`) and the admin backfill action (S-09) both call whichever provider the instrument row specifies, transparently. Ticker format contract (resolved): `instruments.ticker` must be the exact symbol Stooq's own history/quote endpoint accepts for that instrument — i.e. entering the ticker and querying Stooq for its history must work directly, with no separate symbol-mapping layer (same "ticker = the value sent to the provider" principle F-03 already established for Yahoo).
- **Change ID:** `stooq-provider-support`
- **PRD refs:** — (new provider integration; not yet reflected in an FR)
- **Unlocks:** S-10's `type='pl_stock'` instruments actually fetching data (S-10 itself does not require this to be built first — see Stream C)
- **Prerequisites:** F-02, F-03
- **Parallel with:** S-10
- **Blockers:** —
- **Unknowns:**
  - Exact Stooq bulk-download URL/column format for individual PL-listed (GPW) equities (not indices — F-02 established Stooq lacks VIX coverage, but per-stock GPW data was never verified). — Owner: user. Block: no (researchable during `/10x-plan`).
  - Does a PL-stock ticker need currency handling beyond the existing manual `instruments.currency` column, or does Stooq return values in a currency that needs conversion? — Owner: user. Block: no.
- **Risk:** Stooq has no official API contract (already noted as a risk on F-02) — this reintroduces that dependency, previously dropped when F-02 moved fully to Yahoo (VIX has no Stooq coverage). Scoping this to non-index equities only avoids re-litigating that decision. Needs the same "raw close + high/low → `price_history`" write shape as the Yahoo path so downstream code (RSI calc, alert evaluation) doesn't need to branch on provider.
- **Status:** proposed

## Slices

### S-01: User can register and log in

- **Outcome:** User can register with an email address and password; log in with email and password; log out. Unauthenticated requests to any protected route are rejected.
- **Change ID:** `auth-and-registration`
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** F-01a
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Which password hashing library works in the Workers V8 runtime without native modules? (`bcrypt` requires native bindings; candidates: `bcryptjs`, Web Crypto API PBKDF2, Argon2 via WASM.) — Owner: user. Block: no (researchable during `/10x-plan`; the choice affects implementation, not whether planning can start).
- **Risk:** First Angular reactive forms + JWT issuing in the Workers V8 runtime — the runtime is not Node.js and native npm packages behave differently. A bug in auth here propagates to every downstream slice. The `nodejs_compat` compatibility flag must be set in `wrangler.toml` (documented in `context/foundation/infrastructure.md`).
- **Status:** done

### S-02: User can create a price or RSI alert and view the alert list ★ north star

- **Outcome:** User can create an alert by selecting an instrument (VIX or NASDAQ-100), alert type, and threshold value; VIX supports price alerts only, NASDAQ-100 supports price or RSI alerts. The notification email field is pre-filled from the user's account email but is editable per alert. Created alerts appear in a persistent list.
- **Change ID:** `alert-crud`
- **PRD refs:** FR-004, FR-005
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Introduces the `alerts` table and its forward-only D1 migration. RSI threshold type requires input validation on the frontend (range 0–100) but no backend RSI calculation yet — that lands in S-04/S-05. RSI is only a valid alert type for NASDAQ-100 (see FR-004 rationale in `prd.md`) — VIX must restrict the form to price alerts only, and the `alerts` table constraint should enforce the same at the persistence layer. First multi-field Angular form beyond auth.
- **Status:** done

### S-03: User can edit and delete an alert

- **Outcome:** User can update the instrument, alert type, threshold value, or notification email on an existing alert; user can permanently delete an alert.
- **Change ID:** `alert-edit-delete`
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward CRUD extension of S-02; no new external dependencies. Safe to run in parallel with S-04.
- **Status:** done

### S-04: User can see current RSI/price value next to each alert

- **Outcome:** Each alert in the list displays the current RSI value (for RSI-type alerts) or the latest closing price (for price-type alerts) alongside the user's threshold — allowing the user to see how close the condition is to being triggered. The alert creation/edit form additionally gains a "type" selector (instrument category — currently only "index"; GPW company added later) that filters the instrument field, and the instrument field itself displays the instrument's name (e.g. "NASDAQ-100") instead of its raw ticker (`^NDX`). Alert details additionally show the underlying ticker.
- **Change ID:** `market-data-display`
- **PRD refs:** FR-009
- **Prerequisites:** S-02, F-02, F-03
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Serves as a smoke test for the full data pipeline before notifications go live — if values are correct here, Stooq fetch + RSI calculation are verified end-to-end without involving Resend. Depends on both the Angular alert list (S-02) and market data in D1 (F-02); both must be done before this slice can start. The type selector, name display, and ticker field additionally depend on the `instruments` registry (F-03).
- **Status:** done

### S-07: User can view 30-day price/RSI history for any instrument

- **Outcome:** A dedicated page lets the user pick an instrument type and a specific instrument via two comboboxes (populated from `GET /api/instruments`, the second filtered by the first) and view that instrument's closing price and RSI for each of the last 30 days.
- **Change ID:** `instrument-history-view`
- **PRD refs:** — (new browsing capability; not yet reflected in an FR — the current PRD only specifies "current value next to alert", FR-009/S-04)
- **Prerequisites:** F-03
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Price data already exists in `price_history` from the daily cron, but RSI here must be computed per-day across a rolling 30-day window — the existing `rsi.ts` only returns a single latest value, so this is new calculation logic, not reuse.
- **Status:** done

### S-05: User receives an email notification when an alert threshold is crossed

- **Outcome:** The cron job reads pre-computed RSI and latest closes from the `market_data` table, evaluates all active alerts against the current values, and sends an email via Resend to each alert's designated address when the threshold condition is met. Each trigger event is recorded in the `trigger_events` table.
- **Change ID:** `alert-notifications`
- **PRD refs:** FR-008, FR-008a
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Only external dependency at this point is Resend — Stooq and RSI are already validated by S-04. No retry logic on cron failure unless explicitly implemented — per NFR, a missed evaluation is a core product failure. The Resend SDK requires `nodejs_compat` flag (documented in `infrastructure.md`). **Threshold-crossing detection**: data is sampled once daily, so price can jump past a threshold between two closes (e.g. price 10 → 12 with threshold 11) — evaluating with exact equality (`price === threshold`) would almost never fire. Evaluation must use a directional inequality (`price >= threshold` / `price <= threshold`) instead. The `alerts` schema also has no direction field (only `threshold`), and FR-008 just says "when crossed" without specifying direction — direction should be inferred at alert creation from the relationship between the current price and the chosen threshold (price below threshold → "up" alert; price above → "down" alert) rather than adding a form field. Firing also needs a "already triggered" state (e.g. via `trigger_events`) so the alert doesn't re-fire every day the price stays past the threshold.
- **Status:** done

### S-06: User can view a history of triggered alerts

- **Outcome:** User can see a chronological log of previously triggered alerts showing timestamp, instrument, alert type, and the index value at the time the threshold was crossed.
- **Change ID:** `trigger-history`
- **PRD refs:** FR-010
- **Prerequisites:** S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward read from the `trigger_events` table introduced in S-05. Low risk; if the `trigger_events` schema changes during S-05 implementation, this slice needs to adjust accordingly.
- **Status:** done

### S-08: Price alerts fire on the daily high/low, not only the close

- **Outcome:** Price-type alerts on VIX and NASDAQ-100 fire when the daily high or low crosses the threshold, not only when the closing price does. Example: threshold 100 ("up" alert), price rises to 102 intraday, closes at 99 — today this never fires; after this slice it fires. RSI alerts are unaffected (RSI is inherently derived from closes).
- **Change ID:** `daily-high-low-evaluation`
- **PRD refs:** FR-012, Business Logic (Inputs)
- **Prerequisites:** S-05
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Not real intraday polling — the daily Yahoo Finance chart-API response already returns `high`/`low` in the same once-a-day fetch that supplies `close` (`src/worker/lib/market-data.ts`); `YahooChartResult` just doesn't type or read them yet. Needs: `high`/`low` columns added to `price_history` (currently `close`-only, `migrations/0006_create_price_history.sql`), the fetch/parse layer extended to store them, and `alert-evaluation.ts`'s `conditionMet` updated to compare against `high` for "up" alerts / `low` for "down" alerts instead of `close`. Keep this clearly distinct from the parked "Intraday or real-time alerts" item below — evaluation frequency and data source are unchanged.
- **Status:** done

### S-09: Admin can manually fetch/backfill market data for an instrument over a date range

- **Outcome:** An administrator — identified by an `ADMIN_EMAILS` allowlist stored as an environment variable / secret (remote secret; `.dev.vars` locally), not a DB-backed role — sees an additional sidebar tile below "Historia", opening a panel visible only to them. The panel has one action to start: pick a category and an instrument via the same two-combobox pattern as the instrument history page (F-03/S-07), pick a date range (from–to), and fetch. `fetchDailyCloses` moves from its current fixed lookback window to an explicit `from`/`to` date-range parameter; the daily cron calls it with its existing default range (today − 30 days, today) so cron behavior is unchanged, and the admin panel passes whatever range the admin selects — which can be wider than the cron's window (e.g. 90 days back). Fetched rows overwrite existing `price_history`/`market_data` rows for those dates via the same `ON CONFLICT DO UPDATE` pattern the cron already uses — same ticker, same source, same parsing, so this is a superset/refresh of cron data, never conflicting or incorrect data. Framed as extensible: more admin actions land in this panel later.
- **Change ID:** `admin-panel`
- **PRD refs:** — (new admin-only capability; not yet reflected in an FR)
- **Prerequisites:** S-01, F-02, F-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First authorization tier beyond the flat "each user manages only their own alerts" model documented in `CLAUDE.md` — that doc needs updating alongside this slice. `ADMIN_EMAILS` living in env/secret (not a DB table) means adding/removing an admin requires a redeploy or secret update, not a UI action — deliberate minimal choice for a single-action admin panel. Reshaping `fetchDailyCloses`'s signature touches the existing cron call site — must verify the default `from`/`to` values reproduce today's cron behavior exactly. Directly resolves the "self-backfill window" gap flagged during `S-08` plan review (44-day RSI lookback vs. the cron's ~21-trading-day fetch) by giving a way to manually backfill deeper history.
- **Status:** done

### S-10: Admin can add a new instrument to the registry

- **Outcome:** In the admin panel, an admin can add a new instrument via a form with five fields: a **type** combobox (`Indeks` — the existing type; `Spółki PL`; `Spółki USA`), a **ticker** text field, a **company name** text field, a **currency** text field, and an **RSI-eligible** checkbox (checked by default). Type selection drives `provider` automatically — `Spółki PL` → `stooq`, `Spółki USA` → `yahoo`, `Indeks` → `yahoo` (existing `Indeks` instruments keep `provider = 'yahoo'`, unchanged). `rsi_eligible` is an explicit checkbox rather than inferred from type — unlike `provider`, it can't be derived from `type` alone, since the two existing `index` rows already disagree (`^VIX` is not RSI-eligible, `^NDX` is); the checkbox defaults to checked, since VIX is expected to remain the only non-RSI-eligible instrument in this project. Currency is admin-entered (not inferred) because `instruments.currency` is `NOT NULL` with no safe type-based default — a `Spółki PL` instrument denominated in PLN would otherwise silently default to `'USD'`. Ticker must be entered in the exact format the instrument's provider expects for that ticker's own history (same contract as F-04's ticker-format decision) — the admin is trusted to enter the correct provider symbol; the form validates non-empty, not provider-specific syntax. The new row is written to the `instruments` table and immediately available wherever the registry is already consumed: instrument history (S-07), alert creation (S-02/S-04), and admin backfill (S-09). `type='pl_stock'` instruments have no working data fetch until F-04 lands — see Stream C.
- **Change ID:** `admin-add-instrument`
- **PRD refs:** — (new admin-only capability; not yet reflected in an FR)
- **Prerequisites:** S-09, F-03
- **Parallel with:** F-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Extends the `instruments` table's `type` CHECK constraint from `CHECK (type IN ('index'))` (`migrations/0008_instrument_registry.sql`) to include `'pl_stock'`/`'us_stock'` — same shadow-table migration pattern already used for SQLite CHECK/UNIQUE changes in this repo (`migrations/0008_instrument_registry.sql`, `migrations/0011_alert_notifications.sql`). Internal type values (`pl_stock`/`us_stock`) deliberately diverge from the Polish UI labels (`Spółki PL`/`Spółki USA`) and from provider names (`stooq`/`yahoo`) — code/comments stay English per `CLAUDE.md`, only the rendered combobox label is Polish. Because `provider` is inferred from `type` (not admin-chosen), that type → provider mapping is a business rule baked into this slice — if a third provider ever shows up, this slice's logic (not just the schema) needs revisiting. This slice also fixes an unrelated inconsistency surfaced during its own planning: two incompatible admin/write error-response shapes existed in the backend (`admin.ts`'s `{error, code}` vs `alerts.ts`'s `{error}` + string-matching) — `alerts.ts` and its frontend consumer are migrated to the same `{error, code}` convention as part of this slice, since the new endpoint needed to pick one.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID             | Suggested issue title                               | Ready for `/10x-plan` | Notes                                                              |
|------------|-----------------------|-----------------------------------------------------|-----------------------|--------------------------------------------------------------------|
| F-01       | backend-scaffold      | Backend scaffold: Hono Worker + D1 + users table    | yes                   | Run `/10x-plan backend-scaffold`                                   |
| F-01a      | users-email-schema    | Users table: email as sole identifier (drop username)| yes                  | Shadow-table migration applied (0002_users_email_schema.sql); schema confirmed on local + remote D1 |
| F-02       | market-data-pipeline  | Market data pipeline: cron + Stooq + RSI → D1      | no                    | Awaits F-01; can be planned in parallel with S-01                  |
| S-01       | auth-and-registration | Auth: register (email+password), login, logout      | no                    | Awaits F-01a; research password hashing in Workers during planning |
| S-02       | alert-crud            | Alert CRUD: create alert + list view (north star)   | no                    | Awaits S-01                                                        |
| S-03       | alert-edit-delete     | Alert management: edit and delete                   | no                    | Awaits S-02; can be planned in parallel with S-04                  |
| F-03       | instrument-registry   | Instrument registry: instruments table + ticker migration + GET /api/instruments | no | Awaits S-02 + F-02; migrates existing `VIX`/`NASDAQ100` values to `^VIX`/`^NDX` |
| S-04       | market-data-display   | Market data display: current RSI/price on alert list + instrument-aware alert form | no | Awaits S-02 + F-02 + F-03                                |
| S-07       | instrument-history-view | Instrument history view: 30-day price/RSI page    | no                    | Awaits F-03; can be planned in parallel with S-04                  |
| S-05       | alert-notifications   | Notification pipeline: alert eval + Resend email    | no                    | Awaits S-04; Stooq/RSI already validated by then                   |
| S-06       | trigger-history       | Trigger history: list of fired alerts               | no                    | Awaits S-05                                                        |
| S-08       | daily-high-low-evaluation | Price alerts: evaluate against daily high/low, not just close | no       | Awaits S-05 (done); Yahoo response already carries high/low, needs parsing + schema + evaluation change |
| S-09       | admin-panel            | Admin panel: manual market-data fetch/backfill for an instrument + date range | yes | Awaits S-01, F-02, F-03 (all done); run `/10x-plan admin-panel` |
| F-04       | stooq-provider-support | Stooq provider: fetch daily closes (+ high/low) for a ticker from Stooq | yes | Awaits F-02, F-03 (both done); run `/10x-plan stooq-provider-support` |
| S-10       | admin-add-instrument   | Admin panel: add a new instrument (type combobox + ticker + name)  | yes | Awaits S-09, F-03 (both done); run `/10x-plan admin-add-instrument`; open naming/rsi_eligible unknowns worth a quick confirm before planning |

## Open Roadmap Questions

1. **User stories (Given/When/Then) not written** — the PRD flags this as an open question. Functional Requirements are sufficient for roadmap sequencing and `/10x-plan`; user stories are a documentation gap, not a planning blocker for any specific slice. — Owner: user. Block: no (roadmap-wide documentation debt).

## Parked

- **Additional instruments beyond VIX and NASDAQ-100 (FR-011)** — Why parked: PRD §Non-Goals; expanding the instrument set before the 2-instrument loop is proven working is premature.
- **Additional indicator types beyond price and RSI** — Why parked: PRD §Non-Goals; MACD, Bollinger Bands, and volume-based indicators are post-MVP scope.
- **Push notifications, SMS, webhooks** — Why parked: PRD §Non-Goals; email is the core value; additional channels add integration complexity without validating it.
- **Intraday or real-time alerts** — Why parked: PRD §Non-Goals; requires a paid real-time data source and a fundamentally different architecture.

## Done

- **F-01: (foundation) Hono Worker entry point wired to D1 with the `users` table schema landed; Worker deploys to the Cloudflare Workers target alongside the Angular SPA.** — Archived 2026-06-28 → `context/archive/2026-06-26-backend-scaffold/`. Lesson: —.
- **F-01a: (foundation) The `users` table uses `email` as the sole identifier and login credential.** — Archived 2026-06-28 → `context/archive/2026-06-28-users-email-schema/`. Lesson: —.
- **S-01: User can register with an email address and password; log in with email and password; log out. Unauthenticated requests to any protected route are rejected.** — Archived 2026-07-14 → `context/archive/2026-07-14-auth-and-registration/`. Lesson: —.
- **S-02: User can create an alert by selecting an instrument (VIX or NASDAQ-100), alert type, and threshold value; VIX supports price alerts only, NASDAQ-100 supports price or RSI alerts. The notification email field is pre-filled from the user's account email but is editable per alert. Created alerts appear in a persistent list.** — Archived 2026-07-19 → `context/archive/2026-07-19-alert-crud/`. Lesson: —.
- **F-02: (foundation) Cloudflare Cron Trigger fires daily, fetches closing prices for VIX and NASDAQ-100 from Stooq, stores raw closes in the `price_history` table, and writes the latest RSI to the `market_data` table for NASDAQ-100 (VIX alerts are price-only, per FR-004 — no RSI needed for VIX).** — Archived 2026-07-24 → `context/archive/2026-07-24-market-data-pipeline/`. Lesson: —.
- **S-03: User can update the instrument, alert type, threshold value, or notification email on an existing alert; user can permanently delete an alert.** — Archived 2026-07-24 → `context/archive/2026-07-24-alert-edit-delete/`. Lesson: —.
- **F-03: (foundation) `instruments` table (`ticker` PK, `name`, `type`, `rsi_eligible`, `provider`) replaces the hardcoded instrument lists scattered across the backend. A forward-only D1 migration seeds `^VIX` and `^NDX` and rewrites existing `price_history`, `market_data`, and `alerts` rows from `VIX`/`NASDAQ100` to the new ticker values (`ticker` is the value actually sent to the data provider, not an internal code). `GET /api/instruments` (optionally filtered by `type`) serves the registry to the frontend. The daily cron (`scheduled.ts`) and alert validation (`alerts.ts`) read from `instruments` instead of the hardcoded `YAHOO_SYMBOLS` map and `VALID_INSTRUMENTS`/`VALID_ALERT_TYPES` arrays.** — Archived 2026-07-25 → `context/archive/2026-07-25-instrument-registry/`. Lesson: —.
- **S-04: Each alert in the list displays the current RSI value (for RSI-type alerts) or the latest closing price (for price-type alerts) alongside the user's threshold. The alert creation/edit form gains a type selector that filters the instrument field, and the instrument field displays the instrument's name instead of its raw ticker. Alert details additionally show the underlying ticker.** — Archived 2026-07-25 → `context/archive/2026-07-25-market-data-display/`. Lesson: —.
- **S-07: A dedicated page lets the user pick an instrument type and a specific instrument via two comboboxes (populated from `GET /api/instruments`, the second filtered by the first) and view that instrument's closing price and RSI for each of the last 30 days.** — Archived 2026-07-26 → `context/archive/2026-07-26-instrument-history-view/`. Lesson: —.
- **S-05: The cron job reads pre-computed RSI and latest closes from the `market_data` table, evaluates all active alerts against the current values, and sends an email via Resend to each alert's designated address when the threshold condition is met. Each trigger event is recorded in the `trigger_events` table.** — Archived 2026-07-31 → `context/archive/2026-07-31-alert-notifications/`. Lesson: —.
- **S-06: User can see a chronological log of previously triggered alerts showing timestamp, instrument, alert type, and the index value at the time the threshold was crossed.** — Archived 2026-07-31 → `context/archive/2026-07-31-trigger-history/`. Lesson: —.
- **S-08: Price-type alerts on VIX and NASDAQ-100 fire when the daily high or low crosses the threshold, not only when the closing price does. Example: threshold 100 ("up" alert), price rises to 102 intraday, closes at 99 — today this never fires; after this slice it fires. RSI alerts are unaffected (RSI is inherently derived from closes).** — Archived 2026-08-02 → `context/archive/2026-08-02-daily-high-low-evaluation/`. Lesson: —.
- **S-09: An administrator — identified by an `ADMIN_EMAILS` allowlist stored as an environment variable / secret — sees an additional sidebar tile below "Historia", opening a panel visible only to them. The panel lets an admin pick a category and an instrument via the same two-combobox pattern as the instrument history page (F-03/S-07), pick a date range (from–to), and fetch. `fetchDailyCloses` moves from its fixed lookback window to an explicit `from`/`to` date-range parameter; the daily cron keeps its existing default range (today − 30 days, today) unchanged. Fetched rows overwrite existing `price_history` rows for those dates (deliberately never `market_data`, to avoid regressing the "current value" alerts are evaluated against). Framed as extensible: more admin actions can land in this panel later.** — Archived 2026-08-02 → `context/archive/2026-08-02-admin-panel/`. Lesson: —.
