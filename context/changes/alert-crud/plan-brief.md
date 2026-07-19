# Alert CRUD (S-02) — Plan Brief

> Full plan: `context/changes/alert-crud/plan.md`
> Research: `context/changes/alert-crud/research.md`

## What & Why

Implement the roadmap's north-star slice: a logged-in user can create a price or RSI alert on VIX or NASDAQ-100 and see it in a persistent list. This is the first slice that exercises the full stack (D1 schema → Hono API → Angular UI) beyond auth, and proves the alert-management flow that every downstream slice (edit/delete, market-data display, notifications, trigger history) builds on.

## Starting Point

Only auth (S-01) exists today. `Home` is a placeholder — a toolbar with logout plus a card saying "Alert management is coming soon." No `alerts` table, no alert-related routes, no alert UI. The session middleware, D1 binding, and component/service conventions from S-01 are all reused as-is.

## Desired End State

After login, the user lands on `/` and sees their alert list (empty on first visit). A "New alert" button opens a modal form — instrument, alert type, threshold, and a notification email pre-filled from the account but editable. On submit, the alert appears at the top of the list immediately, with inline validation for out-of-range thresholds and a visible error for duplicate alerts.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Instrument/type wire values | `'VIX'`/`'NASDAQ100'`, `'PRICE'`/`'RSI'` | Alphanumeric-only, avoids any future URL/filename friction | Plan (user Q&A) |
| DB-level constraints | Application-layer validation only, no `CHECK` | Matches existing convention — `users`/`sessions` use only `NOT NULL`/`UNIQUE`/`FK` | Plan (user Q&A) |
| Threshold rules | RSI 0–100 inclusive (decimals ok), price > 0 (decimals ok) | Matches how RSI and index prices actually behave as continuous values | Plan (user Q&A) |
| Duplicate alerts | Rejected via `UNIQUE(user_id, instrument, alert_type, threshold)` → 409 | Prevents accidental duplicate notifications later (S-05) | Plan (user Q&A) |
| Creation UI | `MatDialog` modal on the list page | User keeps list context; no navigation away | Plan (user Q&A) |
| Navigation shell | None — single page, no sidebar yet | Sidebar/history nav belongs to S-06; building it now is scope creep | Plan (user Q&A) |
| List placement | Replaces `Home`'s placeholder content | User's own description: land on the alerts page right after login | Plan (user Q&A) |
| Backend test depth | Exhaustive (validation, duplicates, boundaries, malformed body, isolation) | User-isolation is the highest-risk correctness point per research | Plan (user Q&A) |

## Scope

**In scope:**
- `alerts` table migration
- `POST`/`GET /api/alerts`, scoped to the authenticated user
- Alert list view (replacing the `Home` placeholder)
- Alert creation dialog with client + server validation

**Out of scope:**
- Edit/delete (S-03), current RSI/price display (S-04/F-02), notifications (S-05), trigger history (S-06)
- Any side-nav/shell layout
- DB-level `CHECK` constraints
- Instruments/indicators beyond VIX, NASDAQ-100, price, RSI

## Architecture / Approach

Standard layering already established by S-01: migration → Hono route module (`src/worker/routes/alerts.ts`, inline D1 queries, manual validation, `sessionMiddleware` reused unchanged) → Angular service (`AlertsService`, signal-based state mirroring `AuthService`) → Angular components (`alert-list`, `alert-form`, both standalone + Material, mirroring `login`/`register`). SQL column aliases (`alert_type AS alertType`) produce camelCase JSON directly, avoiding a mapping layer.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database schema | `alerts` table + migration | Missing `ON DELETE CASCADE` (already missed once on `sessions`) |
| 2. Backend API | Create + list endpoints, exhaustive tests | User-isolation bug (manual `WHERE user_id` scoping, no structural guard) |
| 3. Frontend service + list | Alerts render on the home page | None significant — read-only, mirrors existing patterns closely |
| 4. Frontend creation dialog | End-to-end create flow | First `MatDialog` usage in the codebase; conditional threshold validators need re-evaluation on type change |

**Prerequisites:** S-01 (done). No new dependencies — `@angular/cdk` (for `MatDialog`) is already installed.
**Estimated effort:** ~1 session across 4 phases; each phase is small and independently verifiable.

## Open Risks & Assumptions

- Cross-user isolation is enforced entirely by remembering to add `WHERE user_id = ?` in every query — there is no DB-level or framework-level guard. The exhaustive Phase 2 test suite is the primary safety net; worth double-checking during implementation review.
- No DB `CHECK` constraints means a future out-of-band script or migration could insert invalid `instrument`/`alert_type`/`threshold` data undetected — acceptable at current scale per the app-layer-only decision.

## Success Criteria (Summary)

- A user can create a valid alert and see it in their list without a page reload.
- Invalid thresholds and duplicate alerts are rejected with a visible, understandable error.
- A second user never sees the first user's alerts.
