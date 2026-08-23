# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-22 (post-implementation refresh — all 17 roadmap
> slices done; see `context/changes/test-plan-refresh-2026-08-22/`)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `migrations/`. Git
history over the last 30 days now shows real signal: `src/app/features`
(the Angular frontend) is the highest-churn area in the repo at 14 commits
/ 83 file touches; `src/worker/lib` shows 14 touches (`market-data.ts` 5,
`instruments.ts` 3, `rsi.ts` 2, `alert-evaluation.ts` 2, `resend.ts` 1,
`admin.ts` 1). Likelihood ratings below combine this churn data with PRD,
roadmap, and the current codebase state as grounded in
`context/changes/test-plan-refresh-2026-08-22/research.md`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | S-08 (daily high/low evaluation) introduced `resolveFiringValue`/`conditionMet` logic in `alert-evaluation.ts` with no independent oracle, unlike `rsi.ts` — a regression here could silently mis-fire or silently fail to fire an alert | High | Medium | User-stated least-confident area (interview); highest backend churn (14 touches/30d — `market-data.ts` 5, `instruments.ts` 3, `rsi.ts` 2, `alert-evaluation.ts` 2, `resend.ts` 1, `admin.ts` 1); research.md confirms `rsi.ts` has an external Python oracle but the S-08 high/low logic does not, plus three untested branches (`avgGain === 0`, `buildEmail` line-omission, asymmetric-null case) |
| 2 | Threshold crossed, no email sent — a thrown `fetch()` (network/DNS/timeout) inside `resend.ts` is uncaught, propagates to a generic catch that only `console.error`s, and writes no `trigger_events` row at all | High | Medium | User's top-stated concern; PRD NFR ("missed notification is core product failure"); research.md confirms a real, currently-unguarded gap — `resend.ts:23-42` catches only non-ok HTTP responses, not a throwing `fetch` |
| 3 | Multi-provider fetch (Yahoo + `.WA` suffix for GPW, self-correcting currency) silently corrupts `price_history`/`market_data` joins by leaking a suffixed symbol into a DB key | High | Low | Roadmap F-04 flagged the ticker-vs-suffix split as capable of silent corruption; research.md found this is NOT happening today — ticker/suffix kept separate at all call sites, DB writes always keyed on bare `ticker`, verified by explicit negative-assertion tests; remaining gap is narrower — no side-by-side bare/suffixed assertion in one test |
| 4 | Zero automated frontend coverage (Angular, `src/app/features`) — Alert Form's custom and cross-field validators regress silently since no `.spec.ts` file exists anywhere under `src/` | Medium | Medium | User's stated under-tested concern; highest overall repo churn (83 file touches/30d); research.md found validation logic is better than assumed (Alert Form has custom + cross-field validators) but a tooling contradiction exists — `CLAUDE.md` claimed Karma, but no Karma package exists and `tsconfig.spec.json` already declares `vitest/globals` |
| 5 | Cascading/orphaned deletes in the admin panel (S-11 instrument removal, S-12 user removal) behave differently on remote D1 than on local D1 | High | Low-Medium | Roadmap left block-vs-cascade as an unresolved unknown for S-11; S-12's cascade verified only against local D1; research.md confirms the split is intentional and well-tested locally but `PRAGMA foreign_keys` is never explicitly set anywhere and no test or manual check has ever run against remote D1 |
| 6 | Cross-user isolation / IDOR across alert and admin endpoints — a request from one user reaches another user's data | High | Low | PRD NFR (isolation); abuse/authorization lens; research.md found this is the strongest-covered risk already — `user_id` scoping is baked into every SQL statement, admin gate is a single non-bypassable middleware, with explicit two-user isolation tests already in place |
| 7 | Resource abuse via repeated wide-range admin backfill (S-09) against the tight Workers Free CPU budget | Medium | Low | Abuse lens (resource abuse); roadmap F-02 risk note on CPU budget; research.md confirms a hard cap (`MAX_RANGE_DAYS = 730`) exists and is boundary-tested but was sized by reasoning, never benchmarked, and no rate limiting exists at all |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` grounded | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | An independent/external check that `resolveFiringValue`/`conditionMet` resolve high/low/close correctly per direction, not just self-consistency — plus coverage of the `avgGain === 0`, `buildEmail` line-omission, and asymmetric-null branches | "it runs without throwing = it's correct" — `alert-evaluation.test.ts` has no external oracle today, only self-consistency assertions | `rsi.ts` already has an external Python oracle (`rsi.test.ts:4-18`); `alert-evaluation.ts`'s S-08 logic (`resolveFiringValue`/`conditionMet`, `:76-97`) has none; three specific untested branches identified: `rsi.ts`'s `avgGain === 0`, `buildEmail`'s high/low line-omission (`:34-66`), and the asymmetric-null case (only "both null" is covered today, `alert-evaluation.test.ts:343-356`) | Unit tests targeting the three named gaps directly — existing Vitest + Workers pool setup already covers this file | Assuming `rsi.ts`'s oracle discipline extends to `alert-evaluation.ts` by association |
| #2 | Resend is called with correct `to`/`subject`/`text` args (not just DB state), plus a test that a throwing `fetch` (not just a non-ok response) is caught and recorded rather than silently dropped | "`trigger_events.email_status === 'sent'` proves the email was sent" — every existing assertion checks DB state only, and the test's own unconditional 200-stub would set that value regardless of what was actually sent (`alert-evaluation.test.ts:130`) | `resend.ts:23-42` wraps only the non-ok-response path; a thrown `fetch` propagates uncaught to `alert-evaluation.ts`'s generic per-alert catch (`:116,159-161`), which only `console.error`s — no `trigger_events` row is written and the alert stays `armed = 1` | Unit test with a rejecting `fetch` mock, once `resend.ts` gains the try/catch fix (Phase 1 scope) that makes the failure observable instead of silently swallowed | Only testing the non-ok-HTTP-response path (already covered) and calling notification risk closed |
| #3 | `price_history`/`market_data` always key on bare `ticker`, verified across all instrument types side-by-side (bare + suffixed) in one assertion, not just the negative case per-type | The original worry ("the suffix distinction is untested") — research.md found this already false; the real remaining gap is narrower | Ticker/suffix kept separate at every call site (`scheduled.ts:50`, `admin.ts:74`); `upsertPriceHistory` always binds the bare `ticker` param (`market-data.ts:149-158`); negative assertions already exist (`scheduled.test.ts:239`, `admin.test.ts:302`); "self-correcting currency" (`buildCurrencyCorrection`, `market-data.ts:135-143`) is also already tested | One additional unit test asserting a bare and a suffixed ticker side-by-side in the same test | Re-testing what's already well-covered (suffix-vs-DB-key separation) instead of the actual remaining gap |
| #4 | Admin/alert forms reject invalid input before it reaches the API — Alert Form's custom + cross-field validators (`positiveNumberValidator`, RSI min/max, dynamic threshold-control swap) actually behave as coded | The roadmap's "non-empty-only" assumption — research.md found Alert Form and Register both exceed that (custom validators, `minLength`); only Login and Add Instrument are required-only as assumed | `alert-form.ts:18-23,72,101-111` has custom + dynamic cross-field validation; zero `.spec.ts` files exist anywhere under `src/`; `CLAUDE.md` documented Karma but no Karma package exists and `tsconfig.spec.json:8` already declares `vitest/globals` | Angular component tests via Vitest, starting with Alert Form's cross-field logic — the richest untested surface | Bootstrapping Karma to match the stale doc instead of using the tooling the project already half-configured |
| #5 | Instrument/user removal on remote D1 behaves identically to local (cascade or block, per the documented per-resource decision) | "a passing local-D1 test proves the migration's FK behavior in production" — `PRAGMA foreign_keys` is never explicitly set anywhere, so this is currently an assumption | Instrument removal is a manual application-level cascade (`admin.ts:227-233`, no FK on `instruments.ticker`); user removal relies on DB-level `ON DELETE CASCADE`/`SET NULL` (`migrations/0004`, `0008:32`, `0011:13,75`); both well-tested locally (`admin.test.ts:592-643,826-860`); the S-12 plan explicitly states remote behavior "is assumed... rather than separately verified" | One-time manual `wrangler d1 execute --remote` check — not an automated recurring CI step, matching the project's existing "no D1 migration SQL correctness automation" convention (§7) | Treating a passing local-D1 test as proof of remote behavior when `PRAGMA foreign_keys` is never explicitly set in code |
| #6 | A request authenticated as one user/non-admin against another user's resource, or an admin session against a non-admin route using someone else's resource ID, returns 403/404 | Treating this as an open risk at all — research.md found it's already the strongest-covered risk in the codebase; the real question is whether the two narrow remaining gaps matter | `user_id` scoping is baked into every SQL statement across `alerts.ts:204-301` and `trigger-events.ts:47-59` (no fetch-then-check window); `adminMiddleware` (`lib/admin.ts:14-23`) re-derives admin status from D1 per request; `alerts.test.ts` has 3 two-user isolation tests, `admin.test.ts` has 401+403 on all 7 admin routes; the only gaps are an admin-session-vs-non-admin-route cross-user test and a two-admin scenario | Two small integration tests closing the two named gaps — reuses the existing two-fixture-user pattern | Spending budget broadly re-testing isolation that's already well-proven instead of the two specific named gaps |
| #7 | Repeated wide-range admin backfill calls stay within a bounded CPU/latency envelope, not just that the 730-day boundary is rejected | "the cap exists, therefore abuse is prevented" — `MAX_RANGE_DAYS = 730` was sized by reasoning, never benchmarked, and there is no rate limiting at all | `admin.ts:8,37-100` defines the cap and rejects >730 days (`admin.test.ts:210-218`); the figure assumes ~500 trading days ≈ one Yahoo fetch + one ~500-statement D1 batch "within D1 limits" per the original admin-panel plan, but no test exercises a near-730-day range to observe actual CPU time; rate limiting was explicitly scoped out for "a single-admin, low-frequency internal tool" | Unit/integration test on a near-730-day boundary range observing actual execution time/D1 batch size, within the project's tight Workers Free CPU budget | Treating the existing boundary-rejection test (which only proves >730 is rejected) as proof that 730 itself is safe under the Free plan's CPU budget |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Notification/evaluation pipeline regression audit | Verify existing tests actually prove protection for risks #1 and #2 post-S-08; close identified gaps, including a `resend.ts` fetch-throw fix | #1, #2 | unit (Workers runtime emulation) | shipped | `context/changes/notification-pipeline-test-audit/` |
| 2 | Multi-provider + admin-delete data integrity | Verify risk #3's side-by-side coverage gap and risk #5's remote D1 cascade behavior via a one-time manual check | #3, #5 | unit + one-time manual remote D1 check | not started | — |
| 3 | Frontend test bootstrap | First Angular component tests (Alert Form validators, admin panel forms) via Vitest, addressing risk #4 | #4 | component (Vitest) | not started | — |
| 4 | Abuse-lens closure + local quality-gate hook | Close risks #6 and #7's narrow remaining gaps; add the still-open local post-edit hook | #6, #7 | integration + local tooling | not started | — |

**Scope notes** (grounded in this refresh's planning decisions — see `context/changes/test-plan-refresh-2026-08-22/plan.md`'s Key Discoveries):

- **Phase 1**: covers risks #1 and #2. Includes *fixing* the uncaught-`fetch`-throw gap in `resend.ts` (a small `try/catch` addition), not just testing the current silent-failure behavior, and a quick check of whether `market-data.ts`'s Yahoo `fetch` call has the same uncaught-throw pattern.
- **Phase 2**: covers risks #3 and #5. Includes one one-time manual `wrangler d1 execute --remote` verification of `PRAGMA foreign_keys` + cascade behavior, not an automated recurring CI step.
- **Phase 3**: covers risk #4. Uses Vitest for Angular component tests, not Karma — `tsconfig.spec.json` already declares `vitest/globals` and no Karma package exists in the repo.
- **Phase 4**: covers risks #6 and #7, plus the still-open local post-edit hook (§5). Drops the "wire `npm run ci` as an actually-enforced gate" item from the original proposal — research confirmed it's already enforced via Cloudflare Workers Builds (see §5).

If phases must be sequenced under time pressure, Phase 1 is the top priority — it covers both the user's top-stated concern (risk #2) and the one confirmed real code gap.

## 4. Stack

The classic test base for this project. No AI-native layer — all
high-risk logic is deterministic; classic unit + integration gives full
signal at a fraction of the cost.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration (Worker) | Vitest + `@cloudflare/vitest-pool-workers` | latest | Workers runtime emulation; D1 binding available in test context; none yet — see §3 Phase 1 |
| HTTP edge mocking (Stooq / Resend) | Vitest built-in mocks or MSW | latest | Mock only at the HTTP edge; never mock internal Worker modules; none yet — see §3 Phase 1 |
| Angular component tests | Vitest (not Karma — see §3 Phase 3 scope notes) | latest | `tsconfig.spec.json` already declares `vitest/globals`; no separate Angular-specific test runner (Karma) is being introduced — none yet, see §3 Phase 3 |
| e2e | none planned for MVP | — | No critical flow requires the full deployed Workers shape at this scale |

**Stack grounding tools (current session):**
- Docs: none — not available in current session; stack evidence from local manifests only; checked: 2026-08-22
- Search: none — not available in current session; checked: 2026-08-22
- Runtime/browser: none — not available in current session; checked: 2026-08-22
- Provider/platform: none — not available in current session; checked: 2026-08-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI (Cloudflare Workers Builds: "Workers Builds: marketpulse") | required — enforced via Cloudflare Workers Builds status check on `main` | syntactic / type drift |
| unit + integration (Worker) | local + CI (Cloudflare Workers Builds: "Workers Builds: marketpulse") | required — enforced via Cloudflare Workers Builds status check on `main` | pipeline logic regressions, isolation failures |
| post-edit hook | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time |
| pre-prod smoke (health + manual eval trigger) | between merge + prod | optional | environment-specific failures on Cloudflare |

Cloudflare Workers Builds is a GitHub-App-based required status check
(app_id 85455) configured in the Cloudflare dashboard, not a
`.github/workflows/*.yml` file — its build command is `npm run ci`
(`typecheck && test:worker && build`), so both gates above already run and
block merge to `main` on every PR. Verify directly with
`gh api repos/mswiac/market-pulse/branches/main/protection` rather than
searching the repo for workflow files, which won't find it.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, it reads "TBD."

### 6.1 Adding a Worker unit test

Give each `src/worker/lib/*.ts` module its own `test/worker/<module>.test.ts`
file (`rsi.ts` → `rsi.test.ts`, `resend.ts` → `resend.test.ts`). Import the
D1-backed `env` from `'cloudflare:workers'` (Vitest +
`@cloudflare/vitest-pool-workers` provides the Workers runtime emulation
and D1 binding automatically per `vitest.config.mts`) — but only reach for
`env.DB` when the function under test actually touches the database. A
pure function (e.g. `sendAlertEmail`, `buildEmail`, `calculateRSI`) needs
no D1 setup at all; construct its inputs as plain object literals and
assert on its return value directly. See `test/worker/resend.test.ts` and
`test/worker/rsi.test.ts`'s `avgGain === 0` case for the pattern.

When a module's core logic is a private helper you need to unit test
directly (rather than only through the public function that calls it),
export it — see `buildEmail` in `alert-evaluation.ts`, tested directly in
`test/worker/alert-evaluation.test.ts`'s `describe('buildEmail')` block.

### 6.2 Adding a Worker integration test

TBD — see §3 Phase 2.

### 6.3 Adding a test with an external service stub

Stub only at the HTTP edge (`fetch`) — never mock an internal Worker
module. Use `vi.stubGlobal('fetch', vi.fn().mockImplementation(...))` in
the test, and `vi.unstubAllGlobals()` in an `afterEach` so the stub
doesn't leak into later tests. Cover each outcome the real service can
produce as a separate case: success (assert the request URL/headers/body,
not just the return value), a pre-flight rejection that never reaches the
service at all (e.g. an unverified recipient — assert `fetch` wasn't
called), a non-ok HTTP response (both a JSON and a non-JSON error body,
since the error-parsing path has its own fallback — and, when the failure
can be transient vs. permanent, assert that distinction per status code
too, e.g. 5xx vs. 4xx), and a rejecting `fetch` (network/DNS/timeout) —
the last one exercises a different code path than a non-ok response and
is easy to forget. See `test/worker/resend.test.ts` for all five cases
against Resend.

When a test needs to fail only one of several concurrent calls (e.g. one
alert's send fails while others in the same `evaluateAlerts` run succeed),
match on a marker in the request body rather than call order — see
`stubFetchThrowingFor` in `test/worker/alert-evaluation.test.ts`, which
fails only the request whose body mentions a given ticker.

### 6.4 Adding a test for a new API endpoint

TBD — see §3 Phase 2. Rule of thumb: prefer integration test over e2e
unless the failure mode requires the full deployed Worker shape.

### 6.5 Adding an Angular component test

Colocate `<name>.spec.ts` next to the component it tests (e.g.
`alert-form.ts` → `alert-form.spec.ts`) — matches `tsconfig.spec.json`'s
`src/**/*.spec.ts` include, and is picked up automatically by the `test`
architect target (`@angular/build:unit-test`, `runner: "vitest"`, jsdom).
Run via `npm run test -- --watch=false` (already part of `npm run ci`).

Render via `@testing-library/angular`'s `render()` — import from the
**`/zoneless`** subpath (`@testing-library/angular/zoneless`), not the
package root, since this app has no `zone.js` dependency and runs
zoneless by default. The zoneless `render()` returns a `fixture` you call
`fixture.detectChanges()` on after any change made outside a DOM event
(e.g. driving a `FormControl` directly via `.setValue()`) — the zoneless
change-detection scheduler doesn't pick up mutations made from test code,
only from real DOM events or signal writes it's already tracking.

Provide an explicit stub for **every** injected service or token — a
missing one throws at render time, not silently. Two easy-to-miss cases
seen in practice: `MatDialogRef` is injected without `{ optional: true }`
in dialog components (`NullInjectorError` if omitted), and `RouterLink`
directives inject `ActivatedRoute` even when the component never reads
route data (`NG0201` if omitted — provide `{ provide: ActivatedRoute,
useValue: {} }`).

Drive form/validator behavior by mutating the component's (often
`protected`) `FormGroup` directly — `(fixture.componentInstance as
unknown as { form: YourForm['form'] }).form` — rather than simulating
every keystroke; this exercises the same `valueChanges` subscriptions and
validators the real UI does, since `.setValue()` on a `FormControl`
behaves identically regardless of what triggered it. Assert through the
rendered DOM (`screen.findByText(...)` for `mat-error` visibility, not the
component instance's error state directly) so the test fails if the
template stops rendering the message, not only if the validator logic
breaks. Server-driven states not reachable through client-side validators
(e.g. a manually-set `setErrors({ server: true })` after an HTTP 409) need
a stubbed service method that returns a rejecting Observable — see
`register.spec.ts`'s 409 case.

See `src/app/features/alerts/alert-form/alert-form.spec.ts` (custom
validator + two reactive cascades) and
`src/app/features/auth/register/register.spec.ts` (required/format/length
validators + a server-error path) for full examples.

`vitest.config.mts` (the `test:worker` config) scopes `test.include` to
`test/worker/**/*.test.ts` specifically so it does NOT also pick up
`src/app/**/*.spec.ts` — Vitest's default glob would otherwise match both,
and the Workers runtime emulation in that config has no Angular JIT
compiler, so any Angular spec files it picked up fail immediately with a
"needs to be compiled using the JIT compiler" error. Keep new Angular spec
files under `src/app/` (matched only by the `test` architect target) and
new Worker test files under `test/worker/` (matched only by
`vitest.config.mts`) — don't let the two glob scopes overlap.

## 7. What We Deliberately Don't Test

- **Angular component snapshot tests** — components with real business logic
  now exist (e.g. Alert Form's custom and cross-field validators, see §2
  Risk #4), so this is no longer a "nothing to test yet" gap. It stays
  deliberately deferred even now that Phase 3 has shipped behavioral
  component tests (§6.5): snapshot tests would still break constantly on
  layout/form changes and catch nothing a typed template check or a
  behavioral Vitest test doesn't already catch first. Re-evaluate only if
  a real regression class emerges that behavioral tests demonstrably miss.
  (Source: research.md Risk #4 finding; tech-stack.md `skipTests: true`
  global default.)
- **E2e against the live Cloudflare deployment** — Workers runtime emulation
  in Phase 1 gives sufficient signal at MVP scale with a single user.
  Re-evaluate when multi-user concurrency or Cloudflare-specific routing
  becomes a documented risk.
- **D1 migration SQL correctness** — migrations are forward-only SQL with
  manual verification steps baked into each slice plan (local + remote
  `PRAGMA table_info` checks). Automated migration tests add complexity
  without proportional signal at this scale.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-22
- Stack versions last verified: 2026-08-22
- AI-native tool references last verified: n/a (no AI-native layer)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
