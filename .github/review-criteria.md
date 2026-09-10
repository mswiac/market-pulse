# Code Review Criteria

Single source of truth for the AI code reviewer. Reused verbatim by:

- the review workflow's agent prompt (the `{{CR_CRITERIA}}` block), and
- the promptfoo model-comparison eval.

Each criterion is scored 1–10 against the anchor states below. The anchors are
deliberately concrete so the verdict is calibrated, not vibes-based. When a diff
gives no signal for a criterion (e.g. no tests were in scope and none were
needed), the reviewer states that explicitly instead of guessing a number.

Criteria are MarketPulse-specific where it matters: they cite conventions that
predate the agent and already live in `CLAUDE.md`, `context/foundation/lessons.md`,
and `context/foundation/stryker-notes.md`.

---

## 1. Implementation correctness

Does the change do what the PR claims — on the happy path, at the edges, and on
the error paths — without silently breaking existing behavior?

- **1:** Core logic is wrong, or the change regresses an existing flow with no
  compensating test. Off-by-one, inverted condition, unhandled rejection, or a
  cron/alert path that no longer fires when it should.
- **10:** Correct on the happy path; edge cases (empty input, boundary values,
  duplicate/missing rows) are handled; error paths return a sane result rather
  than throwing into the void. Any behavior change is intentional and reflected
  in tests.

## 2. Project idiomaticity

Does the code match the patterns and structure already established in the repo,
rather than introducing a parallel style?

Concrete MarketPulse conventions:

- Angular: standalone components only (no `NgModule`), SCSS, file naming
  `name.ts` / `name.html` / `name.scss` (from `angular.json` schematics).
- Backend: Cloudflare Workers + Hono + D1; follow the existing worker `lib/`
  structure and Hono routing style.
- `CLAUDE.md` hard rules: all committed file content in English (the only
  exception is user-facing UI strings, which may be Polish); never generate spec
  files (`skipTests` is global).

- **1:** Introduces an `NgModule`, a non-standalone component, CSS instead of
  SCSS, off-convention file names, Polish in non-UI code/comments, a new HTTP
  framework or router pattern, or a generated `.spec.ts` file.
- **10:** Indistinguishable in style from the surrounding code; a reader cannot
  tell the diff was written in a separate session.

## 3. Complexity / YAGNI

Is this the simplest solution that fits the actual problem?

- **1:** Speculative abstraction for a second caller that does not exist; a new
  layer, generic, or config surface that the PR's stated goal does not require;
  a rewrite where a local change would do.
- **10:** The change is proportional to the problem. No new indirection unless it
  removes more complexity than it adds. Dead code and unused parameters are
  absent.

## 4. Test & risk coverage

Are tests proportional to the risk of the paths that changed, given the
project's tooling and the `skipTests` default?

Concrete MarketPulse conventions:

- `skipTests` is global — tests are added deliberately, never scaffolded.
- Worker logic is tested with Vitest.
- E2E is Playwright with role/label/text locators only — never CSS selectors,
  XPath, or DOM-structure locators; never `page.waitForTimeout()`.
- Stryker is an extra mutation gate, scoped to the files under change — not a
  coverage substitute and not run repo-wide.

- **1:** A risky changed path (auth, session, alert evaluation, RSI math, a D1
  migration) ships with no test, or a new E2E test uses CSS/XPath locators or a
  fixed timeout.
- **10:** Each meaningfully risky path the diff touches has a test that would
  actually fail if the logic broke; low-risk changes (copy, styling) are not
  padded with ceremony tests. New E2E tests use role/label locators and wait on
  state.

## 5. Change documentation

Is the change explained where it needs to be — and nowhere it does not?

Concrete MarketPulse conventions:

- D1 migrations are **not** auto-applied on deploy — a schema change must carry a
  note that `wrangler d1 migrations apply --remote` is a separate step.
- Non-trivial changes have a `context/changes/<id>/change.md` identity file.
- Comment rule: only comments explaining a non-obvious **why** survive; comments
  that restate **what** the code does are noise.

- **1:** A migration lands with no application note; a comment block narrates
  line-by-line what the code plainly does; a substantial change has no
  `change.md`.
- **10:** Migration/rollout implications are called out; the `change.md` (when
  applicable) matches what shipped; the only comments present explain a decision
  a reader could not infer from the code.

## 6. Security & platform limits

Does the change respect secret hygiene, D1 query safety, auth/session
correctness, and the Workers Free plan CPU budget?

Concrete MarketPulse conventions:

- No secret values in committed files, logs, or test fixtures; secrets come from
  bindings / `.dev.vars` (gitignored).
- D1 access uses parameterized statements — never string-interpolated SQL.
- Auth is email + password with D1-backed httpOnly sliding-expiration sessions;
  each user sees only their own alerts.
- Workers Free plan has a hard CPU ceiling per invocation — `workerd` caps
  PBKDF2 at 100k iterations and the project's effective budget is tighter still
  (~10–15k). CPU-heavy work in a request or cron path is a red flag.

- **1:** Interpolates user input into a D1 query; logs or commits a secret; a
  route lets a user read another user's alerts; adds an unbounded loop or a
  high-iteration KDF to a hot path.
- **10:** Queries are parameterized; secrets stay in bindings; authorization is
  checked against the session user; new work in request/cron paths is within the
  Free plan CPU budget.

---

## Parked dimensions

Not scored — they need broader context than a single diff provides (M5L3
"Co na później"):

- **Business alignment** — whether the feature is the right thing to build for
  MarketPulse users. Requires product context the reviewer does not have.
- **Architectural fit** — whether the change is consistent with the intended
  long-term shape of the system. Requires the roadmap and design history, not
  just the changed lines.
