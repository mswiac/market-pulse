---
project: MarketPulse
researched_at: 2026-06-20
recommended_platform: Cloudflare Workers + Pages
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Angular 22 (SPA) + Hono (API)
  runtime: Cloudflare Workers (V8 isolates)
  database: D1 (SQLite)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The stack declared in `tech-stack.md` (Workers + D1 + Cron Triggers + Pages) maps perfectly to what Cloudflare offers as a first-class path — one ecosystem, one CLI (`wrangler`), zero migration. At the target scale (142 instruments, 1 alert/instrument, 1 daily cron, non-commercial project) the free tier covers everything; the $5/month paid tier eliminates the only real risk (10ms CPU limit on free). The decision was reinforced by the developer interview: no persistent connections, cost minimization, co-location and simplicity preference.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy | MCP | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | **5/5** |
| Vercel | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4.5/5 |
| Railway | Pass | Partial | Partial | Pass | Partial | 3.5/5 |
| Render | Partial | Partial | Pass | Pass | Partial | 3.5/5 |
| Fly.io | Pass | Fail | Partial | Pass | Fail | 3/5 |

After applying interview weights (cost, co-location, no existing familiarity as tie-breaker):

- **Vercel** (5/5 raw score) eliminated by stack mismatch: no D1/SQLite equivalent → mandatory database migration; non-commercial project avoids the $20/month Pro requirement, but Hobby's 60s function timeout is a real risk for the daily cron fetching 142 instruments + sending emails.
- **Netlify** eliminated by Deno runtime for Edge Functions (required by the Hono adapter), no SQLite, EU region requires Pro plan.
- **Fly.io** eliminated by no free tier, LiteFS unsupported (pre-1.0), no llms.txt, experimental MCP.
- **Render** eliminated by cost (~$27/month), no CLI rollback, free Postgres deleted after 30 days.
- **Railway** — the only credible alternative: $5/month Hobby plan, Hono on Node.js, EU-West Amsterdam, SQLite via volume (or Postgres). Weakness: Angular SPA requires a separate Caddy container (no CDN), SQLite on volume requires discipline (no writes during build time).

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

The only platform where the entire stack (SPA, API, DB, Cron, email) exists natively with no adaptation. Wrangler CLI covers deploy, rollback, log tailing, D1 migrations — all scriptable. `llms.txt` + per-product `llms-full.txt` + the entire docs repo on GitHub makes this the best agent-readable documentation setup of all evaluated platforms. The free tier covers 100k requests/day + 5M D1 row reads/day + unlimited static asset requests — sufficient for the full lifetime of an MVP.

#### 2. Railway

PaaS with a $5/month Hobby plan (includes $5 usage credit). Hono runs on standard Node.js (no V8 isolate edge cases), EU-West Amsterdam region, native cron support (5-minute minimum, fine for a daily job). SQLite via volume requires explicit configuration — the volume is not writable during build time, only at runtime. Angular SPA requires a separate Caddy service without a CDN edge. MCP server in active development (preview). A sensible fallback if the Workers runtime proves blocking.

#### 3. Render

Managed hosting with Node.js, Postgres, cron, Frankfurt EU, an official MCP server, and llms.txt. Eliminated primarily by cost (~$27/month for Starter web service + Basic Postgres) and the absence of a CLI rollback command. A good option for projects that outgrow the Cloudflare free tier and need full Postgres without managing containers.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Vendor lock-in is the deepest of all options.** D1 is SQLite accessible only through Cloudflare bindings. Workers Runtime (V8 isolates) is not Node.js — native npm packages (`bcrypt`, `canvas`, `sharp`) will not work without alternatives. Migrating away from Cloudflare in the future means rewriting the entire backend.

2. **The 10ms CPU limit on the free tier is a real risk at 142 instruments.** Parsing the bulk CSV + RSI calculations for 142 companies is estimated at 3–5ms CPU — close to the boundary. With more complex indicators or slow D1 responses, the limit can be exceeded. Mitigation: the paid tier at $5/month raises the Cron Trigger CPU limit to 15 minutes.

3. **Workers Runtime is not Node.js.** The `nodejs_compat` flag patches most gaps, but every new npm package must be checked for compatibility. For a developer new to the JS ecosystem, this is an extra layer of non-obvious runtime errors.

4. **Code rollback does not revert D1 schema.** `wrangler rollback` restores the Worker to a previous version, but D1 migrations are forward-only. A bad migration requires manual database repair — there is no automatic rollback.

5. **Cron Triggers can take up to 15 minutes to propagate** after a schedule change in the configuration. After deploying a cron change, the Worker may still fire on the old schedule for up to a quarter of an hour.

### Pre-mortem — How This Could Fail

Six months after deployment the project grows: 140 GPW stocks + 30 stocks from other markets, each with 3 indicators (RSI, MACD, Bollinger Bands). Parsing the bulk CSV + calculating 170 × 3 indicators + writing to D1 + evaluating alerts pushes past 10ms CPU even on the paid tier for a single Worker invocation. Cloudflare offers no long-running CPU-intensive compute — Queues helps with I/O but not calculations. An attempt to use a technical analysis npm library (`technicalindicators`) reveals that one transitive dependency uses `Buffer` without `nodejs_compat`, crashing the runtime without a readable stack trace (V8 isolates limit error metadata). Meanwhile, a D1 schema change was deployed without a proper forward-only migration, a Worker rollback does not help, and the database is in an inconsistent state. The D1 vendor lock-in makes "move the database to Postgres" a week-long rewrite of the data access layer. A decision obvious for 2 instruments becomes technical debt for 170.

