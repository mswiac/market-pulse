# AI Code Review Workflow — Plan Brief

> Full plan: `context/changes/ai-review-workflow/plan.md`
> Research: `context/changes/ai-review-workflow/research.md`

## What & Why

Add `.github/workflows/ai-review.yml` — a GitHub Actions workflow that runs the
official `anthropics/claude-code-action` on every PR to `main`, reviews the diff
against `.github/review-criteria.md`, and posts one sticky PR comment with a
schema-validated JSON verdict and a score table. This is issue #135, the core
deliverable of the #132 10xChampion badge pipeline.

## Starting Point

The repo has one workflow (`.github/workflows/e2e.yml`) that sets the
conventions. The `CLAUDE_CODE_OAUTH_TOKEN` secret (issue #133) and the 6-criterion
`.github/review-criteria.md` file (issue #134 / PR #141) are already in place.
Nothing consumes them yet.

## Desired End State

Opening or updating a PR to `main` (from a branch in this repo, non-docs-only)
triggers a review that posts/updates a single comment: a Markdown table of the 6
criterion scores, an advisory `pass`/`fail` verdict, a summary, and a fenced
```json block that parses. A manual `workflow_dispatch` run authenticates and
goes green. No secret appears in logs. The verdict never fails the check (hard
gate is #140).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Comment mechanism | `--json-schema` → validated `structured_output` → bash step renders + posts | Deterministic, schema-valid JSON; minimal tool surface for the agent; matches `e2e.yml`'s explicit-bash style | Plan |
| Action version | SHA-pin `19dda847…` (`v1.0.220`) | Third-party code with secret access — pin, not the moving `@v1` tag | Research |
| Auth input | `claude_code_oauth_token` | Confirmed input name; subscription token from #133, no paid key | Research |
| Node / `npm ci` in job | None | Action self-installs its runtime; review is static (diff + criteria file only) — npm@11 criterion N/A | Research |
| Agent tools | Read-only: `Bash(gh pr diff:*)`, `Bash(gh pr view:*)`, `Read`, `Grep`, `Glob` | Agent never writes to GitHub; the bash step is the sole comment author | Plan |
| PR scope | All PRs to `main` except pure-docs (`paths-ignore: **/*.md, context/**`) | Don't burn turns on README/plan-only PRs; everything else covered | Plan |
| Cost bound | `--max-turns 15` + default model + `timeout-minutes: 15` | Hard ceiling on the agent loop and the job (M5L2 "Kontrola kosztów") | Plan |
| Fork-PR guard | `if:` same-repo check | `pull_request` gives forks no secret — skip cleanly instead of a red run | Plan |
| Verdict semantics | Advisory — no `exit 1` on `fail` | Hard merge gate is #140 | Plan |
| Concurrency | Per-PR group, `cancel-in-progress: true` | No stacked runs / duplicate comments on rapid pushes | Plan |

## Scope

**In scope:**
- One workflow file: triggers, permissions, concurrency, fork guard, checkout,
  the Action step, the sticky-comment bash step
- JSON schema for `{ scores (6), verdict, summary }` (reusable by #136)
- `workflow_dispatch` smoke path (closes the #133 smoke-test criterion)
- E2E verification on a planted-flaw PR and a clean PR

**Out of scope:**
- Composite action extraction (#138)
- Labels, retry-on-label, merge-blocking status check (#140)
- Extra agent tools / plan-vs-diff review / skills wiring (#139)
- promptfoo eval (#136)
- Making this a required branch-protection check
- Reviewer running project commands (typecheck/tests/lint)

## Architecture / Approach

`pull_request` / `workflow_dispatch` → one `ubuntu-latest` job → `checkout` →
`claude-code-action` (read-only tools, `--json-schema`) emits a validated
`structured_output` string → a bash step parses it with `jq`, sanity-checks the
scores, renders a Markdown comment with a `<!-- ai-review -->` marker, and
posts/updates it via `gh api`. The agent never touches the GitHub write API.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Skeleton + auth smoke | Workflow file with trivial prompt; green `workflow_dispatch` run | OAuth token not accepted in CI / wrong input name |
| 2. Prompt + schema + comment | Real review instructions, `--json-schema`, sticky-comment bash step | `structured_output` shape / model not returning all 6 scores; sticky-comment lookup logic |
| 3. E2E verification | Planted-flaw PR flagged, clean PR passes; badge screenshots | Reviewer misses the planted flaw → back to Phase 2 prompt tuning |

**Prerequisites:** #133 secret (done), #134 criteria file (done, PR #141 merged).
**Estimated effort:** ~2–3 sessions across 3 phases; Phase 3 needs throwaway PRs.

## Open Risks & Assumptions

- Assumes the subscription OAuth token works from a GitHub Actions runner
  (Phase 1 exists to prove exactly this).
- Assumes `--json-schema` on `claude-code-action@v1.0.220` behaves as documented
  (validated `structured_output` string).
- The model may occasionally return a score outside 1–10 or omit a key — the
  bash step hard-checks and fails loudly rather than posting a bad comment.
- `actionlint` may not be installed locally; automated lint is best-effort.

## Success Criteria (Summary)

- Manual `workflow_dispatch` run authenticates and completes green, no secret in logs.
- A real PR gets one sticky comment whose fenced JSON parses and carries 6 scores
  + verdict + summary.
- A planted-flaw PR is flagged on the matching criterion; a clean PR gets `pass`.
