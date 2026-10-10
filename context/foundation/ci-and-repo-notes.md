# CI and repository notes

How the quality gates are wired and how the repository is laid out. Commands for running checks locally live in the `README.md` "Running locally" section; Stryker profiles are in `stryker-notes.md`.

## CI / quality gate

`main` has a required GitHub branch-protection status check named **`Workers Builds: marketpulse`**. It must pass before any PR can merge, and it runs the same `npm run ci` build command described in the README "Deployment" section (typecheck + backend test suite + Angular build).

This check is configured entirely in the Cloudflare dashboard as a GitHub-App-based status check — it is not defined by a `.github/workflows/` file, husky hook, or lint-staged config. If you need to re-verify it, check branch protection directly:

```bash
gh api repos/mswiac/market-pulse/branches/main/protection
```

There **are** two workflow files, both informational only — they report a
status on PRs but are deliberately not part of branch protection:

- `.github/workflows/e2e.yml` runs the Playwright E2E suite (see README "End-to-end
  tests (Playwright)"). A flaky browser run never blocks a merge; promoting it to a
  required check is a deferred decision (`context/foundation/test-plan.md`
  §3 Phase 6).
- `.github/workflows/ai-review.yml` runs the Claude Code Action on PRs to
  `main`, scoring the diff against `.github/review-criteria.md` and posting a
  single sticky PR comment (score table + advisory verdict). It skips PRs that
  only touch `**/*.md` or `context/**` (its own `paths-ignore`), so a docs-only
  PR gets no review comment. The verdict never fails the check — it's advisory
  only; a hard merge gate on it is a deferred decision (see the workflow
  file's own header comment).

## Project structure notes

- `context/` — the 10x-\* change-tracking structure: `context/changes/` holds in-flight work (research, plans, reviews), `context/archive/` holds completed work, and `context/foundation/` holds living project documents (roadmap, test plan, lessons learned).
- `test/worker/` — the backend test suite (Vitest + `@cloudflare/vitest-pool-workers`), run via `npm run test:worker`.
- `src/app/**/*.spec.ts` — Angular component tests (Vitest via `@angular/build:unit-test`), colocated with each component, run via `npm run test:ci`.
- `e2e/` — Playwright browser-level tests (see the README "End-to-end tests (Playwright)" section); one scenario per file, `seed.spec.ts` is the exemplar the others follow.
- Mutation testing (Stryker) is a manual, optional gate with separate worker and Angular profiles — see `stryker-notes.md`.
