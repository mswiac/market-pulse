---
change_id: ai-review-workflow
title: AI code review workflow via Claude Code Action on PRs to main
status: impl_reviewed
created: 2026-09-10
updated: 2026-09-10
archived_at: null
---

## Notes

GitHub Actions workflow running the Claude Code Action on every PR to main,
reviewing the diff against .github/review-criteria.md and posting a structured
JSON review comment. Issue #135.

## Prerequisite discovered during Phase 1

`anthropics/claude-code-action` exchanges the workflow's OIDC token for a Claude
GitHub App installation token *before* it checks `CLAUDE_CODE_OAUTH_TOKEN`. That
exchange returns `401 Claude Code is not installed on this repository` until the
**Claude GitHub App** (https://github.com/apps/claude) is installed on
`mswiac/market-pulse`. This is a human, repo-admin step (not covered by #133).
Decision (2026-09-10): install the App rather than fall back to
`github_token: ${{ secrets.GITHUB_TOKEN }}` — keeps the `claude[bot]` identity.
We do NOT pass `github_token`, so `use_sticky_comment` limitations do not apply
(Phase 2 posts its own marker-based sticky comment via a bash step).

## Post-merge verification (Phase 2 manual + Phase 3), 2026-09-10

Ran after PR #142 merged. Session interrupted by a power outage mid-Phase-3;
resumed and completed.

- **2.5** — `workflow_dispatch` on `main` (run 34488487398): green, agent ran,
  `Post review comment` step `skipped` (not failed) on the no-PR path.
- **2.6 / 2.7** — planted-flaw PR **#143**: one `<!-- ai-review -->` sticky
  comment, fenced JSON valid, 6 scores + verdict + summary; a second push edited
  the same comment in place (no duplicate).
- **3.1 / 3.4** — PR #143 flagged `security_platform_limits: 1/10`,
  `verdict: fail`; summary names the SQL injection (`${id}` interpolated into
  SQL) and the IDOR (no `user_id` scoping) by file and line.
- **3.2 / 3.5** — clean refactor PR **#144**: `verdict: pass`, "No issues
  found", scores 9–10.
- **3.3** — no OAuth token string in any run log (`grep -c sk-ant` = 0).
- **3.6 / 3.7** — screenshot capture + submission and the eventual teardown of
  PRs #143 / #144 (and their `test/ai-review-*` branches) are delegated to
  **#137**; the PRs are deliberately left open as live badge evidence.
