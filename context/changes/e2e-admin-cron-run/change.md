---
change_id: e2e-admin-cron-run
title: E2E for the Force data refresh admin page
status: implemented
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

GitHub issue #184. Cover /admin/cron-run in the browser with POST /api/admin/cron/run mocked via page.route: clean 200 run, 207 with a failed ticker, 207 with errors (from #172), and cancelling the confirm dialog sends no request. Uses the admin session from e2e-admin-account-infra (#183). Generate via /10x-e2e.
