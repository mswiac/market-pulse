# Users Email Schema Implementation Plan

## Overview

Replace the `users` table's `username` + `notification_email` dual-field model with a single `email` column serving as both the login identifier and the default notification address. Update PRD and roadmap to reflect the design before S-01 (auth) planning begins.

## Current State Analysis

- `migrations/0001_create_users.sql`: `users` table has `username TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `notification_email TEXT NOT NULL`, `created_at INTEGER NOT NULL DEFAULT (unixepoch())`
- Remote D1 confirmed empty — no registered users; no data migration required
- PRD FR-001/FR-002 reference `username`; FR-004a is a standalone requirement ("default notification email in profile") now redundant
- Roadmap S-02 outcome and PRD refs reference FR-004a

## Desired End State

- `users` table columns: `id`, `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `created_at`
- PRD: FR-001 = register with email+password; FR-002 = login with email+password; FR-004a removed; Auth section updated; FR-004 pre-fill updated
- Roadmap: S-02 outcome and PRD refs updated to remove FR-004a

### Key Discoveries

- `wrangler.toml:2` — `compatibility_date = "2025-01-01"`. Shadow-table pattern (CREATE → DROP → RENAME) is the safe canonical approach for D1 regardless of ALTER TABLE support.
- Remote table is empty — shadow-table without `INSERT ... SELECT` is sufficient.
- Future `alerts.notification_email` column (S-02) pre-fills from `users.email` at the application layer — no schema dependency introduced here.

## What We're NOT Doing

- No auth endpoint code — that is S-01
- No Angular form changes — that is S-01
- No `alerts` table migration — that is S-02
- No renaming of `alerts.notification_email` (decided: keep `notification_email` for the alerts table to distinguish roles)
- No PRD version bump

## Implementation Approach

Three sequential phases: migration first (the schema change is the prerequisite for everything else), then PRD, then roadmap. The migration applies to both local and remote D1 before any doc changes land — this way the schema is the source of truth, and the docs follow.

## Critical Implementation Details

**Migration statement order**: CREATE TABLE users_new must come before DROP TABLE users. Reversing the order would drop the old table before the new one exists — though the table is empty, reversing leaves the DB in a broken state with no `users` table at all.

---

## Phase 1: D1 Migration

### Overview

Write and apply the forward-only migration that replaces the `users` table with the email-schema version.

### Changes Required

#### 1. `migrations/0002_users_email_schema.sql` (new file)

**File**: `migrations/0002_users_email_schema.sql`

**Intent**: Replace the username+notification_email schema with a single `email` column. Uses the shadow-table pattern — safe for all D1 SQLite versions.

