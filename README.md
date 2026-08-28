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
npm run test:worker   # Vitest + @cloudflare/vitest-pool-workers — backend suite
npm run test:ci       # Angular component tests (Vitest via @angular/build:unit-test, no watch)
```

Run those three directly rather than `npm run ci` on your machine — `npm run ci`
chains `npm run test` (`ng test`) in **watch mode** and never exits locally. It
only works in real CI, where `CI=true` makes the Angular test builder disable
watch.

### End-to-end tests (Playwright)

Browser-level smoke tests live in `e2e/` — `seed.spec.ts` is the exemplar every
other spec is modeled on. They drive the **real running app**, so both dev
servers must be up (`npm run worker:dev` + `npm start`), plus a one-time setup:

- **Browsers**: `npx playwright install chromium` (on Linux/WSL also
  `sudo npx playwright install-deps chromium` for the system libraries).
- **A test account**: register one at `http://localhost:4200/register`, then put
  its credentials in `e2e/.env` (gitignored):

  ```
  E2E_EMAIL=you@example.test
  E2E_PASSWORD=your-password
  ```

  The Playwright `setup` project logs in once with these and saves the session
  to `playwright/.auth/user.json` (gitignored, ~7-day sliding TTL); every other
  spec starts already authenticated via `storageState`. If specs suddenly
  redirect to `/login`, the saved session expired — delete the file and re-run.

```bash
npx playwright test            # all specs (runs the login setup first)
npx playwright test seed       # a single spec
npx playwright test --ui       # watch / debug
npx playwright show-report     # HTML report from the last run
```

Not wired into CI yet, and never run against the deployed Cloudflare shape —
only the local dev servers. Rationale and the risk each spec protects:
`context/foundation/test-plan.md` §3 Phase 6 and §6.6.

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

[Stryker](https://stryker-mutator.io/) is set up as an optional, manual quality gate — it is **not** part of `npm run ci` and does not gate PRs. Run it by hand when you want to check whether a test suite actually catches bugs, not just executes the code. Two separate config profiles exist, since the Worker and Angular test setups need different Stryker runners:

```bash
# Worker (src/worker/**), on top of npm run test:worker
npx stryker run                                              # full configured scope
npx stryker run --mutate "src/worker/lib/rsi.ts"              # a single file — much faster, prefer this

# Angular (src/app/**), on top of npm run test:ci
npx stryker run --configFile stryker.config.app.json
npx stryker run --configFile stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts"
```

The Angular profile (`stryker.config.app.json`) uses Stryker's `command` runner instead of the dedicated Vitest runner, since `ng test` runs through Angular's native `@angular/build:unit-test` builder, which doesn't expose a standalone Vitest config for the dedicated runner to drive. This means the full Angular suite reruns per mutant (no per-test coverage narrowing) — slower than the Worker profile, but the only option that works against the native builder today.

See `CLAUDE.md`'s "Mutation testing" section for how to scope a run, the Angular profile's rationale, and a known gotcha with this repo's Worker test style. Reports land at `reports/mutation/mutation.html` (gitignored).

## Project structure notes

- `context/` — the 10x-\* change-tracking structure: `context/changes/` holds in-flight work (research, plans, reviews), `context/archive/` holds completed work, and `context/foundation/` holds living project documents (roadmap, test plan, lessons learned).
- `test/worker/` — the backend test suite (Vitest + `@cloudflare/vitest-pool-workers`), run via `npm run test:worker`.
- `src/app/**/*.spec.ts` — Angular component tests (Vitest via `@angular/build:unit-test`), colocated with each component, run via `npm run test:ci`.
- `e2e/` — Playwright browser-level tests (see "End-to-end tests" above); one scenario per file, `seed.spec.ts` is the exemplar the others follow.
