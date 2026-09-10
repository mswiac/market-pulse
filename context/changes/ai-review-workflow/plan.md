# AI Code Review Workflow Implementation Plan

## Overview

Add `.github/workflows/ai-review.yml`: a GitHub Actions workflow that runs the
official `anthropics/claude-code-action` on every PR to `main`, reviews the diff
against `.github/review-criteria.md`, and posts a single sticky PR comment
containing a schema-validated JSON block (`{ scores, verdict, summary }`) plus a
human-readable score table.

This is issue #135, the core deliverable of the #132 10xChampion badge pipeline.
It consumes the criteria file from #134 and the `CLAUDE_CODE_OAUTH_TOKEN` secret
from #133.

## Current State Analysis

- **Only workflow today**: `.github/workflows/e2e.yml` — establishes repo
  conventions: `pull_request: branches: [main]` + `paths:` filter, a
  `concurrency` group with `cancel-in-progress: true`, `runs-on: ubuntu-latest`,
  explicit `timeout-minutes`, `actions/checkout@v4`, `actions/setup-node@v4` with
  `node-version-file: .nvmrc`, then `npm install -g npm@11.13.0` before `npm ci`,
  `WRANGLER_SEND_METRICS: 'false'`, CI-only dummy `.dev.vars` written inline, and
  a header comment stating the workflow is informational / not a required check.
