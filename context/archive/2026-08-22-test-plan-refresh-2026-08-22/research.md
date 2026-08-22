---
date: 2026-08-22T19:49:37+02:00
researcher: Claude Code
git_commit: 35bfec9986f078e990fee9b42a09d1e667fa3aaf
branch: main
repository: mswiac/market-pulse
topic: "Ground the refreshed test-plan.md risk map (7 risks) against current codebase state"
tags: [research, codebase, test-plan, rsi, alert-evaluation, resend, market-data, admin, isolation, angular, ci]
status: complete
last_updated: 2026-08-22
last_updated_by: Claude Code
last_updated_note: "Corrected the CI gate-wiring finding after user pointed out Cloudflare Workers Builds enforces npm run ci as a required branch-protection status check on main"
---

# Research: Ground the refreshed test-plan.md risk map against current codebase state

**Date**: 2026-08-22T19:49:37+02:00
**Researcher**: Claude Code
**Git Commit**: [35bfec9](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf)
**Branch**: main
**Repository**: mswiac/market-pulse

## Research Question

All 18 roadmap slices are `done`. `context/foundation/test-plan.md` was written 2026-06-28, before implementation, and is now stale: §3 references a change folder that never existed, the hot-spot scan had insufficient signal, and the 6-risk map covered pre-implementation hypotheticals. `context/changes/test-plan-refresh-2026-08-22/change.md` proposes a refreshed 7-risk map with Risk Response Guidance per risk. This research grounds each risk's "what /10x-research must ground" column in current code (file:line evidence), verifies existing test coverage against what each risk actually needs proven, and verifies the hot-spot/CI-wiring claims in the change notes.

## Summary

Verified hot-spot numbers are directionally correct but one figure in the change notes is off: `src/app/features` shows **14 commits / 83 file touches** in the last 30 days (not "17 commits" as stated in the notes prose — 83 touches is correct). `src/worker/lib` shows 14 touches/30d, confirming risk #1's backend-churn claim. The stale `testing-bootstrap-pipeline-units` reference is confirmed gone from disk; `test/worker/` holds exactly 12 files / 2918 lines as claimed.

Per-risk grounding, in order of what most changes the refreshed plan's response guidance:

