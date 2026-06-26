# Deploy Plan: First Cloudflare Deployment

## Context

Angular 22 SPA is scaffolded and working locally. Backend (Hono + D1) has not been built yet. This plan deploys **only the frontend** via **Cloudflare Pages with Git integration** — Cloudflare's own CI/CD that triggers on every push to `main`, with no GitHub Actions needed.

Scope is intentionally minimal: get a live URL now with auto-deploy on merge. D1/Worker/cron bindings are added when backend scaffolding begins.

---

## Prerequisites

### Cloudflare account

Create a free account at [cloudflare.com](https://cloudflare.com) if you don't have one. The free tier covers everything needed for this deployment.

### Wrangler CLI

**What it is:** Wrangler is Cloudflare's official command-line tool. It's used to manage Cloudflare Workers, Pages, and D1 databases from the terminal — similar to how the AWS CLI works for AWS, or `firebase` for Firebase. For this first deployment, Wrangler is only needed for local development (`wrangler pages dev`); Cloudflare Pages CI handles production deploys without it.

**Install:**
```bash
npm install -g wrangler
```

**Verify:**
```bash
wrangler --version
```

**Login to your Cloudflare account** (opens browser OAuth — one-time setup):
```bash
wrangler login
```

After this, Wrangler stores credentials locally. You won't need to log in again on this machine.

### D1 Database (needed when backend is scaffolded)

Run once, locally, after `wrangler login`. Running it a second time creates a second database — there is no idempotency check.

```bash
wrangler d1 create marketpulse-db
```

The output contains the `database_id` — a UUID that uniquely identifies your database on Cloudflare. Copy it immediately and save it; you'll need it when configuring `wrangler.toml` in Phase 2. The database cannot be renamed after creation.

Example output:
```
✅ Successfully created DB 'marketpulse-db'

[[d1_databases]]
binding = "DB"
database_name = "marketpulse-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

### GitHub repository

The project must be pushed to GitHub before connecting it to Cloudflare Pages. If the remote doesn't exist yet:

1. Create a new repository at [github.com/new](https://github.com/new) — name it `MarketPulse`, keep it private.
2. Push the local branch:
   ```bash
   git remote add origin https://github.com/<your-username>/MarketPulse.git
   git push -u origin main
   ```

---

## Step 1 — Fix Angular output path in `angular.json`

Angular's `@angular/build:application` builder defaults to outputting files into `dist/<project-name>/`. The internal project name in `angular.json` is `bootstrap-scaffold` (the scaffolding default), which would produce `dist/bootstrap-scaffold/browser/`. This step fixes it to `dist/market-pulse/browser/` — a stable, predictable path that Cloudflare Pages will reference.

**File:** `angular.json`  
**Change:** Add `outputPath` to the build `options` block:

```json
"options": {
  "outputPath": "dist/market-pulse",
  "browser": "src/main.ts",
  ...
}
```

After this change, `npm run build` will write the production bundle to `dist/market-pulse/browser/`.

---

## Step 2 — Create `wrangler.toml`

**What it is:** `wrangler.toml` is Wrangler's configuration file, similar to `package.json` for npm. It tells Wrangler the project name, which runtime features to use, where the build output is, and (later) how to connect to D1 databases or cron triggers.

Cloudflare Workers Assets (the deploy mechanism used by Cloudflare's CI — `wrangler versions upload`) reads this file to determine how to serve the SPA.

**File:** `wrangler.toml` (root of the project, new file)

```toml
name = "marketpulse"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist/market-pulse/browser"
not_found_handling = "single-page-application"
```

| Field | Meaning |
|---|---|
| `name` | The project name on Cloudflare — used in the default `*.workers.dev` URL |
| `compatibility_date` | Pins the Cloudflare runtime version — ensures behavior doesn't change on platform updates |
| `[assets] directory` | Where Wrangler looks for the built SPA files |
| `not_found_handling` | Serves `index.html` for any URL that doesn't match a static file — required for Angular's client-side router to work on direct URL access and page refresh |

**Note:** Do not add a `public/_redirects` file alongside `not_found_handling`. Workers Assets treats both as SPA fallback mechanisms and detects an infinite loop, failing the deploy.

---

## Step 4 — Verify the build works locally

Before connecting anything to Cloudflare, confirm the Angular build runs without errors:

```bash
npm run build
```

Expected output: a `dist/market-pulse/browser/` directory containing `index.html` and hashed JS/CSS bundles. If the build fails, fix the errors before proceeding.

---

## Step 3 — Pin Node.js version via `.nvmrc`

Cloudflare reads `.nvmrc` to determine the Node.js version used during build. Without it, the platform defaults to an older patch (e.g. `v22.16.0`) which is below Angular CLI's minimum requirement of `v22.22.3`.

**File:** `.nvmrc` (root of the project, new file)

```
22.22.3
```

**Note:** Setting `NODE_VERSION` in the Cloudflare dashboard may not apply to preview builds triggered by PRs. The `.nvmrc` file applies to all build environments (production and preview) and is the more reliable approach.

---

## Step 4 — Push changes to GitHub

Commit and push the changed/created files:

```bash
git add angular.json wrangler.toml .nvmrc
git commit -m "configure cloudflare pages deployment"
git push
```

---

## Step 6 — Connect Cloudflare Pages to GitHub (manual, one-time)

This step is done entirely in the Cloudflare dashboard — no terminal needed.

1. Go to **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. Authenticate with GitHub and select the `MarketPulse` repository
3. Configure build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Build output directory | `dist/market-pulse/browser` |
   | Root directory | *(leave empty)* |

4. The Node.js version is pinned via `.nvmrc` in the repo root — no environment variable needed in the dashboard. Cloudflare reads `.nvmrc` automatically for both production and preview builds.

   **Do not** set `NODE_VERSION` in the dashboard — it applies only to the Production environment and is ignored for PR preview builds, which caused build failures during initial setup.

5. Click **Save and Deploy**.

Cloudflare clones the repo, runs `npm install && npm run build`, and deploys the output. From this point on, every push to `main` triggers a new deploy automatically. Pull requests get isolated preview URLs (e.g. `abc123.marketpulse.pages.dev`) — useful for reviewing changes before merging.

---

## Verification

1. After the first deploy, the Cloudflare dashboard shows a live URL like `marketpulse.pages.dev` — open it and confirm the Angular app loads.
2. Navigate directly to a route (e.g. paste `marketpulse.pages.dev/alerts` in the address bar and press Enter) — should return the Angular app, not a 404. This confirms `_redirects` works.
3. Push any small change to `main` — a new build should appear in the **Deployments** tab within ~1 minute.

---

## Local development with Wrangler (optional)

To test the production build locally against Cloudflare's runtime (instead of `ng serve`):

```bash
npm run build
wrangler dev
```

This starts a local server at `http://localhost:8787` that behaves like the deployed version, including the SPA routing fallback from `not_found_handling = "single-page-application"` in `wrangler.toml`.

---

## Phase 2 — D1 Database (deferred to backend scaffolding)

These steps are executed when the Hono backend is scaffolded. They require a Worker script to exist before the database binding can be used.

### What is D1?

D1 is Cloudflare's managed SQLite database. It runs on Cloudflare's infrastructure alongside Workers — there is no separate database server to manage. Queries go through the Worker via a binding (an injected object, similar to dependency injection in Spring). The free tier covers 5 million row reads and 100k row writes per day — sufficient for this project's lifetime.

### Update `wrangler.toml`

Add the D1 binding and the Worker entry point to `wrangler.toml`:

```toml
name = "marketpulse"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
main = "src/worker/index.ts"

[assets]
directory = "./dist/market-pulse/browser"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "marketpulse-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

| New field | Meaning |
|---|---|
| `main` | Path to the Worker script (Hono entry point) — required for D1 and cron to work |
| `compatibility_flags = ["nodejs_compat"]` | Enables Node.js APIs in the Workers runtime — required by the Resend email SDK |
| `[[d1_databases]] binding` | The name used to access the database inside the Worker: `env.DB` |

### Run migrations

SQL schema files live in `migrations/`. Apply them to the local dev database:

```bash
wrangler d1 migrations apply marketpulse-db --local
```

And to production:

```bash
wrangler d1 migrations apply marketpulse-db --remote
```

**Important:** D1 migrations are forward-only. `wrangler rollback` restores the Worker code but does not undo schema changes. Always export a backup before running a migration on the production database:

```bash
wrangler d1 export marketpulse-db --remote --output ./backup.sql
```

---

## Phase 3 — Secrets (deferred to backend scaffolding)

### What are Workers Secrets?

Workers Secrets are encrypted environment variables stored on Cloudflare's infrastructure — similar to GitHub Secrets or a `.env` file, but never readable after they're set (not even in the dashboard). The Worker accesses them at runtime via `env.SECRET_NAME`, the same way it accesses D1 bindings. They are **not** stored in `wrangler.toml` or committed to the repository.

### Secrets needed by MarketPulse

| Secret | Used for | When needed |
|---|---|---|
| `RESEND_API_KEY` | Sending email notifications via Resend SDK | When the daily cron job is implemented |
| `JWT_SECRET` | Signing and verifying auth tokens | When the login endpoint is implemented |

### Set a secret (run once per secret, per environment)

```bash
wrangler secret put RESEND_API_KEY
```

Wrangler prompts for the value interactively — it is never echoed to the terminal or stored in shell history. Repeat for each secret:

```bash
wrangler secret put JWT_SECRET
```

The secret is available to the Worker immediately after being set — no redeploy needed.

### Rotate a secret

Run the same command again with the new value:

```bash
wrangler secret put RESEND_API_KEY
```

Cloudflare replaces the old value instantly. No downtime, no redeploy.

### List configured secrets (names only, not values)

```bash
wrangler secret list
```

### Local development

Secrets are not available locally via `wrangler dev` by default. Create a `.dev.vars` file at the project root (already in `.gitignore`) with the values for local testing:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
JWT_SECRET=a-long-random-string-for-local-dev
```

`wrangler dev` reads `.dev.vars` automatically. Never commit this file.

---

## Phase 5 — Cron Trigger (deferred to backend scaffolding)

### What is a Cron Trigger?

A Cron Trigger is a scheduled event that calls a specific function in your Worker at a configured time — similar to a cron job on a Linux server, but fully managed by Cloudflare. No server to keep running, no scheduler to maintain. The daily alert evaluation job (fetch Stooq data → calculate RSI → send emails) runs as a Cron Trigger.

Limitation: Cron Triggers have **no built-in retry**. If the Worker throws an exception, Cloudflare does not re-run it. Retry logic must be implemented in application code.

### Configure in `wrangler.toml`

Add the `[triggers]` section:

```toml
[triggers]
crons = ["0 18 * * 1-5"]
```

This fires every weekday at 18:00 UTC — after Warsaw Stock Exchange and NASDAQ close (WSE closes at 17:00 CET/18:00 CEST, NASDAQ at 21:00 ET / 03:00 CET). Adjust if needed.

Cron syntax: `minute hour day-of-month month day-of-week`. Use [crontab.guru](https://crontab.guru) to verify expressions.

### Implement the `scheduled` handler in the Worker

The Worker must export a `scheduled` handler alongside the default HTTP handler:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Hono HTTP handler
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Daily job: fetch Stooq → calculate RSI → evaluate alerts → send emails
    ctx.waitUntil(runDailyJob(env));
  },
};
```

`ctx.waitUntil()` is required — it tells the Workers runtime to keep the isolate alive until the async job completes, even after the scheduled event itself returns.

### Test the cron locally

```bash
wrangler dev --test-scheduled
```

Then trigger it manually in another terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=0+18+*+*+1-5"
```

---

## Out of Scope

- **Custom domain binding** — After the first deploy, the app is accessible at `marketpulse.pages.dev` (a Cloudflare-owned subdomain). Custom domain binding connects your own domain (e.g. `marketpulse.pl`) so users see a normal address instead of `*.pages.dev`. Requires owning a domain and pointing its DNS to Cloudflare. Configured in the Cloudflare dashboard → Pages project → Custom domains. Deferred until the MVP is stable and worth a domain purchase.

- **Cloudflare Access (Zero Trust) on preview URLs** — Every PR automatically gets a public preview URL (e.g. `abc123.marketpulse.pages.dev`). This URL is accessible to anyone on the internet without authentication — no login required. For a private project this is a risk: someone who finds the URL can see the work-in-progress app. Cloudflare Access (part of Cloudflare One / Zero Trust) lets you put an authentication gate in front of these preview URLs — for example, only requests from `mateusz.swiac@gmail.com` are allowed through. Configuration: Cloudflare dashboard → Zero Trust → Access → Applications → add the `*.marketpulse.pages.dev` wildcard. Deferred because the current app has no sensitive data or user accounts yet.

- **GitHub Actions** — excluded per user preference (Cloudflare Pages CI used instead)
