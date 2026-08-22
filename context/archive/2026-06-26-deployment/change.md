---
change_id: deployment
title: First Cloudflare deployment plan (Pages, superseded)
status: archived
created: 2026-06-26
updated: 2026-08-22
archived_at: 2026-08-22T00:00:00Z
---

## Notes

Predates the `/10x-new` change-tracking convention — this folder holds a single record (`deployment-plan.md`), the project's original plan for its first Cloudflare deployment. Retroactively archived for consistency: the folder is added here manually rather than through `/10x-archive` (which requires a pre-existing `change.md` to resolve the destination).

**Superseded — do not follow as current instructions.** This plan describes deploying via Cloudflare Pages with GitHub-connected CI; the project's actual, current deployment mechanism is Cloudflare Workers Builds (build command `npm run ci`, deploy command `npx wrangler deploy`, version command `npx wrangler version upload`), documented in the repo root `README.md` and grounded in `context/changes/test-plan-refresh-2026-08-22/research.md`. Several specifics in this plan no longer match reality (assets path without the `/pl` locale suffix, no D1 binding yet, secret names differ from the app's actual `ADMIN_EMAILS`/`PASSWORD_PEPPER`/`RESEND_API_KEY`/`RESEND_VERIFIED_EMAIL`, cron schedule differs from the current `0 23 * * 1-5`). Kept for historical record only.
