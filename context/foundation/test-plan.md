# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-22 (post-implementation refresh — all 17 roadmap
> slices done; see `context/archive/2026-08-22-test-plan-refresh-2026-08-22/`).
> §3 Phased Rollout table corrected 2026-08-24 — Phases 2-4 marked
> "shipped" with their archive paths; each phase's own plan had
> deliberately left this status update to the `/10x-test-plan`
> orchestrator, which was never re-run after Phase 2 (see
> `context/archive/2026-08-23-multi-provider-admin-delete-integrity/plan.md`'s
> "What We're NOT Doing"). No change to strategy (§1-§2) or risk map.
>
> Refreshed again 2026-08-25 — added Risk #8 (admin panel zero
> component-test coverage) and §3 Phase 5; recorded the PR #91
> mutation-testing sweep in §4/§8 (test-only, no risk-map change of its
> own — Risk #8 is a separate, interview-sourced addition). See
> `context/archive/2026-08-25-test-plan-refresh-2026-08-25/`.
>
> 2026-08-28 — added §3 Phase 6 (browser-level E2E smoke), §6.6, and an
> §8 ledger entry; §4 e2e row changed from "none planned for MVP" to
> Playwright. No risk-map change — the two scenarios cover the
> browser-only facets of existing risks #4 and #6, not new risks. Added
> as a 10xDevs Module 3 Lesson 4 practical exercise, not a
> `/10x-test-plan --refresh`.

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
`context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md`.

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
| 8 | Admin panel (Angular) has zero component-test coverage across 6 components (admin-panel, add-instrument, remove-instrument[-confirm], remove-user[-confirm]) handling destructive/irreversible actions and non-trivial form logic (type→suffix mapping) | High | Medium | User interview (2026-08-25); 5 commits/30d in src/app/features/admin/ (S-09..S-12, shipped in the last 3 weeks); zero test coverage confirmed (research.md); roadmap S-11 risk note (no FK safety net — cleanup logic lives in the delete endpoint, so UI must send the right target) |

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
| #8 | Confirm/cancel dialogs call the delete service only on explicit confirmation; add-instrument's type→suffix mapping and ticker-uppercase-on-blur behave as coded; each component's error-code map renders the correct message | "it's just a confirm dialog, too simple to break" — nothing today proves the UI sends the right id/payload or that the dialog can't be bypassed | research.md confirms none of the 6 components use FormGroup (all signal-based, `admin-panel.ts:53-67`, `add-instrument.ts:53-59`); MatDialog (non-optional) is injected by the two "opener" components (`remove-instrument.ts:35`, `remove-user.ts:33`), while the two `*-confirm` dialog components (`remove-instrument-confirm.ts:16`, `remove-user-confirm.ts:17`) never inject MatDialogRef directly — the `mat-dialog-close` template directive (`remove-instrument-confirm.html:15-16`) requires it from TestBed providers regardless; both delete flows (`remove-instrument.ts:76-118`, `remove-user.ts:44-94`) share a repeated impact-preview→confirm→delete pattern; `add-instrument.ts:19-21,67-72`'s type→suffix mapping rounds out the remaining component's untested logic | Angular component tests via Vitest + `@testing-library/angular/zoneless` — same tooling as §6.5, but needs a new signal-driven testing pattern since §6.5's FormGroup-cast trick doesn't apply here | Assuming §6.5's existing FormGroup-driven pattern transfers directly to these components without adaptation |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Notification/evaluation pipeline regression audit | Verify existing tests actually prove protection for risks #1 and #2 post-S-08; close identified gaps, including a `resend.ts` fetch-throw fix | #1, #2 | unit (Workers runtime emulation) | shipped | `context/archive/2026-08-22-notification-pipeline-test-audit/` |
| 2 | Multi-provider + admin-delete data integrity | Verify risk #3's side-by-side coverage gap and risk #5's remote D1 cascade behavior via a one-time manual check | #3, #5 | unit + one-time manual remote D1 check | shipped | `context/archive/2026-08-23-multi-provider-admin-delete-integrity/` |
| 3 | Frontend test bootstrap | First Angular component tests (Alert Form validators, admin panel forms) via Vitest, addressing risk #4 | #4 | component (Vitest) | shipped | `context/archive/2026-08-23-frontend-test-bootstrap/` |
| 4 | Abuse-lens closure + local quality-gate hook | Close risks #6 and #7's narrow remaining gaps; add the still-open local post-edit hook | #6, #7 | integration + local tooling | shipped | `context/archive/2026-08-24-abuse-lens-closure/` |
| 5 | Admin panel component coverage | Component tests (Vitest) for all 6 admin-panel components, closing risk #8 | #8 | component (Vitest) | not started | — |
| 6 | Browser-level E2E smoke | Four Playwright specs for the risk facets only a rendered browser exercises — alert create→reload, auth-gate redirect, admin-gate redirect, alert delete confirm/cancel | #4 (browser facet), #6 (client-side auth facet, ×2) | e2e (Playwright, local dev server) | specs written + break-verified | — (10xDevs M3L4 exercise) |

**Scope notes** (grounded in this refresh's planning decisions — see `context/archive/2026-08-22-test-plan-refresh-2026-08-22/plan.md`'s Key Discoveries):

- **Phase 1**: covers risks #1 and #2. Includes *fixing* the uncaught-`fetch`-throw gap in `resend.ts` (a small `try/catch` addition), not just testing the current silent-failure behavior, and a quick check of whether `market-data.ts`'s Yahoo `fetch` call has the same uncaught-throw pattern.
- **Phase 2**: covers risks #3 and #5. Includes one one-time manual `wrangler d1 execute --remote` verification of `PRAGMA foreign_keys` + cascade behavior, not an automated recurring CI step.
- **Phase 3**: covers risk #4. Uses Vitest for Angular component tests, not Karma — `tsconfig.spec.json` already declares `vitest/globals` and no Karma package exists in the repo.
- **Phase 4**: covers risks #6 and #7. The local post-edit hook (§5) shipped separately in PR #90 before this phase's change folder was even opened, so `abuse-lens-closure` covered only risk #6/#7's two narrow test gaps (admin-session-vs-non-admin-route isolation, two-admin scenario, near-730-day backfill batch-size observation) — see `context/archive/2026-08-24-abuse-lens-closure/plan.md`. Drops the "wire `npm run ci` as an actually-enforced gate" item from the original proposal — research confirmed it's already enforced via Cloudflare Workers Builds (see §5).
- **Phase 5**: covers risk #8. Scope includes all 6 admin components named in Risk #8, including `admin-panel.ts`'s manual backfill form (Key Discovery #2) — not just the destructive-action components. §6.5's cookbook stays `TBD` for this phase's signal-driven (no-`FormGroup`) testing pattern until it actually ships (Key Discovery #3); `research.md` (`context/changes/test-plan-refresh-2026-08-25/research.md`) already documents the DI/dialog specifics per component for whoever picks this phase up. The `submitting`-flag / double-submit mutant class deferred by the Phase 5 Stryker pass (PR #112) was closed as a follow-up in issue #113 — see `context/archive/` once that change is archived; one equivalent mutant (`remove-user.ts` `id === null` guard, redundant with `canSubmit`) is documented and left alive.

- **Phase 6**: covers the browser-only facets of risks #4 and #6. The risk
  map has no dedicated E2E risk — §1 principle #1 (cost × signal) keeps
  logic at the cheapest layer, and every prioritized risk already sits at
  unit/integration/component. These two scenarios exist because a rendered
  browser is the only place their specific failure shows:
  - **Auth-gate redirect** — an unauthenticated browser hitting a protected
    route (`/`, `/history`, `/admin`) is redirected to `/login` by
    `authGuard`, and a mid-session 401 (expired D1 session) routes through
    `session-expired.interceptor` to `/login` without a crash. Crosses
    browser cookie handling ↔ `authGuard` ↔ Angular Router ↔ Worker session
    validation. Worker integration tests have no router or redirect; the
    guard/interceptor are only unit-testable in isolation. This is the
    client-side half of risk #6's authorization boundary.
  - **Alert create→reload round trip** — a logged-in user creates a price
    alert through the Alert Form dialog; after `POST /api/alerts` and a full
    page reload the alert is still listed with the exact threshold entered.
    Crosses `storageState` cookie ↔ `authGuard` ↔ reactive form ↔
    `POST /api/alerts` ↔ Hono ↔ D1 ↔ reload GET ↔ `AlertList` render.
    Component tests (Phase 3, §6.5) mock `AlertsService`/HTTP; worker tests
    don't render Angular — nothing today proves the data survives the full
    round trip. This is the browser facet of risk #4's frontend surface.
  - **Admin-gate redirect** — a logged-in *non-admin* navigating to any
    `/admin*` route is redirected to `/` by `adminGuard`, and the shell's
    "Administrator" nav group is not rendered. Crosses `storageState` ↔
    `GET /api/me` (server-derived `isAdmin`) ↔ `adminGuard` ↔ Router ↔ shell.
    A second client-side facet of risk #6, distinct from auth-gate (which is
    the *unauthenticated* case).
  - **Alert delete confirm/cancel** — from the alert list, confirming the
    delete dialog removes the alert and it stays gone after a full reload;
    cancelling leaves it intact. Crosses the MatDialog confirm/cancel branch ↔
    `DELETE /api/alerts/:id` ↔ D1 ↔ reload GET. The dialog-guard branching and
    the delete's persistence only exist in the rendered flow; loosely in the
    risk #4 / risk #8 area.

  Generation goes through `/10x-e2e` (seed + anti-pattern review +
  deliberate-break VERIFY), never hand-written from scratch. E2E stays the
  slowest and most brittle layer — these four are smoke coverage of the
  highest-value browser-only failure modes, not a sweep. Runs locally and,
  once stable, wires into the existing CI pipeline (§5). Not run against the
  deployed Cloudflare shape (§7).

  **State (2026-08-28):** four specs exist and pass —
  `e2e/seed.spec.ts` (alert create→reload; doubles as the seed exemplar),
  `e2e/auth-gate-redirect.spec.ts` (4 tests), `e2e/admin-gate-redirect.spec.ts`
  (4 tests), `e2e/delete-alert.spec.ts` (2 tests); prompts under
  `e2e/prompts/`. All reviewed against the five anti-patterns and confirmed to
  go red under a deliberate break of the protected behavior (`authGuard`,
  `adminGuard`, the alert `POST`/`DELETE` persistence, the confirm-dialog
  guard, `session-expired.interceptor`). The delete-alert spec's first cut had
  a naive-assertion bug — `toBeHidden()` after `reload()` passed before the
  list had loaded — fixed by adding an anchor alert that must re-render first.
  Full suite (12 incl. setup) runs clean three times in a row (data isolation
  via unique thresholds + an API-sweep `afterEach`). Committed on branch
  `test/e2e-playwright-smoke` / PR #119. No CI wiring yet.

