# Stryker mutation testing — profiles and gotchas

Mutation testing is an **additional** quality gate, not a stand-in for code
coverage. `thresholds.break` is `null` on purpose in both configs — a low
score never fails CI by itself.

## Scope discipline

- Run Stryker only for code touched by the current change, or a risk named in
  `test-plan.md`.
- Prefer a narrowed `--mutate "path/to/file.ts"` scope over a full-repo run.
- Do not chase a 100% mutation score. Review survived mutants one by one; add
  an assertion only when the mutant represents a user-visible or
  business-relevant bug, not just to move the score.

## Two profiles

The repo needs two separate Stryker config profiles because the worker and
Angular test setups need different runners.

### Worker profile — `stryker.config.json`

Scoped to `src/worker/**/*.ts`. Uses the dedicated
`@stryker-mutator/vitest-runner`, driving `vitest` directly against
`vitest.config.mts`.

```
npx stryker run --mutate "src/worker/lib/some-file.ts"
```

**Known gotcha — `vitest.related: false` is deliberate.** The runner's default
(`related: true`) uses Vitest's static import-graph analysis to narrow which
tests run per mutant. But this repo's worker tests dispatch through
`exports.default.fetch()` from the `cloudflare:workers` virtual module (see
`test/worker/*.test.ts`), not a direct ES import of the route/handler under
test. With `related: true`, every mutant in `src/worker/routes/**` and several
`lib/` files (`admin.ts`, `email.ts`, `session.ts`) silently reports "no
coverage" — looking untested even though real tests exist and pass. Keep
`related: false` (full suite per mutant, slower but correct) unless this test
style changes.

### Angular profile — `stryker.config.app.json`

Scoped to `src/app/**/*.ts`, excluding `*.spec.ts`. Uses Stryker's `command`
runner (`testRunner: "command"`, `commandRunner.command: "npm run test:ci"`,
`coverageAnalysis: "off"`) instead of `@stryker-mutator/vitest-runner`.

```
npx stryker run --configFile stryker.config.app.json --mutate "src/app/features/some/component.ts"
```

**Why a different runner.** `ng test` runs through Angular's native
`@angular/build:unit-test` builder (config lives in `angular.json` /
`tsconfig.spec.json`), which doesn't expose a standalone `vitest.config.ts`
file for `@stryker-mutator/vitest-runner` to drive — that plugin needs a
config file it can hand to Vitest directly. The `command` runner sidesteps
this by treating `ng test --watch=false --progress=false` (the `test:ci`
script) as an opaque pass/fail check per mutant. Tradeoff: no
`coverageAnalysis: "perTest"`, so the full Angular suite reruns for every
mutant — slower than the worker profile, but the only option that works
against the native builder today (also an open upstream gap, see
[stryker-js#5655](https://github.com/stryker-mutator/stryker-js/issues/5655)).
Revisit if `vitest-runner` ever gains native `@angular/build:unit-test`
support.