### Unknown Unknowns

- **Workers are being consolidated with Pages.** Cloudflare is migrating Pages to Workers Assets. Documentation between "old" Pages CLI and Workers with `[assets]` config is sometimes inconsistent — new projects should use Workers Assets instead of a separate Pages project.
- **D1 returns all query results into memory at once** (no streaming). With 142 instruments × 200 days of history = 28,400 rows in a single query, this can hit the 128 MB Worker memory limit. Use pagination or separate queries per instrument.
- **Cron Triggers have no built-in retry.** If the Worker throws an exception (e.g., Stooq timeout), Cloudflare does not retry the invocation. Failure must be logged manually; retry logic must be implemented in application code.
- **Resend SDK requires the `nodejs_compat` flag** — it uses `node:https` internally. Without the flag: `TypeError: fetch is not a function` at runtime, not at build time.
- **Stooq bulk download has no SLA or official API contract.** The file format, endpoint availability, and data structure can change without notice. Add format validation after download and a circuit breaker.

## Operational Story

- **Preview deploys**: `wrangler pages deploy` (Workers Assets) creates a unique preview URL per deploy, accessible without authentication. For a private application, protect preview URLs with Cloudflare Access (Zero Trust) — otherwise they are publicly reachable.
- **Secrets**: env vars and tokens (Resend API key, JWT secret) are stored in Workers Secrets (`wrangler secret put KEY`). Accessible only through the Cloudflare dashboard or Wrangler CLI with a scoped API token. Rotation: `wrangler secret put KEY` with the new value — no redeploy required, the secret is available immediately.
- **Rollback**: `wrangler rollback [VERSION_ID]` (without ID: reverts to the previous version). List versions: `wrangler deployments list`. Rollback time: ~10–20 seconds. Caveat: D1 migrations do not roll back automatically — if a deploy included a schema migration, the Worker rollback does not restore the old schema.
- **Approval**: production deploys can be executed autonomously by an agent (`wrangler deploy`). Human-only operations: deleting a Workers/Pages project, rotating the primary Cloudflare API token, deleting a D1 database.
- **Logs**: `wrangler tail` — live log streaming in the terminal. Historical logs (up to 7 days): Cloudflare dashboard → Workers → specific Worker → Logs. The Cloudflare MCP server (`cloudflare/mcp-server-cloudflare`) exposes a `workers_observability` tool for agent-driven log queries.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 10ms CPU limit exceeded at 142 instruments on free tier | Devil's advocate | M | M | Upgrade to paid tier ($5/month) at first CPU timeout; test the cron locally with `wrangler dev` before deploying |
| Stooq bulk endpoint changes format or becomes unavailable | Unknown unknowns | M | H | Add CSV format validation after download; log parse errors; have a fallback to individual per-instrument requests |
| Code rollback does not revert D1 migration | Devil's advocate | L | H | Write forward-only migrations; export D1 backup before any schema change (`wrangler d1 export`) |
| npm package incompatible with Workers Runtime | Devil's advocate | M | M | Check compatibility before adding a dependency; use `nodejs_compat` flag; prefer packages on Cloudflare's verified list |
| Resend SDK fails without `nodejs_compat` | Unknown unknowns | H | M | Add `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml` immediately during scaffolding |
| Cron does not retry after failure | Unknown unknowns | M | H | Wrap the cron handler in try/catch with error logging to D1; add failure alerting via Cloudflare Email Workers or external monitoring |
| Vendor lock-in blocks migration at larger scale | Pre-mortem | L | H | Acceptable for MVP; above ~500 instruments or CPU-intensive indicators, consider offloading calculations to external compute (e.g., a separate Fly.io worker) |
| D1 query of 28k rows exceeds Worker memory limit | Unknown unknowns | L | M | Use pagination and per-instrument queries instead of a single large SELECT |

## Getting Started

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create D1 database:**
   ```bash
   wrangler d1 create marketpulse-db
   ```
   Copy the `database_id` from the output into `wrangler.toml`.

3. **Configure `wrangler.toml` for Workers + Assets (Angular SPA):**
   ```toml
   name = "marketpulse"
   compatibility_date = "2025-01-01"
   compatibility_flags = ["nodejs_compat"]

   [assets]
   directory = "./dist/market-pulse/browser"
   not_found_handling = "single-page-application"

   [[d1_databases]]
   binding = "DB"
   database_name = "marketpulse-db"
   database_id = "<YOUR_DATABASE_ID>"

   [triggers]
   crons = ["0 18 * * 1-5"]
   ```

4. **Add Resend API key as a secret:**
   ```bash
   wrangler secret put RESEND_API_KEY
   ```

5. **Deploy:**
   ```bash
   ng build                  # Angular SPA → dist/
   wrangler deploy           # Worker + Assets to Cloudflare
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions)
- Production-scale architecture (multi-region, HA, DR)
- Backtest compute (CPU-intensive historical calculations outside of daily cron scope)