If phases must be sequenced under time pressure, Phase 1 is the top priority — it covers both the user's top-stated concern (risk #2) and the one confirmed real code gap.

## 4. Stack

The classic test base for this project. No AI-native layer — all
high-risk logic is deterministic; classic unit + integration gives full
signal at a fraction of the cost.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration (Worker) | Vitest + `@cloudflare/vitest-pool-workers` | latest | Workers runtime emulation; D1 binding available in test context; hardened by Stryker mutation testing (`npx stryker run`, scope `src/worker/**/*.ts` per `stryker.config.json`) — most recently PR #91 (2026-08-24/25) closed survivor gaps across all `src/worker/**` modules |
| HTTP edge mocking (Stooq / Resend) | Vitest built-in mocks or MSW | latest | Mock only at the HTTP edge; never mock internal Worker modules |
| Angular component tests | Vitest (not Karma — see §3 Phase 3 scope notes) | latest | `tsconfig.spec.json` already declares `vitest/globals`; no separate Angular-specific test runner (Karma) was introduced. Two component test files shipped in §3 Phase 3 (`alert-form.spec.ts`, `register.spec.ts`); admin panel components remain uncovered — see §3 Phase 5 (risk #8) |
| e2e | Playwright (local dev server, `development-pl` build) | latest | Two browser-level smoke scenarios only — auth-gate redirect and alert create→reload round trip (§3 Phase 6). Runs against `npm start` (or a `webServer` block), never the deployed Cloudflare shape (§7). `storageState` auth via a `setup` project. Seed exemplar + rules: `e2e/seed.spec.ts` and the `/10x-e2e` skill |

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

For components with no `FormGroup` at all — signal-based state via
`signal`/`computed`, e.g. all 6 admin panel components — drive
Material-overlay widgets (`mat-select`, `MatDatepicker`) by casting the
component instance to call its `protected` setter methods directly
(`(fixture.componentInstance as unknown as { onTypeChange: (t: string) =>
void }).onTypeChange('foo')`), followed by `fixture.detectChanges()`: a
signal write from outside a real DOM event or an already-tracked context
doesn't get picked up automatically. For plain native inputs, checkboxes,
and buttons, prefer real `fireEvent.input`/`fireEvent.blur`/`fireEvent.click`
over casting — it exercises the template's own event bindings, not just the
underlying signal.

Two distinct `MatDialog` DI shapes coexist: a component that *opens* a
dialog injects `MatDialog` (often non-optional) and calls
`.open(...).afterClosed()`; the dialog's own content component typically
never injects `MatDialogRef` directly at all — confirm/cancel is delegated
to the `mat-dialog-close` template directive, which injects `MatDialogRef`
internally regardless, so its test still needs a `{ provide: MatDialogRef,
useValue: { close: vi.fn() } }` stub even though the component class never
references it. A bare `mat-dialog-close` (no value binding, e.g. a Cancel
button) closes with `''`, not `undefined` — assert `close` was called with
`''`, or the assertion silently fails to catch a broken cancel wiring.

To drive both the confirm and cancel branches of an opener's dialog flow,
stub `MatDialog.open()` to return `{ afterClosed: () => subject.asObservable()
}` backed by a fresh `Subject<boolean | undefined>` per test —
`subject.next(true)` exercises confirm, `subject.next(undefined)` exercises
cancel. **Gotcha**: `MatDialogModule` redundantly re-provides the real
`MatDialog` at module level (its own `providers: [MatDialog]`, despite
`MatDialog` already being `providedIn: 'root'`) — if the component under
test imports `MatDialogModule` itself, that module-level provider sits in a
closer injector than a TestBed-root-level override and silently wins, so a
`providers`-based `MatDialog` stub never actually gets used. Fix it with
`render()`'s `importOverrides: [{ replace: MatDialogModule, with: [] }]`
instead.

See `src/app/features/admin/admin-panel.spec.ts` (signal-driven cascades,
`MatDatepicker` casting, error-code map) and
`src/app/features/admin/remove-instrument/remove-instrument.spec.ts` +
`remove-instrument-confirm/remove-instrument-confirm.spec.ts` (the
`MatDialog`/`MatDialogRef` patterns above) for full examples.

### 6.6 Adding a browser-level E2E test

Playwright specs live in `e2e/<feature>.spec.ts`, one scenario per file.
`e2e/seed.spec.ts` is the exemplar every generated test is modeled on —
read it first. Non-negotiables (also loaded into the `/10x-e2e` skill as
its rules file):

- Locators: `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors,
  XPath, or DOM structure.
- Never `page.waitForTimeout()`. Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- Each test is independently runnable — its own setup, action, assertion,
  cleanup. Unique ids (timestamp suffix) in test data so parallel runs and
  re-runs don't collide (the `alerts` table has a
  `UNIQUE (user_id, ticker, alert_type, threshold)` constraint).
- Auth via `storageState` (a `setup` project logs in once) — never log in
  through the UI inside a scenario. The one exception is the auth-gate
  scenario itself, which asserts on the logged-out redirect.
- Name the test after the risk facet it protects, not `test('test 1')`.
- The dev server runs the `development-pl` build, so accessible names in
  locators are the Polish UI strings (`Nowy alert`, `Próg`, `Utwórz alert`,
  …) — source-locale English text won't match.
- Internal boundaries (auth, routing, D1) stay real. Only the daily-cron
  external calls (Yahoo, Resend) would ever be network-mocked, and neither
  smoke scenario touches them.

Generation workflow: `/10x-e2e` (PLAN → GENERATE from seed + rules → REVIEW
against the five anti-patterns → VERIFY by deliberately breaking the
protected behavior and confirming the test goes red). Don't hand-write
scenarios from scratch.

Playwright config (`playwright.config.ts` with `baseURL`, a `webServer`
block, and the `setup`/`storageState` projects) and the
`playwright/.auth/` gitignore entry are set up once as part of Phase 6.

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
  becomes a documented risk. Local browser-level E2E via Playwright against
  the dev server is now in scope for the two smoke scenarios in §3 Phase 6;
  this exclusion remains specifically about the deployed Cloudflare shape.
- **D1 migration SQL correctness** — migrations are forward-only SQL with
  manual verification steps baked into each slice plan (local + remote
  `PRAGMA table_info` checks). Automated migration tests add complexity
  without proportional signal at this scale.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-25
- Stack versions last verified: 2026-08-22
- AI-native tool references last verified: n/a (no AI-native layer)
- 2026-08-25 — PR #91 mutation-testing triage (commits `8a2884f^`..`07bef80`, 6 commits): test-only sweep closing Stryker survivor gaps across `src/worker/**` (session/auth, scheduled/admin routes, index/email, market-data/password, alert-evaluation, alerts/trigger-events/admin/resend/rsi). ~823 lines added across 14 `test/worker/*.test.ts` files. No production code changed, no risk-map delta from this sweep itself (Risk #8 is a separate, interview-sourced addition — see §2).
- 2026-08-28 — added the browser-level E2E layer (§3 Phase 6, §4 stack row, §6.6): Playwright `e2e/seed.spec.ts` exemplar plus four smoke specs — alert create→reload, auth-gate redirect, admin-gate redirect, alert delete confirm/cancel. 10xDevs M3L4 practical exercise. No risk-map delta — all cover browser-only facets of existing risks #4 and #6. Every spec anti-pattern-reviewed and deliberate-break-verified; `auth-gate-redirect`, `admin-gate-redirect`, `delete-alert` generated via standalone `/10x-e2e` runs. Branch `test/e2e-playwright-smoke` / PR #119.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
