---
change_id: review-followups
title: CI pipeline, deployment-plan fix, and restored CHECK constraints
status: impl_reviewed
created: 2026-07-26
updated: 2026-07-26
archived_at: null
---

## Notes

Add CI (typecheck + test:worker on every PR), fix stale ctx.waitUntil() claim in deployment-plan.md and note the fixed retry delay is intentional, and restore DB-level CHECK constraints (RSI+VIX etc.) dropped in migration 0008 for defense-in-depth
