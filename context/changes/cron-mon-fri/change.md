---
change_id: cron-mon-fri
title: Fix cron triggers running Sunday-Thursday instead of Monday-Friday
status: impl_reviewed
created: 2026-10-17
updated: 2026-10-17
archived_at: null
---

## Notes

Fix cron triggers running Sunday–Thursday instead of Monday–Friday (GitHub issue #210). Cloudflare numbers days of the week from Sunday, so `1-5` is SUN-THU. Use named days (`MON-FRI`) in wrangler.toml and the PL_FETCH_CRON / US_FETCH_CRON / EVALUATE_CRON constants in src/worker/scheduled.ts.
