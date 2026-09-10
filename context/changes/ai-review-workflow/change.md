---
change_id: ai-review-workflow
title: AI code review workflow via Claude Code Action on PRs to main
status: implementing
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
