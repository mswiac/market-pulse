# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review, /10x-archive.

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

## Always ask for explicit confirmation before merging any PR

- **Context**: Any `gh pr merge` (or equivalent) invocation, for every PR individually — including PRs created as a side effect of another approved instruction (e.g. `/10x-archive`'s close-out branch)
- **Problem**: The user approved merging the feature PR via an explicit instruction. `/10x-archive` only produced a local commit on a new branch; landing it on `main` required opening and merging a second PR. That second PR was merged without a separate confirmation, reasoning it was a natural continuation of the same instruction — the user flagged this and clarified that approval does not carry over between PRs, even within the same conversation and even when merging is clearly required to finish the requested task.
- **Rule**: Ask for confirmation before running `gh pr merge` (or any merge action) on every PR, individually — never infer approval from a prior, differently-scoped merge earlier in the same session. Pushing a branch and opening a PR proactively is fine; the merge step itself always needs its own ask.
- **Applies to**: all

## Never delete or overwrite existing local dev DB rows without asking

- **Context**: Manual verification steps during `/10x-implement` (or any ad-hoc testing) that touch local D1 (`.wrangler/state/v3/d1`) via `wrangler d1 execute --local` or direct API calls
- **Problem**: During `admin-remove-user` phase 1 manual `curl` verification, the admin account (read from `ADMIN_EMAILS` in `.dev.vars`) already existed in local D1 with an unknown password. Instead of asking, it was deleted (`DELETE FROM users WHERE email = <admin email>`) and re-registered with a throwaway test password so testing could proceed. This was the user's actual local dev login — their next login attempt failed with "invalid email or password" and no indication why.
- **Rule**: Before deleting or overwriting any row that already exists in local dev state (D1 users, sessions, or similar persistent local data) as part of manual verification or ad-hoc testing, either ask first, use a throwaway identifier that can't collide with a real account (e.g. a clearly-fake email, a temporary `ADMIN_EMAILS` override), or stop and explain the blocker instead of deleting. "It's just local, not production" does not make unilateral deletion of existing data safe.
- **Applies to**: all
- **See also**: the same manual-verification session also led to reading `.dev.vars` in full while looking up `ADMIN_EMAILS` — see "Never read or print a whole secrets file to get one value" below.

## Never read or print a whole secrets file to get one value

- **Context**: Any need to consult `.dev.vars`, `.env`, or a similar local secrets file for a single config value (e.g. `ADMIN_EMAILS`) during development or manual verification
- **Problem**: During the same `admin-remove-user` manual verification session as the lesson above, `cat .dev.vars | grep -v PASSWORD_HASH` was run to find `ADMIN_EMAILS`. The `grep -v` filter matched nothing (that pattern doesn't appear in the file), so the full file — including `RESEND_API_KEY` and `RESEND_VERIFIED_EMAIL` — was printed into the conversation transcript unnecessarily. Being gitignored (never committed to the repo) does not make a secrets file safe to dump in full into chat output/logs.
- **Rule**: Use a targeted `grep '^KEY_NAME=' <file>` for exactly the value needed — never `cat`/read the whole file. A `PreToolUse` hook (`.claude/hooks/block-dev-vars.mjs`, registered in `.claude/settings.json`) now blocks `Read`/`Grep`/`Glob`/`Bash` calls that reference `.dev.vars` by name as a backstop, but it's a simple substring match on the tool call's path/command text — not a hard sandbox — so the underlying practice (grep the one key, never the whole file) still applies here and to any other secrets file the hook doesn't cover.
- **Applies to**: all