- **Risk #2 (silent notification failure)** has a **real, currently-untested gap**: `resend.ts` wraps only the *response* path in error handling — a thrown `fetch()` (network failure, DNS, timeout) is never caught inside `resend.ts` itself and propagates to a generic per-alert catch that writes nothing to `trigger_events` and only `console.error`s. No test simulates a throwing fetch, and no test asserts Resend was called with correct `to`/`subject`/`text` args — every existing assertion only checks DB state (`email_status`), which the HTTP-stub always sets to `'sent'` regardless of what was actually sent.
- **Risk #1 (S-08 regression)** is well-covered where an external oracle exists (`rsi.ts` — hand-computed via Python, not tautological) but the S-08-introduced high/low evaluation logic (`resolveFiringValue`, `conditionMet` in `alert-evaluation.ts`) has no independent oracle — that's expected/acceptable for state-machine tests, but coverage gaps exist: `avgGain === 0` RSI branch, `buildEmail`'s high/low line-omission logic, and the asymmetric-null (`high` present, `low` null) case in alert evaluation are all untested.
- **Risk #3 (multi-provider fetch integrity)** is **not corrupted today** — ticker/suffix are kept as separate variables at every call site, DB writes always key on bare `ticker`, verified by explicit negative-assertion tests. "Self-correcting currency" is real (Yahoo overwrites stored currency on mismatch) and tested. The gap is narrower than feared: no test exercises a bare (non-suffixed) ticker side-by-side with a suffixed one in the same assertion.
- **Risk #4 (frontend coverage)** — validation logic is **better than the roadmap assumed** for Alert Form (custom validators, min/max, cross-field dynamic swap) and Register (minLength), only Login and Add Instrument are `required`-only. But there's a **tooling contradiction**: the project's own root `CLAUDE.md` says `npm test` runs Karma, while the actual repo has zero Karma/Jasmine packages, no `test` architect target in `angular.json`, and `tsconfig.spec.json` already declares `vitest/globals`. "First Angular component tests" cannot simply follow the documented Karma path — this needs a decision (Vitest + Angular vs. bootstrap Karma) before Phase 3 of the rollout can start.
- **Risk #5 (cascading deletes)** — the block/cascade split is intentional and documented per-resource (instrument = manual app-level cascade, no FK exists; user = DB-level `ON DELETE CASCADE`), matches the SQL, and is tested against orphan rows including the `SET NULL` case. The gap is exactly what the change notes predicted: **no test or manual check has ever run against remote D1** — the user-removal plan explicitly states remote behavior is *assumed* identical, not verified, and `PRAGMA foreign_keys` is never explicitly set anywhere (relies entirely on D1's undocumented-in-repo default).
- **Risk #6 (cross-user isolation/IDOR)** is the **strongest-covered risk already** — `user_id` scoping is baked into every SQL statement (no fetch-then-check window), admin gate is a single non-bypassable middleware, and `alerts.test.ts` has three explicit two-user isolation tests plus `admin.test.ts` has 401/403 tests on every admin route. The only real gaps are narrow: no test with an *admin* session hitting a *non-admin* route with someone else's resource ID, and no two-admin scenario.
- **Risk #7 (backfill abuse)** — a single hard cap (`MAX_RANGE_DAYS = 730`) exists and is tested at the boundary, but it was sized by *reasoning*, not benchmarked, and there is no rate limiting at all (explicitly declared out-of-scope in the original plan for "a single-admin, low-frequency internal tool"). No test exercises a near-730-day range to observe actual CPU/latency.

