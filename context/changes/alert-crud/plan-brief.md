# Alert CRUD (S-02) — Plan Brief

> Full plan: `context/changes/alert-crud/plan.md`
> Research: `context/changes/alert-crud/research.md`

## What & Why

Implement the roadmap's north-star slice: a logged-in user can create a price or RSI alert on VIX or NASDAQ-100 and see it in a persistent list. **RSI is valid for NASDAQ-100 only — VIX is price-only** (PRD FR-004, updated 2026-07-19). This is the first slice that exercises the full stack (D1 schema → Hono API → Angular UI) beyond auth, and proves the alert-management flow that every downstream slice (edit/delete, market-data display, notifications, trigger history) builds on.

## Starting Point

Only auth (S-01) exists today. `Home` is a placeholder — a toolbar with logout plus a card saying "Alert management is coming soon." No `alerts` table, no alert-related routes, no alert UI. The session middleware, D1 binding, and component/service conventions from S-01 are all reused as-is.

## Desired End State

After login, the user lands on `/` and sees their alert list (empty on first visit), all in Polish. A "Nowy alert" button opens a modal form — instrument, alert type, threshold, and a notification email pre-filled from the account but editable. On submit, the alert appears at the top of the list immediately as a collapsed row (instrument · type · threshold); clicking it expands to show the notification email, last-edited date, and current price/RSI (hardcoded "Brak danych" placeholder — no market-data pipeline exists yet). Inline validation blocks out-of-range thresholds and VIX+RSI combinations before submission; a visible error covers duplicates.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Instrument/type wire values | `'VIX'`/`'NASDAQ100'`, `'PRICE'`/`'RSI'` | Alphanumeric-only, avoids any future URL/filename friction | Plan (user Q&A) |
| DB-level constraints | Application-layer validation only for enum/range; one `CHECK` for VIX+RSI exclusion | Matches existing convention for general enums/ranges; VIX+RSI is explicitly required "at the persistence layer" by the updated roadmap | Plan (user Q&A) + PRD/roadmap update 2026-07-19 |
| VIX + RSI combination | Rejected client-side (option hidden), server-side (400), and DB-side (`CHECK`) | RSI on VIX has no established sentiment interpretation (PRD FR-004 Socrates note) | PRD/roadmap update 2026-07-19 |
| Threshold rules | RSI 0–100 inclusive (decimals ok), price > 0 (decimals ok) | Matches how RSI and index prices actually behave as continuous values | Plan (user Q&A) |
| Duplicate alerts | Rejected via `UNIQUE(user_id, instrument, alert_type, threshold)` → 409 | Prevents accidental duplicate notifications later (S-05) | Plan (user Q&A) |
| Creation UI | `MatDialog` modal on the list page | User keeps list context; no navigation away | Plan (user Q&A) |
| Navigation shell | None — single page, no sidebar yet | Sidebar/history nav belongs to S-06; building it now is scope creep | Plan (user Q&A) |
| List placement | Replaces `Home`'s placeholder content | User's own description: land on the alerts page right after login | Plan (user Q&A) |
| Backend test depth | Exhaustive (validation, duplicates, boundaries, malformed body, isolation) | User-isolation is the highest-risk correctness point per research | Plan (user Q&A) |
| UI language | Polish for all new/touched UI (alerts + `Home`); backend API strings stay English | Product's users are Polish-speaking; CLAUDE.md amended with an explicit UI-text exception | User request 2026-07-19 |
| S-01 login/register translation | Deliberately out of scope — tracked as [issue #23](https://github.com/mswiac/market-pulse/issues/23) | Avoids touching the already-implemented, tested S-01 flow within this change | User Q&A 2026-07-19 |
| List item layout | `mat-expansion-panel` accordion: header = instrument/type/threshold, body = email/last-edited/current price/current RSI | User's own description: summary row, click to expand for details | User Q&A 2026-07-19 |
| Current price/RSI display | Hardcoded "Brak danych" placeholder for both, always shown for price, RSI row shown only for NASDAQ-100/RSI alerts | No market-data pipeline (F-02) exists yet; avoids reworking the UI shell when S-04 lands real values | User Q&A 2026-07-19 |
| Alert timestamps | Add `updated_at` column (equal to `created_at` at insert) now, display it as "last edited" | No edit feature yet (S-03), but this makes the label correct today and needs no further schema change later | User Q&A 2026-07-19 |

## Scope

**In scope:**
- `alerts` table migration (including `updated_at` for future edit support)
- `POST`/`GET /api/alerts`, scoped to the authenticated user
- Alert list view as an expand-on-click accordion (replacing the `Home` placeholder), in Polish
- Alert creation dialog with client + server validation, in Polish
- Translating `Home`'s existing copy to Polish (it's already being touched)

**Out of scope:**
- Edit/delete (S-03), real current RSI/price values (S-04/F-02 — this slice only shows a hardcoded placeholder), notifications (S-05), trigger history (S-06)
- Any side-nav/shell layout
- DB-level `CHECK` constraints for general enum/range validation (the one VIX+RSI exclusion constraint is in scope, see above)
- Instruments/indicators beyond VIX, NASDAQ-100, price, RSI
- Translating S-01's `login`/`register` pages (tracked separately in issue #23)

## Architecture / Approach

Standard layering already established by S-01: migration → Hono route module (`src/worker/routes/alerts.ts`, inline D1 queries, manual validation, `sessionMiddleware` reused unchanged) → Angular service (`AlertsService`, signal-based state mirroring `AuthService`) → Angular components (`alert-list`, `alert-form`, both standalone + Material, mirroring `login`/`register`). SQL column aliases (`alert_type AS alertType`) produce camelCase JSON directly, avoiding a mapping layer.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database schema | `alerts` table + migration | Missing `ON DELETE CASCADE` (already missed once on `sessions`) |
| 2. Backend API | Create + list endpoints, exhaustive tests | User-isolation bug (manual `WHERE user_id` scoping, no structural guard) |
| 3. Frontend service + list | Polish alert list on the home page, as an accordion | First `mat-expansion-panel` usage in the codebase; conditional RSI-row visibility |
| 4. Frontend creation dialog | End-to-end create flow, in Polish | First `MatDialog` usage in the codebase; conditional threshold validators and VIX/RSI option-filtering both need re-evaluation whenever `instrument`/`alertType` change |

**Prerequisites:** S-01 (done). No new dependencies — `@angular/cdk` (for `MatDialog`) is already installed.
**Estimated effort:** ~1 session across 4 phases; each phase is small and independently verifiable.

## Open Risks & Assumptions

- Cross-user isolation is enforced entirely by remembering to add `WHERE user_id = ?` in every query — there is no DB-level or framework-level guard. The exhaustive Phase 2 test suite is the primary safety net; worth double-checking during implementation review.
- No DB `CHECK` constraints on enum membership or threshold range means a future out-of-band script or migration could insert an invalid `instrument`/`alert_type`/`threshold` value undetected — acceptable at current scale per the app-layer-only decision. The VIX+RSI combination is the one exception with a DB-level backstop.

## Success Criteria (Summary)

- A user can create a valid alert and see it in their list without a page reload.
- Invalid thresholds, duplicate alerts, and VIX+RSI combinations are rejected with a visible, understandable (Polish) error.
- Clicking an alert reveals its email, last-edited date, and current price/RSI placeholder — with the RSI row present only when it's a NASDAQ-100/RSI alert.
- A second user never sees the first user's alerts.
