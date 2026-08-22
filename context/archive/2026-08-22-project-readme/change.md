---
change_id: project-readme
title: Add repo README covering local dev, Cloudflare deployment, and the CI quality gate
status: archived
created: 2026-08-22
updated: 2026-08-22
archived_at: 2026-08-22T19:30:34Z
---

## Notes

Add a repo README covering local dev, Cloudflare deployment, and the CI quality gate (GitHub issue #80) so this doesn't need re-discovering via wrangler.toml/package.json/dashboard each time

Tracks GitHub issue #80: "Add README: local dev, Cloudflare deployment, and CI quality gate".

Should cover, per the issue:
- Running locally: `npm start` (Angular dev server, localhost:4200), `npm run worker:dev` (`wrangler dev --local`), how the two relate (split deployment — Angular SPA + separate Worker), required local setup (local secrets/env file, local D1 migrations via `wrangler d1 migrations ... --local`).
- Cloudflare deployment: deploys via Cloudflare Workers Builds (not GitHub Actions) — build command `npm run ci` (typecheck + test:worker + build), deploy command `npx wrangler deploy`, version command `npx wrangler version upload`. D1 migrations are NOT auto-applied on deploy — `wrangler d1 migrations ... --remote` must be run separately.
- CI / quality gate: `main` has GitHub branch protection requiring the "Workers Builds: marketpulse" status check to pass before merge — this is what actually runs `npm run ci` as a blocking gate.
- Quick pointers to `context/` (the 10x-* change-tracking structure) and `test/worker/` (Vitest + `@cloudflare/vitest-pool-workers`).

Goal: one README a contributor (human or agent) can read instead of re-deriving this from `wrangler.toml`, `package.json`, and the Cloudflare dashboard every time.

This is a documentation-only change; the facts above were already independently verified during `context/changes/test-plan-refresh-2026-08-22/research.md` (branch protection JSON, build/deploy/version commands confirmed by the user). No fresh codebase research is expected to be needed — proceeding straight to /10x-plan.
