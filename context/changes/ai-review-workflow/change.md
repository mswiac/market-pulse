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