**Correction (post-draft, per user):** the initial pass concluded CI gate wiring was fully unenforced. That was wrong — it only checked for GitHub Actions/husky/git hooks and missed Cloudflare Workers Builds, which is a separate GitHub-App-based check. Confirmed via `gh api repos/mswiac/market-pulse/branches/main/protection`: branch protection on `main` requires the status check **"Workers Builds: marketpulse"** (app_id 85455). Per the user, that build's configured **build command is `npm run ci`** (deploy command `npx wrangler deploy`, version command `npx wrangler version upload`) — so `typecheck && test:worker && build` already runs and is already required to pass before any merge to `main`. **§5's "lint + typecheck" and "unit + integration (Worker)" gates are therefore already enforced in CI, not just planned.** The only genuinely-still-open gate is the local "post-edit hook... recommended after Phase 1" (no `.claude/settings.json` PostToolUse/Stop hook exists) — that one remains an accurate gap. The rollout phase 4 idea of "wire `npm run ci` as an actually-enforced gate" (from `change.md`'s original notes) is **already done** and should be dropped from the phase 4 scope; only the local post-edit hook and the abuse-lens risks (#6, #7) remain real work for that phase.

## Detailed Findings

### Risk #1 — S-08 regression in src/worker/lib (rsi.ts, alert-evaluation.ts, market-data.ts)

S-08 (`context/archive/2026-08-02-daily-high-low-evaluation/plan.md`) added `high`/`low` to the Yahoo parse (`market-data.ts:15-21,105-115`) and a new `resolveFiringValue(alertType, direction, snapshot)` in `alert-evaluation.ts:76-97` — RSI alerts still fire on `snapshot.rsi`; PRICE alerts fire on `high` (up) or `low` (down), falling back to `price` (close) when the directional field is null (`alert-evaluation.ts:94-96`). Firing uses this resolved value (`alert-evaluation.ts:127-128`); re-arming (`hasRetreatedPastMargin`, `:155`) deliberately still uses close only — high/low retreating does not re-arm. `trigger_events` gained `high_at_trigger`/`low_at_trigger` for PRICE alerts (`:146-147`). `routes/alerts.ts`'s `computeArmed` reuses the same `resolveFiringValue` so alert-creation armed-state can't drift from cron evaluation. RSI calculation itself (`rsi.ts`) was explicitly out of scope for S-08.

Oracle discipline differs sharply between the two files:
- `rsi.test.ts:4-6,13-14,17-18` uses values "computed independently in Python... not derived from this implementation's own output" — e.g. `expect(calculateRSI(CLOSES_15)).toBeCloseTo(70.46413502109705, 9)`. This is exactly the non-tautological pattern the original test-plan's Risk Response Guidance (#4 in the old map) called for.
- `alert-evaluation.test.ts` has no external oracle — all assertions check the function's own derived state (`armed` flips, `trigger_events` fields that echo seeded input). This is acceptable for decision/state-machine tests but means there's no independent check that `resolveFiringValue`/`conditionMet` math is correct beyond self-consistency.

Coverage gaps found:
- `rsi.ts`: no test for the `avgGain === 0` branch (strictly decreasing closes → RSI should be 0); only the symmetric `avgLoss === 0` case is tested (`rsi.test.ts:25-28`). No test for empty/very-short input series.
- `alert-evaluation.ts`: `buildEmail`'s (`:34-66`) actual subject/text content — specifically the High/Low line-omission-when-null logic (`:48-55`) — is never asserted by any test; no `resend.test.ts` exists. `conditionMet`, `hasRetreatedPastMargin`, `resolveFiringValue` are never directly unit-tested by name, only indirectly via `evaluateAlerts` integration tests. The "asymmetric null" case (`high` present, `low` null) that `market-data.ts` parsing explicitly handles is not mirrored in `alert-evaluation.ts` tests — only "both null" is covered (`alert-evaluation.test.ts:343-356`).
- `market-data.ts` high/low IS directly covered (not just indirectly): `market-data.test.ts:49-59` (parse), `:61-71` (asymmetric-null-kept-not-dropped), `:170-182` (`upsertPriceHistory` bound args including null). No test covers close-present + exactly-one-of-high/low-null.

### Risk #2 — Silent notification failure (Resend)

Resend is called via raw `fetch` (no SDK), `resend.ts:23-30`, invoked from `alert-evaluation.ts:131`. Two failure modes, very different visibility:
- **Non-ok HTTP response**: caught inline in `resend.ts:32-42`, returned as `{ ok: false, error }`; recorded as `trigger_events.email_status = 'failed'` (`alert-evaluation.ts:149-150`) — visible via the trigger-history UI.
- **`fetch()` throwing** (network/DNS/timeout): **no try/catch anywhere in `resend.ts`** around the `fetch` call itself. The exception propagates to the generic per-alert `try/catch` in `alert-evaluation.ts:116/159-161`, which only `console.error`s. In this path: **no `trigger_events` row is written at all**, the alert stays `armed = 1`, and the only trace is a Workers log line. This is exactly the top-stated concern ("cron completes without error but Resend doesn't send") and it is currently reachable and unguarded.

Dedup is **not date-based** — there's no `UNIQUE` constraint on `trigger_events` (`migrations/0011_alert_notifications.sql:72-85`, `0012` only adds a non-unique composite index). Dedup is entirely the `armed` flag on `alerts` (state machine, not a per-day guard): fires only when `armed === 1`, insert + `armed = 0` happen atomically in one `env.DB.batch()` (`alert-evaluation.ts:133-153`), re-arms only on retreat-past-margin. S-08 did **not** add a second evaluation pass — still exactly one evaluation per alert per cron run.

No dedicated `resend.test.ts` exists. All existing assertions check `trigger_events.email_status`/DB state, never the actual `fetch` call's `to`/`subject`/`text` args — e.g. `alert-evaluation.test.ts:130` only checks `email_status: 'sent'`, which the test's own unconditional 200-stub (`jsonResponse(200, {...})`, line 101) would set regardless of what was sent. No test simulates a throwing `fetch`, and no test asserts `fetchSpy` call-count stays 1 across a "cron ran twice" scenario.

### Risk #3 — Multi-provider fetch integrity (Yahoo + .WA suffix, currency)

Suffix and bare ticker are **never merged into one variable that reaches the DB** — kept separate at all 3 call sites (`scheduled.ts:50`, `admin.ts:74`, both with inline comments stating DB writes stay keyed on bare ticker; `market-data.ts:45-49`'s `fetchDailyCloses` takes an opaque symbol and has no split logic — concatenation/splitting is entirely the caller's job). `upsertPriceHistory` (`market-data.ts:149-158`) and both call sites (`scheduled.ts:61,64-67`, `admin.ts:82`) bind the bare `ticker` param. Schema's key column was renamed from `instrument` to `ticker` in `migrations/0008_instrument_registry.sql:13`. Tests assert the negative case explicitly — `scheduled.test.ts:239` and `admin.test.ts:302` both check no row exists under the suffixed symbol.

"Self-correcting currency" reconciled: migration-time hand-seeding (`migrations/0010_instrument_currency.sql`, matches the existing project memory) coexists with a runtime correction (`buildCurrencyCorrection`, `market-data.ts:135-143`) that compares stored currency against Yahoo's `meta.currency` and emits an `UPDATE` if they differ and Yahoo's value is a well-formed 3-letter code. Tested (`scheduled.test.ts:243-260`, `admin.test.ts:306-322`).

Coverage gap: no test with a bare (unsuffixed) and suffixed ticker asserted side-by-side in one test; Yahoo response mocking is generic (one shared `yahooBody()` helper), not varied per instrument type as the change notes' risk guidance requested — the suffix distinction is only verified via the requested fetch URL, not response-shape variation.

### Risk #4 — Zero automated frontend coverage

`src/app/features/` holds: `admin/` (panel + add-instrument + remove-instrument(-confirm) + remove-user(-confirm)), `alerts/` (alert-form, alert-list, delete-alert-confirm), `auth/` (login, register), plus `home/`, `instrument-history/`, `instruments/` (service-only), `trigger-history/`.

Validation is better than the roadmap's "non-empty-only" assumption in most forms:
- **Add Instrument** (`add-instrument.ts:61`): not reactive forms — plain signals, non-empty checks only (`canSubmit` computed). Matches the roadmap's assumption.
- **Alert Form** (`alert-form.ts`): custom `positiveNumberValidator()` (`:18-20`), `Validators.min(0)`/`max(100)` for RSI (`:23`), `Validators.email` (`:72`), and dynamic cross-field validation — `alertType.valueChanges` swaps the `threshold` control's validator set at runtime (`:101-111`). Well beyond required-only.
- **Login** (`login.ts:22-24`): required + email — matches the assumption.
- **Register** (`register.ts:23-24`): required + email + `minLength(8)` on password, plus a server-conflict surfaced via `setErrors({ server: true })` (`:49`).

Zero `.spec.ts` files exist anywhere under `src/` (confirmed by repo-wide search) — matches `skipTests: true`.

**Tooling contradiction found**: root `CLAUDE.md`'s Commands section documents `npm test` as "Karma unit tests," but no Karma/Jasmine package appears anywhere in `package.json`, `angular.json`'s `architect` block has no `test` target at all, and `tsconfig.spec.json:8` already declares `"types": ["vitest/globals"]`. Running `ng test` today would fail outright — there is no configured test builder. This means Phase 3 (frontend test bootstrap) needs an explicit decision — bootstrap Karma to match the stale doc, or wire Vitest for Angular components (which the tsconfig already half-anticipates) — before any component test can be written; the test-plan's stack section (§4) should not simply say "Karma" without resolving this first.

### Risk #5 — Cascading/orphaned deletes (S-11 instrument removal, S-12 user removal)

Decision is genuinely per-resource, both documented and matching code:
- **Instrument removal (S-11)**: manual application-level cascade — `instruments.ticker` carries no FK from any table. `admin.ts:227-233` runs an explicit 5-statement batch (count + delete from `alerts`, `price_history`, `market_data`, `instruments`); `trigger_events` deliberately left alone (already tolerant of a missing instrument via LEFT JOIN/COALESCE).
- **User removal (S-12)**: DB-level FK cascade — `sessions`, `alerts`, `trigger_events` all declare `REFERENCES users(id) ON DELETE CASCADE` (`migrations/0004`, `0008:32`, `0011:13`); `trigger_events.alert_id` uses `ON DELETE SET NULL` (`migrations/0011:75`) so history rows survive an alert's parent chain being deleted. `admin.ts:315-319` relies on this — a single `DELETE FROM users` with no manual child deletes.

`PRAGMA foreign_keys` is **never explicitly set anywhere** in the codebase (migrations, wrangler.toml, or Worker code) — entirely relies on D1's default-on behavior. Tests (`admin.test.ts:592-643` instrument, `:826-860` user) both assert orphan-row absence and the `SET NULL` firing, but run exclusively against Miniflare-simulated local D1. **No test or manual verification has ever run against remote/deployed D1** — the S-12 plan states outright that remote behavior "is assumed to behave identically... rather than separately verified" (`context/archive/2026-08-14-admin-remove-user/plan.md:47`). This is exactly the gap the change notes flagged.

### Risk #7 (grouped with #5's agent) — Resource abuse via wide-range backfill

`POST /api/admin/market-data` (`admin.ts:37-100`) accepts free-form `from`/`to` dates, validated only for format/ordering/not-future. A single hard cap, `MAX_RANGE_DAYS = 730` (`admin.ts:8,55-57`), exists and is boundary-tested (`admin.test.ts:210-218`, asserts `400 range_too_large` above 730 days). No rate limiting exists anywhere in `src/worker` — the original S-09/admin-panel plan explicitly scoped it out ("single-admin, low-frequency internal tool," `context/archive/2026-08-02-admin-panel/plan.md:31`). The 730-day figure was sized by reasoning (~500 trading days ≈ one Yahoo fetch + one ~500-statement D1 batch, "within D1 limits" per the plan) but **never benchmarked** — no test exercises a near-730-day range to observe actual CPU time or D1 batch latency; all success-path tests use short ranges with Yahoo mocked/stubbed.

### Risk #6 — Cross-user isolation / IDOR

This is the strongest-covered risk in the refreshed map.

Admin gate: single non-bypassable choke point — `adminRoutes.use('*', sessionMiddleware, adminMiddleware)` (`admin.ts:17`); `adminMiddleware` (`lib/admin.ts:14-23`) re-derives admin status from D1 by session `userId`, never trusts client input. All 7 admin routes sit under this wildcard; no handler does an independent check, so there's no route where the gate could be inconsistently applied. One extra self-delete guard exists only on `DELETE /users/:id` (`admin.ts:302-304`).

Alert CRUD `user_id` scoping is baked into every SQL statement, not checked after fetch — `GET /` (`alerts.ts:225`), `POST /` (`:204-211`), `PUT /:id` (`:267-272`, non-matching id/user_id collapses "not found" and "belongs to someone else" into the same 404), `DELETE /:id` (`:296-301`). Same pattern in `trigger-events.ts:47-59`. No fetch-then-check window exists anywhere.

Test coverage: `alerts.test.ts` has three explicit two-user isolation tests (line 325 list-isolation, 450 update-404, 486 delete-404-with-survival-check). `admin.test.ts` has 401 + 403-non-admin tests on every one of the 7 admin routes. `auth.test.ts` has zero cross-user/cross-role tests (single-user flows only — acceptable, since isolation is alert/admin concerns, not auth's). Gaps: no test with an admin session hitting a non-admin route (`/api/alerts`) using someone else's resource ID (verifying elevated privilege doesn't accidentally bypass `user_id` scoping), and no genuine two-admin scenario.

### CI / Quality gate wiring

`package.json` scripts: `typecheck` (dual `tsc --noEmit`), `test:worker` (`vitest run`), `build` (`ng build`), `ci` (composes all three in order).

**Corrected finding.** This research's first pass checked only for GitHub Actions, husky/git hooks, and lint-staged — all confirmed absent (`.github/workflows` doesn't exist, no `.husky/`, only `.sample` files under `.git/hooks/`, no lint-staged config) — and concluded from that the `ci` script was never invoked automatically. That conclusion was **wrong**: it missed Cloudflare Workers Builds, a GitHub-App-based required status check that doesn't show up as a workflow file in the repo. Verified via `gh api repos/mswiac/market-pulse/branches/main/protection`:

```json
"required_status_checks": {
  "contexts": ["Workers Builds: marketpulse"],
  "checks": [{"context": "Workers Builds: marketpulse", "app_id": 85455}]
}
```

Per the user, the Cloudflare Workers Build's configured **build command is `npm run ci`** (deploy command `npx wrangler deploy`, version command `npx wrangler version upload`), and this status check is required before any PR can merge to `main`. So `typecheck && test:worker && build` **is already an enforced, blocking gate** — it just runs as a Cloudflare-hosted check invisible to a repo-file-only search, not as GitHub Actions/husky. The `deploy` script itself (`ng build && wrangler deploy`) still doesn't call `ci` independently, but that's moot — nothing reaches `wrangler deploy` on `main` without the Workers Build (running `ci`) having already passed as a merge gate.

The only genuinely-still-open item is local, not CI: `.claude/settings.json` defines only a `PreToolUse` secrets-guard hook (`block-dev-vars.mjs`), unrelated to testing — no `PostToolUse`/`Stop` hook exists, so the test-plan's own §5 "post-edit hook — recommended after Phase 1" (fast local feedback before a commit even reaches the Workers Build) remains unimplemented and is the one accurate gap in this area.

**Implication for the refreshed plan**: §5's "lint + typecheck" and "unit + integration (Worker)" rows should move from "required after §3 Phase N" to simply "required — enforced via Cloudflare Workers Builds status check on `main`," and rollout phase 4's "wire `npm run ci` as an actually-enforced gate" (from `change.md`'s original notes) should be dropped — it's already true. Phase 4 should keep only: risks #6/#7 test coverage, and (optionally) the still-open local post-edit hook.

### Hot-spot verification

- Commits touching `src/app/features` in the last 30 days: **14** (not 17, as the change notes' prose states) — file touches: **83**, which matches the notes exactly and is the highest single-area file-touch count in the repo.
- `src/worker/lib` touches in the last 30 days: **14**, matching the notes' backend-churn claim. Breakdown: `market-data.ts` (5), `instruments.ts` (3), `rsi.ts` (2), `alert-evaluation.ts` (2), `resend.ts` (1), `admin.ts` (1).
- `context/changes/testing-bootstrap-pipeline-units` does not exist anywhere on disk (`context/changes/` or `context/archive/`) — confirmed via search. `context/changes/` currently holds only `bootstrap-verification`, `deployment`, and this new change folder — all prior work has been archived (21 folders under `context/archive/`).
- `test/worker/` holds exactly 12 files totalling 2918 lines, matching the change notes exactly: `admin.test.ts`, `alert-evaluation.test.ts`, `alerts.test.ts`, `auth.test.ts`, `instruments.test.ts`, `market-data.test.ts`, `password.test.ts`, `rsi-eligibility-triggers.test.ts`, `rsi.test.ts`, `scheduled.test.ts`, `smoke.test.ts`, `trigger-events.test.ts`.

## Code References

- `src/worker/lib/resend.ts:23-42` — Resend `fetch` call; error handling covers only non-ok HTTP responses, not a throwing `fetch`
- `src/worker/lib/alert-evaluation.ts:76-97` — `resolveFiringValue`, the S-08-introduced high/low firing-value resolution
- `src/worker/lib/alert-evaluation.ts:116,159-161` — generic per-alert catch that swallows a thrown Resend `fetch` with only a `console.error`
- `src/worker/lib/alert-evaluation.ts:133-153` — atomic `trigger_events` insert + `armed = 0` batch (dedup mechanism)
- `src/worker/lib/alert-evaluation.ts:34-66` — `buildEmail`, untested content/formatting logic
- `src/worker/lib/rsi.ts` — RSI calculation; `test/worker/rsi.test.ts:4-18` uses externally-sourced (Python) expected values
- `src/worker/lib/market-data.ts:106-114` — asymmetric-null high/low parsing (S-08)
- `src/worker/lib/market-data.ts:135-143` — `buildCurrencyCorrection`, the "self-correcting currency" logic
- `src/worker/lib/market-data.ts:149-158` — `upsertPriceHistory`, always keyed on bare `ticker`
- `src/worker/scheduled.ts:48-50` — ticker+suffix kept separate for the Yahoo call, bare ticker used for DB writes
- `src/worker/routes/admin.ts:8,37-100` — backfill endpoint, `MAX_RANGE_DAYS = 730` cap, no rate limiting
- `src/worker/routes/admin.ts:17,211-233` — admin middleware chain; instrument-delete manual cascade batch
- `src/worker/routes/admin.ts:291-319` — user-delete relying on DB-level FK cascade; self-delete guard
- `src/worker/lib/admin.ts:14-23` — `adminMiddleware`, re-derives admin status from D1 per request
- `src/worker/routes/alerts.ts:204-301` — `user_id` scoping baked into every CRUD SQL statement
- `migrations/0011_alert_notifications.sql:72-85` — `trigger_events` schema, no unique/date-based dedup constraint
- `migrations/0011_alert_notifications.sql:13,75` — `ON DELETE CASCADE` (alerts→users) and `ON DELETE SET NULL` (trigger_events→alerts)
- `src/app/features/alerts/alert-form/alert-form.ts:18-23,72,101-111` — custom + cross-field Angular validators
- `tsconfig.spec.json:8` — declares `vitest/globals`, contradicting the documented Karma test runner
- `package.json:4-18` — `ci` composite script; enforced as the Cloudflare Workers Build command, required via GitHub branch protection on `main` ("Workers Builds: marketpulse", app_id 85455)
- `test/worker/alert-evaluation.test.ts:130,229-249` — existing assertions check DB state, not Resend call args
- `test/worker/admin.test.ts:210-218,592-643,826-860` — backfill boundary test; cascade-delete orphan assertions
- `test/worker/alerts.test.ts:325,450,486` — two-user isolation tests

## Architecture Insights

- **The project consistently separates "external identifier" from "internal key"** — the ticker+suffix split (risk #3) mirrors the same discipline seen in `user_id`-scoped queries (risk #6): the code never lets a client- or provider-shaped value leak into a storage key without going through a controlled boundary.
- **Cascade behavior is decided per-resource based on whether an FK relationship is natural, not applied uniformly** — instruments have no natural FK owner (ticker is referenced by string across independent tables), users do (everything genuinely belongs to a user row). This is a deliberate, documented asymmetry, not an inconsistency.
- **Error handling is asymmetric between "the remote service responded with an error" and "the remote service call itself failed"** — this pattern repeats in `resend.ts` (HTTP error caught, network error not) and is worth checking for in any other outbound-fetch code (Yahoo fetch in `market-data.ts` was not part of this research's scope but the same pattern should be checked before assuming it's uniquely a Resend issue).
- **Everything in this codebase is validated at the SQL-statement level, not the fetch-then-check level**, for authorization — this is a strong, consistent pattern across alerts, trigger-events, and admin routes and is a major reason risk #6 is already well-defended.
- **Local-only D1 verification is a recurring, explicitly-acknowledged gap**, not an oversight — both the S-12 plan and this research confirm remote D1 has never been separately checked; the team already knows this and chose to accept the risk at implementation time. The refreshed test-plan should decide whether to close this gap now or continue deferring it.
- **The project's real CI gate lives outside the repo's files entirely** — Cloudflare Workers Builds, configured in the Cloudflare dashboard and enforced via a GitHub branch-protection required status check, not a `.github/workflows/*.yml` file. Any future research or health-check pass that greps only for GitHub Actions/husky/git-hooks to answer "is CI enforced?" will reach the same wrong conclusion this research initially did — branch protection (`gh api repos/<owner>/<repo>/branches/main/protection`) needs to be checked directly, and for third-party dashboard-configured checks (Cloudflare Workers Builds, Vercel, etc.) the actual build command isn't discoverable from the repo at all and must be confirmed with the user.

## Historical Context (from prior changes)

- [`context/archive/2026-08-02-daily-high-low-evaluation/plan.md`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-08-02-daily-high-low-evaluation/plan.md) — S-08's design: `resolveFiringValue`, deliberate close-only re-arming, RSI explicitly out of scope.
- [`context/archive/2026-08-14-admin-remove-instrument/plan.md`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-08-14-admin-remove-instrument/plan.md) — resolves the "block vs cascade" unknown the roadmap left open for S-11: manual cascade, chosen because no FK exists on `instruments.ticker`.
- [`context/archive/2026-08-14-admin-remove-user/plan.md`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-08-14-admin-remove-user/plan.md) — documents the empirical local-D1 FK-cascade check and explicitly states remote D1 is assumed, not verified.
- [`context/archive/2026-08-02-admin-panel/plan.md`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-08-02-admin-panel/plan.md) — origin of `MAX_RANGE_DAYS = 730` and the explicit scope decision to skip rate limiting.
- [`context/archive/2026-07-31-alert-notifications/`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-07-31-alert-notifications/) — origin of the Resend integration and `trigger_events` schema (S-05).
- [`context/archive/2026-08-09-stooq-provider-support/`](https://github.com/mswiac/market-pulse/blob/35bfec9986f078e990fee9b42a09d1e667fa3aaf/context/archive/2026-08-09-stooq-provider-support/) — relevant to F-04's provider-switch history (project memory: Stooq has no VIX data, project switched to Yahoo for both indices).

## Related Research

None — this is the first `/10x-research` document produced for this project's test-plan refresh cycle. The original `context/foundation/test-plan.md` was authored directly during Phase 1 planning (2026-06-28) without a preceding research pass, per the file's own header.

## Open Questions

1. **Karma vs. Vitest for Angular** — root `CLAUDE.md` documents `npm test` as Karma, but no Karma packages exist and `tsconfig.spec.json` already anticipates Vitest globals. This needs a decision before Phase 3 (frontend test bootstrap) can proceed; recommend surfacing this contradiction to the user before `/10x-plan` writes a stack section for that phase.
2. **Remote D1 verification method** — is a one-time manual `wrangler d1 execute --remote` check (per the existing project convention of asking before touching remote/local dev data) sufficient to close risk #5's remote-D1 gap, or does the user want an automated remote-D1 integration step in CI? Not resolved by this research; a decision for `/10x-plan`.
3. **Resend fetch hardening** — risk #2's gap (uncaught `fetch` throw) is a real code gap, not just a test gap. Should the refreshed test-plan scope include *fixing* `resend.ts` to catch and record network-level failures (so a test can then assert on it), or purely add a test proving the current silent-failure behavior, matching the plan's principle that /10x-research documents risk, not remediation? This is a scope decision for `/10x-plan`, flagged here because the fix is trivial (a try/catch) but was out of this research's mandate.
4. **Yahoo fetch (not just Resend) — does it have the same uncaught-throw pattern?** Not investigated in this pass; worth a quick check before considering risk #2's finding fully scoped, since the same silent-failure shape could also apply to market-data fetch failures feeding risk #1/#3.
