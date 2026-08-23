# Remote D1 foreign-key enforcement check

## What was checked

Risk #5 (`context/foundation/test-plan.md` §2) — whether cascading/orphaned-delete behavior verified only against local D1 (`context/archive/2026-08-14-admin-remove-user/plan.md:9,27`) also holds on production D1. Scope, per plan decision: read-only `PRAGMA foreign_keys` only — no synthetic insert/delete against production data.

## Command

```
wrangler d1 execute marketpulse-db --remote --command "PRAGMA foreign_keys"
```

## Output

```
 ⛅️ wrangler 4.103.0
────────────────────
Resource location: remote

🌀 Executing on remote database marketpulse-db (7476d353-d0d1-4687-be8e-12cdbd01494b):
🚣 Executed 1 command in 0.18ms
┌──────────────┐
│ foreign_keys │
├──────────────┤
│ 1            │
└──────────────┘
```

## Result

`foreign_keys = 1` — foreign-key enforcement is active on production D1, matching the local-D1 finding from the S-12 (`admin-remove-user`) plan. No escalation needed: the `ON DELETE CASCADE`/`ON DELETE SET NULL` constraints on `sessions`, `alerts`, and `trigger_events` (`migrations/0004`, `0008:32`, `0011:13,75`) can be relied on remotely the same way they were verified locally.

## Date

2026-08-23