- **Secret**: `CLAUDE_CODE_OAUTH_TOKEN` exists in the repo (added 2026-09-10,
  issue #133). Consumer-terms decision recorded, training opt-out done.
- **Criteria file**: `.github/review-criteria.md` (merged in PR #141) — 6
  criteria, each with `1:` / `10:` anchors, plus a "Parked dimensions" section.
  Criterion names are the natural keys for the JSON `scores` object.
- **No CI/agent research or prior workflow of this kind** exists in `context/`.
- Full external-integration findings: `context/changes/ai-review-workflow/research.md`.

## Desired End State

`.github/workflows/ai-review.yml` exists and:

1. On `workflow_dispatch`, authenticates with the OAuth token and completes green
   (no PR context required).
2. On a `pull_request` (`opened` / `synchronize`) to `main` from a branch in this
   repo, runs the review and posts/updates one comment on the PR. The comment
   holds a fenced ```json block that parses and validates against the schema, and
   a Markdown table of the 6 criterion scores + verdict + summary.
3. A PR with a planted flaw (hardcoded secret / missing null check) gets that
   flaw called out in the summary and a low score on the relevant criterion.
4. A clean small PR gets a `pass` verdict.
5. No secret value appears in the workflow logs.
6. The workflow never fails the check on a `fail` verdict — the verdict is
   advisory (hard merge gate is #140).

### Key Discoveries:

- Action input for OAuth is `claude_code_oauth_token`; setting a non-empty
  `prompt` puts the action in automation mode (no `@claude` needed)
  (`research.md` → "anthropics/claude-code-action — v1 input surface").
- `--json-schema '<json>'` in `claude_args` makes the action validate Claude's
  result and expose it as `steps.<id>.outputs.structured_output` (a JSON string);
  `examples/test-failure-analysis.yml` shows the downstream
  `jq` + `gh pr comment` pattern (`research.md` → "How the comment gets posted").
- Pin: `anthropics/claude-code-action@19dda84776b3518d98b8798e591daee763049ed3 # v1.0.220`.
- `pull_request` (not `pull_request_target`) does not expose secrets to forked
  PRs — guard the job with a same-repo `if:` so fork PRs skip cleanly instead of
  failing at auth.
- The action self-installs Bun + Claude Code; **no `actions/setup-node` /
  `npm ci` in this job** (the npm@11 acceptance-criterion line is N/A because the
  review is static — read the diff + criteria file, run no project commands).
- All official examples include `id-token: write` even on the static-key path;
  include it.

## What We're NOT Doing

- No composite action extraction (#138).
- No labels (`ai-cr:passed` / `ai-cr:failed`), no on-demand retry-on-label, no
  merge-blocking status check (#140).
- No extra agent tools, no plan-vs-diff review, no `.claude/skills` wiring (#139).
- No promptfoo eval (#136) — but the JSON schema is authored so it can be reused
  there unchanged.
- The reviewer does **not** run `npm run typecheck` / tests / lint — review is
  based on reading the diff and the criteria file only.
- No `paths:` allowlist — we run on every PR to `main` except pure-docs PRs
  (`paths-ignore`).
- Not making this a required branch-protection check (informational, like
  `e2e.yml`).

## Implementation Approach

One workflow file, built in three passes so the OAuth-token risk is isolated
first:

1. **Phase 1** lands the whole job structure with a trivial prompt and proves
   `workflow_dispatch` auth is green.
2. **Phase 2** replaces the trivial prompt with the real review instructions,
   adds `--json-schema`, and adds the bash step that renders + posts the sticky
   comment (PR events only).
3. **Phase 3** validates behavior on two throwaway PRs (planted-flaw + clean).

The `claude-code-action` step keeps a read-only tool surface
(`Bash(gh pr diff:*)`, `Bash(gh pr view:*)`, `Read`, `Grep`, `Glob`); it never
writes to GitHub. The bash post step is the sole comment author, so the JSON
block is schema-valid by construction and the comment format is fully
deterministic.

## Critical Implementation Details

**Two prerequisites / guards discovered during Phase 1 (2026-09-10):**

1. **Claude GitHub App must be installed** on `mswiac/market-pulse`
   (https://github.com/apps/claude). `claude-code-action` exchanges the OIDC
   token for a Claude App installation token *before* checking
   `CLAUDE_CODE_OAUTH_TOKEN`; without the App that exchange 401s. Installed
   2026-09-10. Recorded in `change.md`.
2. **`claude-code-action` skips the agent when the workflow file on the PR branch
   differs from the version on the default branch** (a security guard against
   PRs that edit the review workflow to exfiltrate secrets). It exits
   `conclusion: success` but does no work, logging *"your workflow will begin
   working once you merge your PR."* Consequence: **`ai-review.yml` cannot be
   behaviourally tested from its own PR** — not via `workflow_dispatch` (needs
   the default branch) nor via the `pull_request` trigger (this guard).
   Therefore Phases 1 and 2 are built together in one PR and verified only
   statically + via the infra smoke (OIDC, App-token exchange, secret masking,
   green job) before merge; the real agent smoke (`workflow_dispatch` on `main`)
   and end-to-end behaviour move to Phase 3, post-merge. Phase 3's test PRs work
   because they touch application code, not `ai-review.yml`, so the guard passes.

**Comment must be a single sticky comment.** The post step finds an existing
comment authored by the actions bot whose body contains the hidden marker
`<!-- ai-review -->` and edits it in place (`gh pr comment --edit-last` is not
marker-aware; use `gh api` to list PR comments, grep for the marker, then
`PATCH`/`POST` accordingly). Concurrency cancellation prevents in-flight
pile-up within one push but not across pushes, so the marker lookup is what keeps
it to one comment.

**`structured_output` is a single JSON string.** GitHub composite actions cannot
expose dynamic named outputs, so all schema fields arrive bundled in
`steps.<id>.outputs.structured_output`. Parse with `jq` in bash; do not expect
`steps.<id>.outputs.<field>`.

**Scores cannot use JSON-Schema `minimum`/`maximum` on integers** — Anthropic
structured output rejects numeric bounds on integer types (noted in the M5L2
lesson's `review-schema.ts`). Encode the 1–10 range in each property's
`description`, and add a bash sanity check (`1 <= n <= 10`) in the post step
rather than relying on the schema to enforce it.

## Phase 1: Workflow skeleton + auth smoke test

### Overview

Create the workflow file with the full job structure — triggers, permissions,
concurrency, fork guard, checkout, and the `claude-code-action` step with a
throwaway prompt. Prove the OAuth token authenticates via a manual
`workflow_dispatch` run.

### Changes Required:

#### 1. New workflow file

**File**: `.github/workflows/ai-review.yml`

**Intent**: Stand up the workflow so the Action runs on PRs to `main` and on
manual dispatch, authenticating with the subscription OAuth token. Phase 1 uses a
minimal prompt ("Reply with a one-line confirmation that you can read this
repository.") so the run exercises auth + checkout + the Action without yet
depending on the review logic.

**Contract**:

- `name: AI Code Review`
- Header comment: what it does, that it runs on the OAuth token under consumer
  terms (see #133), and that it is informational — not a required check.
- `on`:
  - `pull_request: { branches: [main], types: [opened, synchronize], paths-ignore: ['**/*.md', 'context/**'] }`
  - `workflow_dispatch: {}`
- `concurrency: { group: ai-review-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true }`
- One job `review`:
  - `runs-on: ubuntu-latest`, `timeout-minutes: 15`
  - `if: ${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository }}`
  - `permissions: { contents: read, pull-requests: write, id-token: write }`
  - Step 1: `actions/checkout@v4` with `fetch-depth: 1`
  - Step 2: `anthropics/claude-code-action@19dda84776b3518d98b8798e591daee763049ed3 # v1.0.220`
    with `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`,
    a minimal `prompt`, and
    `claude_args: |` → `--max-turns 5`

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML and registered: `gh workflow list` shows "AI Code Review"
- `actionlint .github/workflows/ai-review.yml` reports no errors (via
  `docker run --rm -v $(pwd):/repo rhysd/actionlint` or the Go binary if present;
  skip with a note if the tool is unavailable)
- Action reference is pinned to a 40-hex SHA (grep: no `@v1` / `@main` in the file)

#### Manual Verification:

- `gh workflow run "AI Code Review"` on the branch → run completes with
  conclusion `success`
- The run log shows the Action authenticated (no "invalid token" / 401) and did
  not print the token value
- Opening the run in the browser shows at least one job with logs (badge
  evidence category 1 + 2)

**Implementation Note**: After Phase 1 automated checks pass, pause for manual
confirmation that the `workflow_dispatch` run went green before proceeding.

---

## Phase 2: Review prompt + JSON schema + sticky comment

### Overview

Replace the throwaway prompt with the real review instructions, add the
`--json-schema` contract, and add a bash step that renders the structured output
into a sticky PR comment. All PR-specific steps are guarded so `workflow_dispatch`
still works.

### Changes Required:

#### 1. Review prompt + schema

**File**: `.github/workflows/ai-review.yml` (the `claude-code-action` step)

**Intent**: Instruct the Action to review the PR diff against every criterion in
`.github/review-criteria.md`, score each 1–10 using that file's `1:`/`10:`
anchors, produce an overall advisory verdict and a Markdown summary, and return
it as schema-validated structured output. The diff is obtained by the agent via
`gh pr diff` (read-only tool); the criteria file is read from the checkout.

**Contract**:

- `prompt` (multi-line): states `REPO` / `PR NUMBER` from the event payload;
  tells the agent the branch is checked out; instructs it to read
  `.github/review-criteria.md`, score all 6 criteria, and return
  `scores` (object keyed by short criterion slug), `verdict` (`pass` | `fail`),
  `summary` (Markdown). Explicitly: `pass`/`fail` is advisory. For
  `workflow_dispatch` (no PR) it should review the latest commit instead.
- `claude_args`:
  - `--max-turns 15`
  - `--allowedTools "Bash(gh pr diff:*),Bash(gh pr view:*),Read,Grep,Glob"`
  - `--json-schema '<schema>'` — object with:
    - `scores`: object, 6 required integer properties, one per criterion slug
      (`implementation_correctness`, `project_idiomaticity`, `complexity`,
      `test_risk_coverage`, `change_documentation`, `security_platform_limits`),
      each `description` stating the 1–10 range
    - `verdict`: `{ "type": "string", "enum": ["pass", "fail"] }`
    - `summary`: `{ "type": "string" }`
    - `required`: `["scores", "verdict", "summary"]`
- `id: review` on the step so the post step can read
  `steps.review.outputs.structured_output`.

Full schema JSON (load-bearing — Phase 3 and #136 depend on this exact shape):

```json
{
  "type": "object",
  "properties": {
    "scores": {
      "type": "object",
      "properties": {
        "implementation_correctness": { "type": "integer", "description": "1-10, per .github/review-criteria.md anchors" },
        "project_idiomaticity":       { "type": "integer", "description": "1-10" },
        "complexity":                 { "type": "integer", "description": "1-10" },
        "test_risk_coverage":         { "type": "integer", "description": "1-10" },
        "change_documentation":       { "type": "integer", "description": "1-10" },
        "security_platform_limits":   { "type": "integer", "description": "1-10" }
      },
      "required": ["implementation_correctness","project_idiomaticity","complexity","test_risk_coverage","change_documentation","security_platform_limits"]
    },
    "verdict": { "type": "string", "enum": ["pass", "fail"] },
    "summary": { "type": "string" }
  },
  "required": ["scores", "verdict", "summary"]
}
```

#### 2. Sticky comment post step

**File**: `.github/workflows/ai-review.yml` (new final step)

**Intent**: Render the structured output into a Markdown comment (score table +
verdict + summary + fenced JSON block with the hidden marker) and post it once
per PR, editing the existing marked comment on subsequent runs.

**Contract**:

- Step `name: Post review comment`, `if: ${{ github.event_name == 'pull_request' && steps.review.outputs.conclusion == 'success' }}`
- `env: { GH_TOKEN: ${{ github.token }}, PR: ${{ github.event.pull_request.number }}, OUT: ${{ steps.review.outputs.structured_output }} }`
- Bash: `jq` the fields; sanity-check each score is an integer in `1..10` (fail
  the step with a clear message otherwise); build the body with a leading
  `<!-- ai-review -->` marker; look up an existing comment via
  `gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments"` filtered on the marker;
  `PATCH` it if found, else `POST` a new one.
- Body layout: marker · `## AI Code Review` · table (Criterion | Score) · line
  `**Verdict:** \`pass|fail\` _(advisory — see #140)_` · `### Summary` + the
  Markdown summary · a `<details>` block with the fenced ```json.

#### 3. Header comment update

**File**: `.github/workflows/ai-review.yml`

**Intent**: Update the header comment to describe the real behavior (reviews
against `.github/review-criteria.md`, posts a sticky JSON comment, verdict
advisory).

**Contract**: Comment-only edit.

### Success Criteria:

#### Automated Verification:

- `actionlint` clean (or skipped-with-note as in Phase 1)
- `jq` accepts the embedded `--json-schema` string as valid JSON:
  extract it and pipe through `jq empty`
- Action reference still SHA-pinned; `--json-schema`, `--max-turns 15`, and the
  read-only `--allowedTools` list are all present
- `git grep -c 'secrets\.' .github/workflows/ai-review.yml` shows the token is
  referenced only in the Action step (not echoed in any `run:`)

#### Manual Verification:

- Re-run `workflow_dispatch` → still green; the post step is skipped (not failed)
  because it is `pull_request`-only
- On a scratch PR: the run produces `structured_output`, the post step posts one
  comment, the fenced JSON parses (`... | jq .`) and has all 6 score keys +
  `verdict` + `summary`
- A second push to the same PR updates the same comment rather than adding a new one

**Implementation Note**: After Phase 2 automated checks pass, pause for manual
confirmation (the scratch-PR check) before Phase 3.

---

## Phase 3: End-to-end verification on test PRs

### Overview

Prove the reviewer's judgement is useful, not just well-formed: one PR with a
deliberate flaw must be flagged, one clean PR must pass. No workflow file changes
in this phase unless a defect is found.

### Changes Required:

#### 1. Planted-flaw PR (throwaway)

**File**: a scratch branch touching a real code path (e.g. a small change to a
worker `lib/` file that hardcodes a fake secret string or drops a null check)

**Intent**: Trigger the workflow on a PR that should not pass, and confirm the
review calls out the specific flaw.

**Contract**: Branch + PR created with `gh`; closed without merging after
verification. The change must hit a `paths-ignore`-excluded path's complement
(i.e. actual code, not docs) so the workflow runs.

#### 2. Clean PR (throwaway)

**File**: a scratch branch with a trivial, correct change (e.g. a small
copy/refactor in a component)

**Intent**: Confirm a well-formed small change gets `verdict: pass`.

**Contract**: Branch + PR via `gh`; closed without merging.

### Success Criteria:

#### Automated Verification:

- On the planted-flaw PR run: `gh pr view <n> --json comments` → the AI review
  comment exists; its fenced JSON parses; `security_platform_limits` (or the
  criterion matching the flaw) score is `<= 3`
- On the clean PR run: the comment's JSON parses and `verdict == "pass"`
- Neither run's logs contain the token value
  (`gh run view <id> --log | grep -c '<token-prefix>'` → 0)

#### Manual Verification:

- The planted-flaw comment's `summary` names the actual flaw (hardcoded secret /
  missing null check), not a generic remark
- The clean PR comment reads as a reasonable pass
- Screenshots captured for badge evidence: pipeline view with the job, job logs,
  and the review comment on the PR (feeds #137)
- Both scratch PRs and branches are closed/deleted

**Implementation Note**: This phase is verification-only. If the reviewer misses
the planted flaw or fails a clean PR, treat it as a prompt/schema defect, return
to Phase 2, adjust, and re-verify.

---

## Testing Strategy

### Automated:

- `actionlint` on the workflow file (best-effort — note if the tool is absent).
- `jq` validation of the embedded `--json-schema` string.
- Grep guards: SHA-pinned action, no `@v1`/`@main`, token referenced only in the
  Action step.
- Post-run assertions via `gh` + `jq` on the review comment's JSON (Phase 3).

### Manual:

1. `gh workflow run "AI Code Review"` → green, auth OK, token not printed (Phase 1).
2. Scratch PR → one sticky comment, JSON valid, 6 scores + verdict + summary
   (Phase 2).
3. Second push to that PR → same comment updated, not duplicated (Phase 2).
4. Planted-flaw PR → flaw flagged, low score on the matching criterion (Phase 3).
5. Clean PR → `verdict: pass` (Phase 3).

### Manual Testing Steps:

1. Push the branch, run `gh workflow run "AI Code Review" --ref ci/ai-review-workflow`.
2. `gh run watch` → confirm `success`.
3. `gh run view <id> --log | grep -i 'token\|401\|invalid'` → nothing sensitive.
4. Create the scratch PRs with `gh pr create`, let `synchronize` fire, inspect
   `gh pr view <n> --json comments`.
5. Close scratch PRs, delete branches.

## Performance Considerations

- `--max-turns 15` + `timeout-minutes: 15` bound each run (M5L2 "Kontrola
  kosztów"). Default model (subscription-selected).
- `concurrency` with `cancel-in-progress` stops stacked runs on rapid pushes.
- `paths-ignore` skips pure-docs PRs entirely.
- The job is a checkout + one Action step + one short bash step — no build, no
  `npm ci`.

## Migration Notes

None — additive. No schema, no data, no deploy change. The workflow is not a
required check, so merging it cannot block existing PRs.

## References

- Research: `context/changes/ai-review-workflow/research.md`
- Criteria file (consumed): `.github/review-criteria.md`
- Repo workflow conventions: `.github/workflows/e2e.yml`
- Auth decision: issue #133 (closed)
- Action pin: `anthropics/claude-code-action@19dda84776b3518d98b8798e591daee763049ed3` (`v1.0.220`)
- Course: M5L2 tasks 2–3, M5L3 §"Claude w GHA - Claude Action", §"Integracja
  GitHub Actions z Agentem do Code Review"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Workflow skeleton + auth smoke test

#### Automated

- [x] 1.1 Workflow file is valid YAML and registered (`gh workflow list` shows "AI Code Review") — fe3a137
- [x] 1.2 `actionlint` reports no errors (or skipped-with-note if unavailable) — fe3a137
- [x] 1.3 Action reference pinned to a 40-hex SHA (no `@v1` / `@main`) — fe3a137

#### Manual

- [x] 1.4 PR-triggered run completes with conclusion `success` (infra smoke: OIDC + Claude App-token exchange OK; agent run deferred to Phase 3 by the workflow-validation guard until merge) — fe3a137
- [x] 1.5 Run log shows auth OK and no token value printed (`CLAUDE_CODE_OAUTH_TOKEN: ***`) — fe3a137
- [x] 1.6 Run visible in browser with at least one job + logs (badge evidence 1+2) — fe3a137

### Phase 2: Review prompt + JSON schema + sticky comment

> Built in the same PR as Phase 1 (#142). Behavioural checks (2.5–2.7) cannot run
> pre-merge (workflow-validation guard) — they are verified post-merge together
> with Phase 3.

#### Automated

- [x] 2.1 `actionlint` clean (or skipped-with-note) — c26fdf6
- [x] 2.2 Embedded `--json-schema` string is valid JSON (`jq empty`) — c26fdf6
- [x] 2.3 SHA-pinned; `--json-schema`, `--max-turns 15`, read-only `--allowedTools` all present — c26fdf6
- [x] 2.4 Token referenced only in the Action step, not echoed in any `run:` — c26fdf6

#### Manual

- [ ] 2.5 (post-merge) `workflow_dispatch` on `main` green; post step skipped (not failed) on the dispatch path
- [ ] 2.6 (post-merge) Scratch PR → one comment, fenced JSON parses, 6 scores + verdict + summary
- [ ] 2.7 (post-merge) Second push updates the same comment, no duplicate

### Phase 3: End-to-end verification on test PRs (post-merge)

#### Automated

- [ ] 3.1 Planted-flaw PR: review comment exists, JSON parses, matching criterion score `<= 3`
- [ ] 3.2 Clean PR: JSON parses and `verdict == "pass"`
- [ ] 3.3 Neither run's logs contain the token value

#### Manual

- [ ] 3.4 Planted-flaw `summary` names the actual flaw, not a generic remark
- [ ] 3.5 Clean PR comment reads as a reasonable pass
- [ ] 3.6 Badge evidence screenshots captured (pipeline view, job logs, PR comment) — feeds #137
- [ ] 3.7 Scratch PRs and branches closed/deleted
