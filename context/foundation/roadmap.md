---
project: MarketPulse
version: 1
status: draft
created: 2026-06-21
updated: 2026-07-24
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
| S-04 | market-data-display   | see current RSI/price value next to each alert            | S-02, F-02     | FR-009                          | proposed |
| S-05 | alert-notifications   | receive an email when an alert threshold is crossed       | S-04           | FR-008, FR-008a                 | proposed |
| S-06 | trigger-history       | view a history of all previously triggered alerts         | S-05           | FR-010                          | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                       | Chain                               | Note                                                                            |
|--------|-----------------------------|-------------------------------------|---------------------------------------------------------------------------------|
| A      | Auth & alert CRUD           | `F-01` → `F-01a` → `S-01` → `S-02` → `S-03`  | Delivers the north star (S-02); S-03 is a refinement slice after it lands.      |
| B      | Data pipeline & notif.      | `F-02` → `S-04` → `S-05` → `S-06`  | F-02 branches from F-01 parallel with S-01; S-04 joins Stream A at S-02.       |

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

- **Outcome:** Each alert in the list displays the current RSI value (for RSI-type alerts) or the latest closing price (for price-type alerts) alongside the user's threshold — allowing the user to see how close the condition is to being triggered.
- **Change ID:** `market-data-display`
- **PRD refs:** FR-009
- **Prerequisites:** S-02, F-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Serves as a smoke test for the full data pipeline before notifications go live — if values are correct here, Stooq fetch + RSI calculation are verified end-to-end without involving Resend. Depends on both the Angular alert list (S-02) and market data in D1 (F-02); both must be done before this slice can start.
- **Status:** proposed

### S-05: User receives an email notification when an alert threshold is crossed

- **Outcome:** The cron job reads pre-computed RSI and latest closes from the `market_data` table, evaluates all active alerts against the current values, and sends an email via Resend to each alert's designated address when the threshold condition is met. Each trigger event is recorded in the `trigger_events` table.
- **Change ID:** `alert-notifications`
- **PRD refs:** FR-008, FR-008a
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Only external dependency at this point is Resend — Stooq and RSI are already validated by S-04. No retry logic on cron failure unless explicitly implemented — per NFR, a missed evaluation is a core product failure. The Resend SDK requires `nodejs_compat` flag (documented in `infrastructure.md`). **Threshold-crossing detection**: data is sampled once daily, so price can jump past a threshold between two closes (e.g. price 10 → 12 with threshold 11) — evaluating with exact equality (`price === threshold`) would almost never fire. Evaluation must use a directional inequality (`price >= threshold` / `price <= threshold`) instead. The `alerts` schema also has no direction field (only `threshold`), and FR-008 just says "when crossed" without specifying direction — direction should be inferred at alert creation from the relationship between the current price and the chosen threshold (price below threshold → "up" alert; price above → "down" alert) rather than adding a form field. Firing also needs a "already triggered" state (e.g. via `trigger_events`) so the alert doesn't re-fire every day the price stays past the threshold.
- **Status:** proposed

### S-06: User can view a history of triggered alerts

- **Outcome:** User can see a chronological log of previously triggered alerts showing timestamp, instrument, alert type, and the index value at the time the threshold was crossed.
- **Change ID:** `trigger-history`
- **PRD refs:** FR-010
- **Prerequisites:** S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward read from the `trigger_events` table introduced in S-05. Low risk; if the `trigger_events` schema changes during S-05 implementation, this slice needs to adjust accordingly.
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
| S-04       | market-data-display   | Market data display: current RSI/price on alert list| no                    | Awaits S-02 + F-02                                                 |
| S-05       | alert-notifications   | Notification pipeline: alert eval + Resend email    | no                    | Awaits S-04; Stooq/RSI already validated by then                   |
| S-06       | trigger-history       | Trigger history: list of fired alerts               | no                    | Awaits S-05                                                        |

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
