---
date: 2026-09-10T00:00:00Z
researcher: Claude (Sonnet 5)
git_commit: 21af96991b324d03c0cf1d7a9713a57068fa9932
branch: main
repository: mswiac/market-pulse
topic: "AI code review workflow via anthropics/claude-code-action (issue #135)"
tags: [research, ci, github-actions, claude-code-action, code-review]
status: complete
last_updated: 2026-09-10
last_updated_by: Claude (Sonnet 5)
---

# Research: AI code review workflow via Claude Code Action (issue #135)

**Date**: 2026-09-10
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 21af96991b324d03c0cf1d7a9713a57068fa9932
**Branch**: main
**Repository**: mswiac/market-pulse

## Research Question

Everything needed to author `.github/workflows/ai-review.yml`: exact
`anthropics/claude-code-action` input names, the commit SHA to pin, the
`permissions` block, whether OIDC (`id-token: write`) is required, how the review
comment actually gets posted, and which repo conventions the workflow must match.

## Summary

- **Action version**: pin to `19dda84776b3518d98b8798e591daee763049ed3` — the
  commit behind tag **`v1.0.220`** (latest as of 2026-09-09; also current `main`
  HEAD). The `v1` tag is a moving pointer; the issue correctly requires a SHA.
- **Auth**: input is **`claude_code_oauth_token`**, wired to
  `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` (the secret from #133). No
  `anthropic_api_key`. `github_token` can be omitted — the action falls back to
  the built-in GitHub App / `github.token`.
- **Automation mode**: setting the **`prompt`** input (not `direct_prompt` /
  `override_prompt` — those are v0.x, removed in v1) makes the action run
  unconditionally on the event, no `@claude` mention needed.
- **Permissions**: `contents: read`, `pull-requests: write`, `id-token: write`.
  Every official example includes `id-token: write` even on the static-key path,
  so include it. `issues: write` is **not** needed for PR comments.
- **Comment posting is not automatic in prompt mode** — Claude only posts if a
  tool lets it. Two viable mechanisms (decision for the plan):
  - **(A) structured output + a plain post step** — `claude_args: --json-schema '<schema>'`
    makes the action validate Claude's result and expose it as
    `steps.<id>.outputs.structured_output` (a JSON string); a following
    `run:` step formats it and posts with `gh pr comment`. Deterministic; the
    JSON block is schema-valid by construction. **Recommended.**
  - **(B) Claude posts directly** — `use_sticky_comment: true` +
    `--allowedTools "Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)"`
    and the prompt tells Claude to post one comment containing the fenced JSON.
    Simpler YAML, but the JSON block's validity depends on the model.
- **No Node/`npm ci` in this job.** The action self-installs Bun + Claude Code.
  The npm@11 acceptance-criterion line only applies if we let the reviewer run
  `npm run typecheck` / tests — recommendation is to keep the review static
  (read the diff + criteria file), so that line is **N/A**.
- **Fork PRs**: `pull_request` does not expose secrets to forks, so a fork PR
  would fail at auth. MarketPulse is a solo repo (branch PRs only) — acceptable;
  optionally guard the job with `if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}`.

## Detailed Findings

### anthropics/claude-code-action — v1 input surface

Source: `action.yml` @ `v1.0.220`, `docs/setup.md`, `docs/usage.md`.

| Input | Value for us | Notes |
|-------|--------------|-------|
| `claude_code_oauth_token` | `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` | Pro/Max `claude setup-token` token. Alternative to `anthropic_api_key`. |
| `prompt` | multi-line review instructions | Non-empty `prompt` ⇒ automation mode, runs on the event with no trigger phrase. |
| `claude_args` | CLI passthrough | `--json-schema '<json>'`, `--allowedTools "..."`, `--max-turns N`, `--model ...`, `--append-system-prompt "..."`. Replaces the removed `model` / `max_turns` / `allowed_tools` / `custom_instructions` inputs. |
| `github_token` | omit | Optional; action uses its GitHub App token / `github.token` otherwise. |
| `use_sticky_comment` | `true` if mechanism B | "Use just one comment to deliver PR comments (pull_request events only)". |
| `track_progress` | `false` (default) | Forces tag-mode tracking comment with checkboxes; heavier than we need. |
| `settings` | unused | JSON or path to a Claude Code settings file. |
| `anthropic_api_key` | unused | Static key takes precedence over federation; don't set alongside anything else. |

`outputs`: `conclusion` (`success`/`failure`), `structured_output` (JSON string,
populated only when `--json-schema` is passed), `session_id`, `execution_file`.
**Composite actions can't expose dynamic named outputs**, hence the single
bundled `structured_output` string — parse with `fromJSON(...)` in an
`if:`/expression or `jq` in bash.

### Version / SHA pinning

- `gh api repos/anthropics/claude-code-action/releases/latest` → tag `v1`
  (moving), published 2025-08-26 (the v1 GA marker).
- `repos/.../tags` → newest immutable tag `v1.0.220` →
  `19dda84776b3518d98b8798e591daee763049ed3`.
- `repos/.../commits/main` HEAD → same SHA (`chore: bump Claude Code to
  2.1.267 and Agent SDK to 0.3.267`, 2026-09-09).
- `docs/security.md` is about prompt-injection / `pull_request_target` checkout
  hygiene, not SHA pinning, but the issue's rule (third-party code with secret
  access → pin a SHA) stands. Pin line:
  `uses: anthropics/claude-code-action@19dda84776b3518d98b8798e591daee763049ed3 # v1.0.220`

