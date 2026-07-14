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

## Always use Conventional Commits for commits and PR titles

- **Context**: All commit messages and PR titles in this repo
- **Problem**: PR #21's title read "Auth and registration (S-01)" instead of "feat(S-01): ...", inconsistent with the convention already visible in commit history (e.g. "feat(F-01a): ...", "chore(F-01): ...")
- **Rule**: Always use Conventional Commits (`type(scope): description`) for both commit messages and PR titles in this project; use the roadmap item's ID (e.g. `S-01`, `F-01a`) as the scope when the change maps to one
- **Applies to**: all

## Always branch before committing, never commit directly to main

- **Context**: Every commit made in this repo, including mechanics of the 10x-* skills (e.g. /10x-implement's phase-end ritual, /10x-archive's close-out commit)
- **Problem**: After merging PR #21, the user asked to switch to `main` and run /10x-archive; the skill committed the archive close-out directly onto `main` because that was the checked-out branch, requiring manual surgery (git branch + reset --hard) to move the commit onto a proper feature branch
- **Rule**: Before running any `git commit` (manual or via a skill's commit ritual), check `git branch --show-current`; if it is `main`, create and switch to a new branch first — never commit directly to main, even for small/mechanical changes
- **Applies to**: all
