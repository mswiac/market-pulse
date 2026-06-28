# Users Email Schema — Plan Brief

> Full plan: `context/changes/users-email-schema/plan.md`

## What & Why

Registration currently requires three fields: username, password, and notification email — forcing the user to invent a username that serves no purpose. By using the email address as the sole identifier, registration drops to two fields (email + password) and the login email automatically doubles as the default notification address, eliminating FR-004a as a standalone feature.

## Starting Point

The `users` table (migration `0001_create_users.sql`) has columns `username`, `password_hash`, `notification_email`, and `created_at`. The remote D1 table is empty. The PRD (FR-001, FR-002, Auth section) and roadmap (S-02) still reference the username-based model.

## Desired End State

The `users` table has `email`, `password_hash`, `created_at` — no `username`, no `notification_email`. PRD and roadmap are consistent with the email-identifier model. S-01 (auth) can start planning against the correct schema.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Login identifier | Email address | Eliminates username friction; email already required for notifications | Plan (conversation) |
| `users` column name | `email` | Simpler than `notification_email`; unambiguous role | Plan (conversation) |
| `alerts` column name | `notification_email` | Distinguishes send-to address from login identifier in JOINs | Plan |
| Migration pattern | Shadow table (CREATE → DROP → RENAME) | Safe for all D1 SQLite versions; avoids ALTER TABLE uncertainty | Plan |
| FR-004a | Remove from PRD | Login email IS the default; no separate user action needed | Plan |
| S-02 ripple | Update now | Roadmap and PRD must be consistent before S-01 planning starts | Plan |

## Scope

**In scope:**
- `migrations/0002_users_email_schema.sql` (new file)
- PRD: FR-001, FR-002, FR-004, remove FR-004a, Auth section
- Roadmap: S-02 outcome + PRD refs

**Out of scope:**
- Auth endpoint code (S-01)
- Angular form changes (S-01)
- `alerts` table migration (S-02)

## Architecture / Approach

Schema-first: migration lands on local + remote D1 before any doc changes, making the schema the source of truth. Docs follow. No application code touched — S-01 hasn't been scaffolded yet.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. D1 Migration | `users` table has `email`, `password_hash`, `created_at` | Shadow-table order must be CREATE → DROP → RENAME |
| 2. PRD Update | FR-001/FR-002 updated; FR-004a removed; Auth section rewritten | Stale `username` references missed by search |
| 3. Roadmap Update | S-02 outcome + PRD refs consistent with new model | FR-004a reference missed in "At a glance" table |

**Prerequisites:** F-01 `backend-scaffold` complete ✓; remote D1 has migration `0001` applied ✓  
**Estimated effort:** ~1 session across 3 short phases

## Open Risks & Assumptions

- Remote `users` table confirmed empty — migration uses CREATE/DROP/RENAME without data copy. If a row was added manually between confirmation and `npm run migrate:remote`, the DROP TABLE will destroy it silently.
- D1 `ALTER TABLE ... RENAME TO` availability: standard SQLite syntax, present in all D1 versions to date.

## Success Criteria (Summary)

- `PRAGMA table_info(users)` on remote D1 shows exactly `id`, `email`, `password_hash`, `created_at`
- `grep -n "username" context/foundation/prd.md` returns zero hits in the document body
- `grep -n "FR-004a" context/foundation/roadmap.md` returns zero hits
