# Refresh Project Docs — Plan Brief

> Full plan: `context/changes/refresh-project-docs/plan.md`

## What & Why

Issue #207: three project docs drifted from reality. README lacks the alert pause/resume feature and has grown into a reference manual; `roadmap.md` stops at S-12; `test-plan.md` still says Phase 5 is "not started" and describes four e2e specs. This change fixes all three in one PR.

## Starting Point

README is 220 lines across 7 sections. `context/foundation/` already holds topic notes (`admin-panel-notes.md`, `stryker-notes.md`). About 14 product-facing changes and a dozen test changes have been archived since the docs were last updated.

## Desired End State

README is a short entry point (intro, summary, Running locally, Deployment, doc links) with pause/resume mentioned. Reference material lives in `app-overview.md` and `ci-and-repo-notes.md`. The roadmap lists everything shipped; the test-plan shows true rollout status, e2e inventory and ledger.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| README split | 2 new files; mutation content stays in `stryker-notes.md` | It already holds the commands and gotchas, so a new file would duplicate it | Plan |
| Roadmap scope | All product-facing changes (14), tests go to test-plan ledger | Complete roadmap without mixing test work into it | Plan |
| Roadmap format | Table row + Done bullet only | Shipped slices need no full `###` bodies | Plan |
| Test-plan method | Manual targeted edit, no risk-map change | A full `--refresh` is a separate, interview-heavy change | Plan |
| Single change | One change, three phases | User chose to cover the whole issue in one PR | Plan |

## Scope

**In scope:** README restructure + pause mention, two new foundation notes, roadmap backfill, test-plan status/ledger refresh.

**Out of scope:** `/10x-roadmap`, `/10x-test-plan --refresh`, risk-map changes, Prettier reformat of roadmap/test-plan, any code or CLAUDE.md edit.

## Architecture / Approach

Relocate text rather than rewrite it, then fix cross-references and stale facts. Verification is greps and path-existence checks plus a human read-through.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. README split | Slim README, `app-overview.md`, `ci-and-repo-notes.md`, fixed references | Dangling links to moved sections |
| 2. Roadmap backfill | 14 rows + Done bullets | Inaccurate outcome wording; correct archive dates |
| 3. Test-plan refresh | Phase 5/6 status, e2e inventory, ledger | Wrong spec counts; ledger order |

**Prerequisites:** none (#206 archive merged; branch `docs/refresh-project-docs`).
**Estimated effort:** ~1 session, 3 small phases.

## Open Risks & Assumptions

- Issue says 11 e2e specs; the repo has 18. Counted at implementation time.
- Backfilled Done dates use each change's `archived_at`, not the date of this edit.

## Success Criteria (Summary)

- README fits one screen of sections and every link from it resolves.
- Roadmap and test-plan contain no known-stale statements about shipped work.
