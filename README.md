# MarketPulse

MarketPulse is a stock market alert web app. Users set price- or RSI-based alerts and get an email notification when a threshold is crossed. The instrument registry ships seeded with the VIX and NASDAQ-100 indices, but an admin can add more instruments through the admin panel — US stocks and GPW-listed Polish stocks (fetched via a ticker + `.WA` suffix) are both supported. Market data for every registered instrument is fetched once a day from Yahoo Finance via a Cloudflare Cron Trigger, which also calculates RSI and evaluates every active alert.

## What's in the app

A dashboard with the latest close of every instrument, an alerts page (filters, plus pause/resume so an alert can be switched off without deleting it), trigger and per-instrument price history, and an admin panel for admins. Full descriptions: [`context/foundation/app-overview.md`](context/foundation/app-overview.md).

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

`ADMIN_EMAILS` is a comma-separated list of emails that get admin panel access (see `context/foundation/app-overview.md`). The others are only exercised when an alert actually fires and tries to send an email.

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

### Internationalization (i18n)

The Angular app's source locale is `en-US`; every user-facing template string carries an `i18n="@@key"` attribute. Polish translations live in `src/locale/messages.pl.xlf` and are baked into a separate `pl` output at build time (`angular.json`'s `i18n.locales.pl`) — that's the bundle both `npm start` (`development-pl` config) and production (`wrangler.toml`'s assets directory `dist/market-pulse/browser/pl`) actually serve. After adding or changing an `i18n`-tagged string, refresh the translation source file with:

```bash
npm run extract-i18n   # ng extract-i18n --output-path src/locale
```

then fill in the new/changed `<trans-unit>` entries in `messages.pl.xlf` by hand.

### Checks before pushing

A Husky **pre-commit** hook runs `npm run typecheck && npx lint-staged`. `lint-staged` (config in `.lintstagedrc.mjs`) runs ESLint on every staged `.ts`/`.html` file, and — for staged files under `src/worker/lib/`, `src/worker/routes/`, `src/worker/scheduled.ts`, or `test/worker/`— also runs that file's mapped Vitest test, so a broken worker test can fail the commit, not just lint. A separate **pre-push** hook runs automatically:

- always: `npm run test:worker` + `npm run test:ci` (worker + Angular component
  suites, ~20s, no servers needed);
- E2E (`npx playwright test`): **only** when the push touches `e2e/` or
  `src/app/`, and only if the local E2E setup exists (`e2e/.env` + installed
  browsers) — otherwise it is skipped with a warning, never blocking.

Bypass with `git push --no-verify`. To run the checks by hand:

```bash
npm run typecheck     # tsc --noEmit for both the Angular app and the Worker
npm run lint          # eslint . — full-repo lint (lint-staged only checks staged files)
npm run test:worker   # Vitest + @cloudflare/vitest-pool-workers — backend suite
npm run test:ci       # Angular component tests (Vitest via @angular/build:unit-test, no watch)
```

Run those directly rather than `npm run ci` on your machine — `npm run ci`
chains `npm run test` (`ng test`) in **watch mode** and never exits locally. It
only works in real CI, where `CI=true` makes the Angular test builder disable
watch.

### End-to-end tests (Playwright)

Browser-level smoke tests live in `e2e/` — `seed.spec.ts` is the exemplar every
other spec is modeled on. They drive the **real running app**. One-time setup:

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

- **An admin account**: for specs under `e2e/admin/`. Use an account whose email
  is listed in `ADMIN_EMAILS` in `.dev.vars` (your local dev admin works), and add
  its credentials to the same `e2e/.env`:

  ```
  E2E_ADMIN_EMAIL=admin@example.test
  E2E_ADMIN_PASSWORD=your-admin-password
  ```

  The `setup-admin` project logs in with these and saves
  `playwright/.auth/admin.json`; the `chromium-admin` project runs the
  `e2e/admin/` specs with it, while all other specs run as the non-admin user.
  Without these variables the admin setup fails with a clear message.

`playwright.config.ts` has a `webServer` block, so you don't need to start the
dev servers yourself — if `:8787` / `:4200` aren't already up, Playwright boots
them (`reuseExistingServer: true` means it reuses yours when they are).

```bash
npx playwright test            # all specs (boots servers + login setup as needed)
npx playwright test seed       # a single spec
npx playwright test --ui       # watch / debug
npx playwright show-report     # HTML report from the last run
```

In CI these run via `.github/workflows/e2e.yml` (GitHub Actions, on PRs and
pushes to `main`) — same specs, same local dev servers, spun up on an
`ubuntu-latest` runner with an ephemeral offline Miniflare D1 and a seeded
throwaway test account. It is **informational**, not a required
branch-protection check (the required gate stays `Workers Builds: marketpulse`).
Never run against the deployed Cloudflare shape — only local dev servers.
Rationale and the risk each spec protects:
`context/foundation/test-plan.md` §3 Phase 6 and §6.6.

## Deployment

Deployment runs through **Cloudflare Workers Builds**, configured in the Cloudflare dashboard — not through a GitHub Actions workflow file. Every push that triggers a build runs:

- **Build command**: `npm run ci` (`typecheck && test:worker && build`)
- **Deploy command**: `npx wrangler deploy`
- **Version command**: `npx wrangler version upload`

`wrangler.toml` defines what ships: the `marketpulse` Worker, the `DB` binding to the `marketpulse-db` D1 database, the cron triggers (a GPW fetch at 16:30 UTC, a US and index fetch at 23:00 UTC, and one alert evaluation at 23:15 UTC), and the static assets directory (`dist/market-pulse/browser/pl`).

**Cron failure notices.** When a scheduled invocation (GPW fetch, US fetch, or alert evaluation) has problems — failed tickers, a failed D1 write or load, alert emails that did not go out, market data older than 12 hours, or an unexpected exception — the Worker emails a summary to `RESEND_VERIFIED_EMAIL`. A failure to send that notice is only logged. A ticker whose fetch failed is also stale at the evaluation, so one cause can produce a fetch mail and an evaluation mail on the same day. The manual admin run does not send it; its result is shown on the page instead.

**D1 migrations are not applied automatically on deploy.** After deploying a change that adds a migration file, apply it to the remote database by hand:

```bash
npm run migrate:remote
```

## More documentation

- [`context/foundation/app-overview.md`](context/foundation/app-overview.md) — pages and admin panel
- [`context/foundation/admin-panel-notes.md`](context/foundation/admin-panel-notes.md) — deletion cascades and manual cron run mechanics
- [`context/foundation/ci-and-repo-notes.md`](context/foundation/ci-and-repo-notes.md) — CI / quality gate and repository layout
- [`context/foundation/stryker-notes.md`](context/foundation/stryker-notes.md) — mutation testing profiles
- [`context/foundation/test-plan.md`](context/foundation/test-plan.md) — test strategy and rollout
