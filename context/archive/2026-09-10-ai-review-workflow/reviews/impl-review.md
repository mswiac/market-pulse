<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Code Review Workflow

- **Plan**: context/changes/ai-review-workflow/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-09-10
- **Verdict**: APPROVED
- **Triage**: F1 skipped (by design), F2 + F3 fixed
- **Findings**: 0 critical, 1 warning, 2 observations

## Context

The workflow itself (`.github/workflows/ai-review.yml`, Phases 1–2) shipped in
PR #142 (`dfcce36`). This session executed the post-merge verification
(Phase 2 manual + Phase 3) and the plan close-out (`a0e3961`, merged as
`ef30bd1` via PR #145). The review covers the workflow file as merged plus the
verification evidence.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated success criteria

| Check | Result |
|-------|--------|
| 1.1 `gh workflow list` shows "AI Code Review" | PASS (id 354901707, active) |
| 1.3 / 2.3 `claude-code-action` pinned to 40-hex SHA, no `@v1`/`@main` | PASS (`@19dda84776b3518d98b8798e591daee763049ed3`) |
| 2.2 embedded `--json-schema` is valid JSON | PASS (3 top keys, 6 score keys, all `required`) |
| 2.3 `--json-schema`, `--max-turns 15`, read-only `--allowedTools` present | PASS |
| 2.4 OAuth token referenced only in the Action step | PASS (line 59 + header comment; no `run:` echo) |
| 1.2 / 2.1 `actionlint` | SKIPPED — not installable in this sandbox (read-only FS); plan permits skip-with-note. 4 green production runs are stronger evidence. |

Manual criteria 2.5–3.5 verified against runs 34488487398 / 34495599668 /
34496197863 and PRs #143 / #144 (see `change.md` → "Post-merge verification").

## Findings

### F1 — Progress rows 3.6 / 3.7 marked done ahead of the work

- **Severity**: 🟡 WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/ai-review-workflow/plan.md:489-490
- **Detail**: 3.6 ("Badge evidence screenshots captured") and 3.7 ("Scratch PRs
  and branches closed/deleted") are `- [x]`, but the screenshots are not
  captured and PRs #143 / #144 are deliberately still open. Both rows carry an
  inline annotation saying the work is delegated to #137, and `change.md`
  documents the same, so the deferral is transparent and was an explicit user
  decision — but the checkbox text alone reads as complete.
- **Fix**: Leave as-is — the inline "delegated to #137" annotation already
  states the truth and #137 tracks the remaining work; re-opening the plan to
  un-check two rows that are done-except-for-a-tracked-handoff adds no value.
- **Decision**: SKIPPED — leave as-is; the inline "delegated to #137" annotation states the truth and #137 tracks the remaining work

### F2 — Sticky-comment lookup won't fail the step on a transient API error

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ai-review.yml:166
- **Detail**: `all_ids=$(gh api "repos/${REPO}/issues/${PR}/comments" --paginate
  --jq "...")` — under `set -e`, a failed command substitution in an assignment
  does not abort the step. A transient GitHub API error would yield an empty
  `all_ids` → empty `existing` → the step POSTs a fresh comment instead of
  editing the existing one, producing a duplicate `<!-- ai-review -->` comment.
  Rare and cosmetic (concurrency cancellation covers the common case), but the
  marker-lookup is the only thing keeping the comment singular across pushes.
- **Fix**: Guard the call explicitly, e.g. `if ! all_ids=$(gh api ... ); then
  echo "::error::comment lookup failed"; exit 1; fi`.
- **Decision**: FIXED — wrapped the `gh api` comment lookup in `if ! ...; then exit 1; fi` (.github/workflows/ai-review.yml)

### F3 — Sticky-comment body uses an unquoted heredoc

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ai-review.yml:143-164
- **Detail**: `body=$(cat <<EOF ... EOF)` is unquoted, so any `$(...)` or
  unescaped backtick written literally between the markers would execute on the
  runner. It is safe as written — the ```` ```json ```` fences and the
  backticks around `${verdict}` are all backslash-escaped, and expanded
  variable *values* (`${summary}`, `${pretty}`) are not re-evaluated by bash.
  The risk is purely forward-looking: a future edit adding an unescaped
  backtick to the template would introduce command execution.
- **Fix**: Switch to `<<'EOF'` and substitute the fields with a non-eval
  mechanism (e.g. `python -c` / `jq -n` building the body, or `envsubst` over a
  whitelisted var set).
- **Decision**: FIXED — replaced the unquoted heredoc with a `printf '%s\n'` over the already-validated shell vars; model text is inserted as data, never re-parsed

## Notes

- Plan adherence is exact: `on` triggers, `paths-ignore`, `concurrency` group,
  fork guard `if:`, `permissions`, `fetch-depth: 1`, the SHA pin, `--max-turns
  15`, the read-only `--allowedTools` set, the `--json-schema` shape, and the
  sticky-comment post step all match the plan's contract point for point.
- The concurrency group (`ai-review-${{ pr.number || ref }}`) intentionally
  differs from `e2e.yml`'s (`e2e-${{ workflow }}-${{ ref }}`) — per-PR grouping
  is the plan's deliberate, and better, choice. Not a pattern violation.
- No scope creep: the diff is the single workflow file plus the change folder.
