# Admin can remove a user — Plan Brief

> Full plan: `context/changes/admin-remove-user/plan.md`

## What & Why

An admin needs a way to remove a user account through the UI, without manual SQL. Unlike instrument removal (S-11), the `users` table's dependents (`sessions`, `alerts`, `trigger_events`) all have real `ON DELETE CASCADE` foreign keys, so the deletion itself is simple — the real work is building the first-ever user-lookup UI/API in this codebase and getting the safety rails (self-delete block, blast-radius confirmation) right.

## Starting Point

The admin panel (S-09/S-10/S-11) has three actions today: fetch market data, add an instrument, remove an instrument. All three established the patterns this plan reuses — admin-gated routes with `{error, code}` responses, a `MAT_DIALOG_DATA`-based confirmation dialog, and a separate route + sidebar link per action. No user-listing or user-lookup endpoint exists anywhere yet — this is the first admin action to operate on `users` rather than `instruments`.

## Desired End State

An admin opens `/admin/remove-user`, picks a user by email from a dropdown that never shows their own account, sees a confirmation dialog with the exact number of alerts and trigger-history entries that will also be deleted, confirms, and the account is gone — instantly reflected in the picker, with a success snackbar reporting the final counts.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| User selection UX | Searchable dropdown fed by a new `GET /api/admin/users` list (email only) | Mirrors the existing S-09/S-10/S-11 combobox pattern; no per-user metadata needed in the list itself since the confirmation dialog already surfaces it | Plan (user) |
| Self-deletion | Blocked entirely — excluded from the picker list and rejected server-side (`cannot_delete_self`) | Admin's own session would die mid-action; zero legitimate use case justifies the risk | Plan (user) |
| Confirmation detail | Show alert count *and* trigger-event count | Matches S-11's transparency precedent — admin sees the full blast radius, not just alerts, before an irreversible delete | Plan (user) |
| Picker metadata | Email only, no inline alert count | Keeps the list endpoint simple; the impact-preview call already shows counts one step later, before the actual delete | Plan (user) |
| Extra delete safeguard | Standard Confirm/Cancel dialog (no typed-email confirmation) | Consistent with S-11's dialog weight; the self-delete guard and blast-radius display already cover the main risks | Plan (user) |
| Cascade mechanism | Single `DELETE FROM users WHERE id = ?`, relying on existing DB-level `ON DELETE CASCADE` | Verified empirically against local D1 during planning (FK enforcement is on, cascade fires) — no manual multi-table `batch()` needed, unlike S-11 | Plan |

## Scope

**In scope:** `GET /api/admin/users` (picker list, excludes the requesting admin); `GET /api/admin/users/:id/impact` (alert + trigger-event count preview); `DELETE /api/admin/users/:id` (self-delete blocked, single cascading delete otherwise); new confirmation-dialog component; new "Remove user" admin page; routing, sidebar nav, and i18n.

**Out of scope:** a general user-browsing/management page; per-user metadata in the picker list; email notification to the deleted user; soft-delete/undo; any schema or migration changes (none needed — existing FKs already cascade).

## Architecture / Approach

Backend endpoints first (list, impact, delete — impact and delete share the same count queries), then the reusable frontend pieces (service methods, dialog component), then the page that wires them together, then routing/nav/i18n last to make it reachable. Identical phase ordering to S-11.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Backend endpoints | List + impact preview + single-statement cascade delete, with tests | Getting the self-delete guard's ordering right (must run before the existence lookup, not after) |
| 2. Frontend service + dialog | `AdminService` methods, `RemoveUserConfirm` dialog | None significant — closely mirrors `remove-instrument-confirm` |
| 3. Remove-user page | The user-facing feature | i18n catalog completeness only fully resolves once Phase 4's route lands (same caveat S-11 already documented) |
| 4. Routing, nav, i18n | Reachable page, complete Polish translations | None significant |

**Prerequisites:** none — `F-01a`, `S-01`, `S-09` (roadmap prerequisites) are already done.
**Estimated effort:** ~1-2 sessions across 4 phases (simpler than S-11 — no manual cascade logic needed).

## Open Risks & Assumptions

- Assumes remote D1 enforces foreign keys identically to local D1 (same SQLite engine) — verified empirically only against local D1 during planning; not separately re-verified against production.
- Assumes a small race window between the impact-preview call and the confirm click (a new alert could be added in between) is acceptable for a low-frequency, admin-only action — same assumption S-11 already accepted for instruments.
- Assumes `mat-select` (rather than a searchable autocomplete) stays usable as the user picker at current and near-term user counts; revisit if the user base grows large enough to make a flat dropdown unwieldy.

## Success Criteria (Summary)

- An admin can remove a user end-to-end and see an accurate pre-delete impact count (alerts + trigger events).
- The deleted user's sessions, alerts, and trigger history are all gone; the deleted user can no longer log in.
- Self-deletion is impossible both through the UI (excluded from the picker) and via direct API calls (`cannot_delete_self`).
