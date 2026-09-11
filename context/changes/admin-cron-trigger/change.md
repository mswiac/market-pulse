---
change_id: admin-cron-trigger
title: Admin endpoint and panel UI to manually trigger the daily cron pipeline
status: impl_reviewed
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

Add an authenticated admin endpoint (POST /api/admin/cron/run) plus a matching admin-panel UI section/form that manually re-runs the production cron pipeline (fetch closes → RSI → evaluate alerts → send emails) by calling handleScheduled(c.env) directly, behind existing adminMiddleware. Origin: GitHub issue #150 (https://github.com/mswiac/market-pulse/issues/150) — updated 2026-09-11 to explicitly require the admin-panel UI form as part of this issue's scope, not a separate future item. The endpoint must be operable entirely from that form — no curl-only/hidden trigger.

Problem: There's no scriptable way to fire the daily cron pipeline against production data outside its schedule. The only trigger today is the Cron Trigger itself (`0 23 * * 1-5`, wrangler.toml:17) or a Cloudflare dashboard manual trigger (not scriptable). `/__scheduled` doesn't work against the deployed Worker — it falls through to the Hono SPA wildcard route and returns index.html instead of invoking scheduled().

Where:
- src/worker/routes/admin.ts — existing admin routes, gated by sessionMiddleware + adminMiddleware (admin.ts:16)
- src/worker/scheduled.ts — exports handleScheduled(env), already imported in src/worker/index.ts:7
- src/app/features/admin/admin-panel.ts / .html / .service.ts — existing admin panel SPA page and its service, where the new trigger form belongs

Constraints:
- Must stay behind adminMiddleware (backend) and the existing admin-only gating on the SPA route (frontend) — real Resend emails go out to real users if a threshold is crossed, so this is not a no-op action.
- Response/UI should surface enough detail (tickers fetched, alerts evaluated, emails sent, errors) to verify what happened without tailing production logs.
- The admin panel form is the required way to trigger this — a backend-only endpoint without a working UI trigger does not satisfy this issue.

Ties into the broader admin-panel idea (manual alert-trigger-by-value + instrument management) already floated for making cron behavior testable without waiting on real market timing.

Note: this repeats a previous attempt at this change that was fully reverted (branch deleted, context folder wiped) because it only covered the backend endpoint — the UI requirement above was missing from that attempt's scope and needs full planning (data model for how the UI surfaces the summary, form placement/UX, loading/error states) via a fresh /10x-plan.