### Permissions & OIDC

From `examples/pr-review-comprehensive.yml`, `pr-review-filtered-paths.yml`,
`manual-code-analysis.yml`, `claude.yml` — all four use:

```yaml
permissions:
  contents: read          # write only if Claude must push commits (not here)
  pull-requests: write     # post/update the review comment
  id-token: write          # present in every example, even with a static key
```

`id-token: write` is *documented* as required only for workload identity
federation (`anthropic_federation_rule_id` + `anthropic_organization_id`), which
we are not using. But since every official example includes it and it is
harmless, include it rather than risk a runtime OIDC fetch failing.

### How the comment gets posted

`docs/capabilities-and-limitations.md`:
- "Claude operates by updating a single initial comment with progress and results"
- "Claude cannot submit formal GitHub PR reviews" / "cannot approve PRs" /
  "only acts by updating its initial comment"
- "By default, Claude cannot execute Bash commands unless explicitly allowed
  using `allowed_tools`"

`docs/usage.md` "Structured Outputs":
- `--json-schema '{"type":"object","properties":{...},"required":[...]}'` in
  `claude_args`
- result validated against the schema, surfaced as
  `steps.<id>.outputs.structured_output` (JSON string)
- `examples/test-failure-analysis.yml` shows the full pattern: a `claude-code-action`
  step with `--json-schema`, then downstream `run:` steps that
  `echo "$OUTPUT" | jq -r '.field'` and `gh pr comment "$pr_number" --body ...`.

`examples/pr-review-filtered-paths.yml` shows mechanism B:
```yaml
prompt: |
  REPO: ${{ github.repository }}
  PR NUMBER: ${{ github.event.pull_request.number }}
  Please review this pull request focusing on the changed files.
claude_args: |
  --allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)"
```

### workflow_dispatch smoke test

`examples/manual-code-analysis.yml` is the template: `on: workflow_dispatch` with
`actions/checkout` (`fetch-depth: 2`) and a `prompt` that analyzes the latest
commit. For our smoke test the prompt just needs to prove auth + a green run;
it does not need a PR. Guard PR-only steps with
`if: github.event_name == 'pull_request'`.

### Repo workflow conventions (`.github/workflows/e2e.yml`)

- `on: pull_request: branches: [main]` (+ `push` for e2e; not needed here) with a
  `paths:` allowlist.
- `concurrency: group: <prefix>-${{ github.workflow }}-${{ github.ref }}`,
  `cancel-in-progress: true`.
- `runs-on: ubuntu-latest`, `timeout-minutes` set explicitly.
- `actions/checkout@v4` (note: claude-code-action examples now use `@v6`).
- `actions/setup-node@v4` with `node-version-file: .nvmrc` (Node 22.22.3), then
  **`npm install -g npm@11.13.0` before `npm ci`** — the Node-bundled npm 10.9.x
  mis-reconciles wrangler's optional peer. `packageManager` in `package.json` is
  `npm@11.13.0`.
- `env: WRANGLER_SEND_METRICS: 'false'`, CI-only dummy `.dev.vars` written inline
  — never a real secret.
- Header comment explaining what the workflow does and that it is
  informational / not a required check.

