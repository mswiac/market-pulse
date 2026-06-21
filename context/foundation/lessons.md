# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always use English in all project artifacts

- **Context**: All phases, all files — source code, commit messages, PR titles, PR bodies, code comments, documentation
- **Problem**: Using Polish in project artifacts makes the codebase inconsistent and unprofessional. Past incident: PR body and commit message were written in Polish before the rule was established.
- **Rule**: Never use Polish in source files, commit messages, PR titles, PR bodies, or any other project artifact committed to the repository. Polish is only permitted in Claude Code console/chat communication with the user.
- **Applies to**: all

## Always use SSH for git remote operations

- **Context**: Any git push, fetch, or remote URL change in this repository
- **Problem**: HTTPS authentication fails with "could not read Username" — no interactive credential prompt is available in this environment
- **Rule**: Always use SSH remote URL (`git@github.com:mswiac/MarketPulse.git`). Before any push or fetch, verify the remote is set to SSH, not HTTPS, via `git remote -v`.
- **Applies to**: all
