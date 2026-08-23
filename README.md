# MarketPulse

MarketPulse is a stock market alert web app. Users set price- or RSI-based alerts and get an email notification when a threshold is crossed. The instrument registry ships seeded with the VIX and NASDAQ-100 indices, but an admin can add more instruments through the admin panel — US stocks and GPW-listed Polish stocks (fetched via a ticker + `.WA` suffix) are both supported. Market data for every registered instrument is fetched once a day from Yahoo Finance via a Cloudflare Cron Trigger, which also calculates RSI and evaluates every active alert.

## Running locally

The app is a split deployment — an Angular SPA and a separate Cloudflare Worker (Hono API) — so local development runs both as independent dev servers that talk to each other through a proxy.

### Prerequisites

- Node `22.22.3` (see `.nvmrc`; a Node version manager like `nvm use` will pick it up automatically)
- `npm install`

### Local secrets

The Worker reads secrets from a local `.dev.vars` file at the repo root (Wrangler's standard mechanism for local secrets — this file is gitignored and never committed). Create it yourself with the following keys:

```
ADMIN_EMAILS=you@example.com
PASSWORD_PEPPER=<any local dev value>
RESEND_API_KEY=<a Resend API key, or a dummy value if you don't need real emails locally>
RESEND_VERIFIED_EMAIL=you@example.com
```

`ADMIN_EMAILS` is a comma-separated list of emails that get admin panel access. The others are only exercised when an alert actually fires and tries to send an email.

### Local D1 database

Apply all migrations to the local (Miniflare-simulated) D1 database before running the Worker for the first time:

```bash
npm run migrate:local
```

Re-run this whenever a new file lands under `migrations/` — migrations are not applied automatically.

### Start both dev servers

The two servers are independent processes and both need to be running:

```bash
npm run worker:dev   # wrangler dev --local — Hono API + local D1, http://localhost:8787
npm start             # ng serve --configuration development-pl — Angular SPA, http://localhost:4200
```

`npm start` uses the `development-pl` build configuration, so the local app is served with Polish (`pl`) localization, matching production. `proxy.conf.json` forwards every `/api/*` request from the Angular dev server (`:4200`) to the local Worker (`:8787`), so open `http://localhost:4200` in the browser — not `:8787` directly.

### Checks before pushing

```bash
npm run typecheck     # tsc --noEmit for both the Angular app and the Worker
npm run test:worker   # Vitest + @cloudflare/vitest-pool-workers — backend test suite
```

`npm test` (`ng test`) is currently **not functional** — the repo has no configured Angular test runner yet (no Karma, no Vitest-for-Angular wiring). There are no frontend tests to run today.

## Deployment

Deployment runs through **Cloudflare Workers Builds**, configured in the Cloudflare dashboard — not through a GitHub Actions workflow file. Every push that triggers a build runs:

- **Build command**: `npm run ci` (`typecheck && test:worker && build`)
- **Deploy command**: `npx wrangler deploy`
- **Version command**: `npx wrangler version upload`

`wrangler.toml` defines what ships: the `marketpulse` Worker, the `DB` binding to the `marketpulse-db` D1 database, the daily cron trigger, and the static assets directory (`dist/market-pulse/browser/pl`).

**D1 migrations are not applied automatically on deploy.** After deploying a change that adds a migration file, apply it to the remote database by hand:

```bash
npm run migrate:remote
```

## CI / quality gate

`main` has a required GitHub branch-protection status check named **`Workers Builds: marketpulse`**. It must pass before any PR can merge, and it runs the same `npm run ci` build command described above (typecheck + backend test suite + Angular build).

This check is configured entirely in the Cloudflare dashboard as a GitHub-App-based status check — it will not show up if you search the repo for `.github/workflows/`, husky hooks, or lint-staged config. If you need to re-verify it, check branch protection directly:

```bash
gh api repos/mswiac/market-pulse/branches/main/protection
```

## Mutation testing

[Stryker](https://stryker-mutator.io/) is set up (`stryker.config.json`) as an optional, manual quality gate on top of `npm run test:worker` — it is **not** part of `npm run ci` and does not gate PRs. Run it by hand when you want to check whether a test suite actually catches bugs, not just executes the code:

```bash
npx stryker run                                    # full configured scope
npx stryker run --mutate "src/worker/lib/rsi.ts"   # a single file — much faster, prefer this
```

Currently scoped to `src/worker/**` only, since `src/app/**` (Angular) has no test coverage yet. As `context/foundation/test-plan.md`'s rollout phases land — starting with Phase 3 (Angular component tests) — extend `stryker.config.json`'s `mutate` array to cover the newly-tested code, then run Stryker and address the survived mutants it surfaces.

See `CLAUDE.md`'s "Mutation testing" section for how to scope a run and a known gotcha with this repo's Worker test style. Reports land at `reports/mutation/mutation.html` (gitignored).

## Project structure notes

- `context/` — the 10x-\* change-tracking structure: `context/changes/` holds in-flight work (research, plans, reviews), `context/archive/` holds completed work, and `context/foundation/` holds living project documents (roadmap, test plan, lessons learned).
- `test/worker/` — the backend test suite (Vitest + `@cloudflare/vitest-pool-workers`), run via `npm run test:worker`.