`.github/review-criteria.md` (committed in #134, PR #141) — 6 criteria, each with
`1:` / `10:` anchors, plus a "Parked dimensions" section. This is the file the
prompt must point the reviewer at, and its criterion names are the natural keys
for the `scores` object in the JSON block.

### CLAUDE.md inheritance

The action runs inside the repo checkout, so Claude Code picks up the root
`CLAUDE.md`. Issue #135 explicitly accepts this — `review-criteria.md` is the
primary instruction and `CLAUDE.md`'s hard rules (English-only, no spec files,
`context/archive/` immutability) are compatible with a review task. No mitigation
needed.

## Code References

- `.github/workflows/e2e.yml:12-31` - trigger + concurrency conventions
- `.github/workflows/e2e.yml:47-61` - checkout + Node + npm@11 + `npm ci` pattern
- `.github/review-criteria.md:1-20` - the criteria file header / intent
- `.github/review-criteria.md` §§1-6 - criterion names (JSON score keys)
- `package.json` - `packageManager: npm@11.13.0`, scripts (`typecheck`, `test:worker`, `ci`)
- `.nvmrc` - Node 22.22.3

## External References

- Action repo: https://github.com/anthropics/claude-code-action (tag `v1.0.220`)
- `action.yml` @ v1.0.220 - input/output definitions
- `docs/setup.md` - `CLAUDE_CODE_OAUTH_TOKEN` secret, `claude setup-token`
- `docs/usage.md` - automation `prompt`, `claude_args`, Structured Outputs
- `docs/capabilities-and-limitations.md` - single-comment model, no formal reviews
- `docs/security.md` - `pull_request_target` checkout hygiene (not used here)
- `examples/pr-review-comprehensive.yml` - `track_progress` review
- `examples/pr-review-filtered-paths.yml` - `prompt` + `--allowedTools` review
- `examples/test-failure-analysis.yml` - `--json-schema` → `structured_output` → `gh pr comment`
- `examples/manual-code-analysis.yml` - `workflow_dispatch` template
- Pin SHA: `19dda84776b3518d98b8798e591daee763049ed3` (= `v1.0.220`)

## Architecture Insights

- **The action is a self-contained composite action.** It installs Bun and Claude
  Code itself. Our job is a checkout + one `uses:` step (+ optionally one post
  step). No project build, no Node setup, no `npm ci` — unless we deliberately
  let the reviewer run project commands.
- **"Review the diff against a rubric and emit JSON" maps cleanly onto Structured
  Outputs.** `--json-schema` gives a validated `{ scores, verdict, summary }`
  object; a trivial bash step renders it to a Markdown comment. This decouples
  "the model's judgement" from "the comment format", which is exactly what the
  acceptance criterion ("JSON block valid") wants.
- **Determinism vs simplicity is the one real design choice** (mechanism A vs B).
  Everything else (SHA, auth input, permissions, triggers, concurrency) is
  dictated by the docs + repo conventions.

## Open Questions / decisions for /10x-plan

1. **Comment mechanism A vs B** (structured output + post step, vs Claude posts a
   sticky comment). Recommend **A** for a schema-valid JSON block, with the post
   step also embedding the fenced ```json for human readers.
2. **`fetch-depth`** — `1` is enough if the reviewer uses `gh pr diff`; the
   issue says `0`. Recommend `1` (or `2` for the dispatch/commit path).
3. **`paths:` filter** — run on every PR to `main`, or skip docs-only
   (`context/**`, `**/*.md`)? Issue puts label/gating logic in #140; a minimal
   `paths-ignore` for pure-docs PRs is still reasonable. Decide in plan.
4. **`--max-turns` and `--model`** — bound turns for cost (M5L2 "Kontrola
   kosztów"); default model or pin one.
5. **`allowedTools`** — minimum set: `Bash(gh pr diff:*)`, `Bash(gh pr view:*)`,
   `Read`, `Grep`, `Glob` (to open `review-criteria.md` and cited convention
   files); `+ Bash(gh pr comment:*)` only for mechanism B.
6. **Fork-PR guard** — add the `head.repo.full_name == github.repository` `if:`
   or leave it (solo repo).
7. **`verdict` semantics** — `pass`/`fail` is advisory only in this issue (hard
   merge gate is #140). Confirm the workflow does not `exit 1` on `fail`.

## Related Research

None — first CI/agent research artifact in `context/`.

## Historical Context (from prior changes)

- Memory / `context/foundation/lessons.md`: English-only artifacts; branch before
  commit; Conventional Commits; ask before every PR merge.
- #133 (closed) recorded the auth decision: subscription OAuth token, consumer
  terms accepted, training opt-out done.
- #134 / PR #141 (merged): `.github/review-criteria.md` is the single source of
  truth this workflow consumes.