**Contract**:
```sql
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

### Success Criteria

#### Automated Verification

- `npx wrangler d1 execute marketpulse-db --local --command "SELECT COUNT(*) FROM users"` returns 0 — confirms local table is empty before the destructive DROP TABLE
- `npm run migrate:local` exits 0 — migration applies cleanly to local D1

#### Manual Verification

- `npm run migrate:remote` exits 0 — schema applied to remote D1
- `npx wrangler d1 execute marketpulse-db --remote --command "PRAGMA table_info(users)"` shows exactly four columns: `id`, `email`, `password_hash`, `created_at`

**Implementation Note**: Confirm both local and remote verification pass before proceeding to Phase 2.

---

## Phase 2: PRD Update

### Overview

Update `context/foundation/prd.md` to reflect email-as-identifier throughout: rewrite FR-001, FR-002, remove FR-004a, update Auth section, and clean FR-004's pre-fill reference.

### Changes Required

#### 1. FR-001

**File**: `context/foundation/prd.md`

**Intent**: Replace three-field registration (username + password + notification email) with two-field (email + password).

**Contract**: FR-001 reads: `User can register an account with an email address and password. Priority: must-have`

#### 2. FR-002

**File**: `context/foundation/prd.md`

**Intent**: Change the login credential from username+password to email+password.

**Contract**: FR-002 reads: `User can log in using their email address and password. Priority: must-have`

#### 3. Remove FR-004a

**File**: `context/foundation/prd.md`

**Intent**: FR-004a ("User can set a default notification email address in their profile") is now implicit — the login email IS the default. Remove it as a standalone requirement; delete the Socrates note on FR-004 that references "profile default" and replace the pre-fill wording.

**Contract**: Delete the entire FR-004a line. In FR-004, replace "pre-filled from the user's profile default but can be overridden per alert" with "pre-filled from the user's account email but can be overridden per alert." Also remove the Socrates note immediately below FR-004 (the full `> Socrates: Counter-argument considered: "Email per alert is friction…"` block), as it references the now-removed "default notification email in the profile" concept.

#### 4. Auth section

**File**: `context/foundation/prd.md`

**Intent**: Rewrite the Access Control paragraph to remove username references and describe email as the sole login identifier.

**Contract**: Replace the paragraph starting "Username + password + notification email at registration…" with: `Email address and password at registration. Login uses the email address and password — the email serves as both the login identifier and the default notification address pre-filled on new alerts. Flat role model — one type of user, everyone with identical permissions to manage their own alerts. The MVP serves a single user, but the account model is multi-user by design — adding more people does not require a rebuild. Unauthenticated users have no access to any application resource.`

### Success Criteria

#### Manual Verification

- `grep -n "username" context/foundation/prd.md` returns zero hits in the document body
- FR-004a no longer appears in the PRD
- FR-004 reads "pre-filled from the user's account email"
- Auth section contains no reference to `username` or `notification email`

---

## Phase 3: Roadmap Update

### Overview

Update `context/foundation/roadmap.md` S-02 outcome and PRD refs to remove the now-deleted FR-004a.

### Changes Required

#### 1. S-02 "At a glance" row

**File**: `context/foundation/roadmap.md`

**Intent**: Remove FR-004a from S-02's PRD refs column.

**Contract**: S-02 row PRD refs column changes from `FR-004, FR-004a, FR-005` to `FR-004, FR-005`.

#### 2. S-02 section outcome and PRD refs

**File**: `context/foundation/roadmap.md`

**Intent**: Update the S-02 outcome sentence and the `PRD refs` field in the S-02 detail block.

**Contract**:
- `- **Outcome:**` — replace "pre-filled from the profile default set at registration" with "pre-filled from the user's account email"
- `- **PRD refs:**` — change `FR-004, FR-004a, FR-005` to `FR-004, FR-005`

### Success Criteria

#### Manual Verification

- `grep -n "FR-004a" context/foundation/roadmap.md` returns zero hits
- S-02 "At a glance" PRD refs reads `FR-004, FR-005`
- S-02 outcome reads "pre-filled from the user's account email"

---

## Testing Strategy

### Manual Testing Steps

1. After Phase 1 local: `npx wrangler d1 execute marketpulse-db --local --command "PRAGMA table_info(users)"` → expect `id`, `email`, `password_hash`, `created_at`
2. After Phase 1 remote: same command with `--remote`
3. After Phase 2: `grep -n "username" context/foundation/prd.md` → zero hits in body; `grep -n "FR-004a" context/foundation/prd.md` → zero hits
4. After Phase 3: `grep -n "FR-004a" context/foundation/roadmap.md` → zero hits

## References

- Roadmap entry F-01a: `context/foundation/roadmap.md` § F-01a
- PRD: `context/foundation/prd.md` §Authentication, §Access Control
- Prior migration: `migrations/0001_create_users.sql`
- GitHub issue: #17

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: D1 Migration

#### Automated

- [x] 1.1 `SELECT COUNT(*) FROM users` on local D1 returns 0 (pre-flight guard) — 17c6eb1
- [x] 1.2 `npm run migrate:local` exits 0 — 17c6eb1

#### Manual

- [x] 1.3 `npm run migrate:remote` exits 0 — 17c6eb1
- [x] 1.4 `PRAGMA table_info(users)` on remote shows `id`, `email`, `password_hash`, `created_at` — 17c6eb1

### Phase 2: PRD Update

#### Manual

- [x] 2.1 No `username` field references remain in PRD body — 5eb0b67
- [x] 2.2 FR-004a removed from PRD — 5eb0b67
- [x] 2.3 FR-004 reads "pre-filled from the user's account email" — 5eb0b67
- [x] 2.4 Auth section updated (no `username`, no `notification email`) — 5eb0b67

### Phase 3: Roadmap Update

#### Manual

- [x] 3.1 S-02 outcome reads "pre-filled from the user's account email"
- [x] 3.2 S-02 PRD refs contain `FR-004, FR-005` (no FR-004a)
- [x] 3.3 `grep -n "FR-004a" context/foundation/roadmap.md` → zero hits
