<!-- PLAN-REVIEW-REPORT -->
# Plan Review: i18n Migration Implementation Plan

- **Plan**: context/changes/i18n-migration/plan.md
- **Mode**: Deep
- **Date**: 2026-07-19
- **Verdict**: REVISE → SOUND (after triage — both findings fixed)
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 7/7 paths ✓ (main.ts, angular.json, wrangler.toml, tsconfig.app.json, package.json, alert-form.ts, index.html), 3/3 symbols ✓ (VIX_RSI_ERROR, angular.json outputPath/browser, wrangler.toml directory), brief↔plan ✓

## Findings

### F1 — `pl` locale's default base href will break every asset load once wrangler.toml points at `browser/pl`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 — "Angular i18n & build configuration" (angular.json contract)
- **Detail**: A sub-agent independently traced Angular 22's locale base-href logic
  (`node_modules/@angular/build/src/utils/i18n-options.js:117-134`,
  `.../builders/application/options.js:445-461`, `getLocaleBaseHref`): a
  locale's `subPath` defaults to the locale code unless explicitly overridden,
  and that same `subPath` becomes the `<base href>` suffix baked into the
  locale's `index.html`. A real (built-and-inspected) non-localized build
  showed `dist/market-pulse/browser/index.html` today ships `<base href="/">`
  with relative asset URLs like `main-ZIPNFT4X.js`; once `pl` is added as a
  locale without an override, its `index.html` will ship `<base href="/pl/">`
  by the same mechanism the earlier research already confirmed for the
  physical output path.

  Phase 1's plan repoints `wrangler.toml`'s `[assets].directory` straight at
  `./dist/market-pulse/browser/pl` — so the site's URL root serves that
  folder's contents directly, with no `/pl/` prefix in the actual URL. But the
  shipped `index.html` still thinks its base is `/pl/`, so the browser will
  try to resolve `main-*.js`/`styles-*.css`/favicon against `/pl/main-*.js`
  etc. — paths that don't exist once `directory` already points at `.../pl`.
  **Every JS/CSS asset 404s in production.** Nothing in Phase 1's contract or
  success criteria overrides this, and Phase 1's own manual verification step
  (1.4) wouldn't catch it either, since at that point no locale content has
  been migrated yet and the check is described as "confirm the app renders
  exactly as today" without explicitly inspecting the served `<base href>`.
- **Fix**: Add an explicit `baseHref` override for the `pl` locale in
  `angular.json`'s `i18n.locales.pl` block (Angular's documented mechanism for
  this exact situation), then — following the same empirical-verification
  discipline this plan already used to confirm the nested-output claim —
  add a Phase 1 automated/manual check that builds once, inspects the actual
  served `index.html`'s `<base href>` value, and confirms it resolves to `/`
  (not `/pl/`) before Phase 1 is considered done. It's not yet 100% certain
  from static tracing alone whether overriding `baseHref` also changes the
  physical output directory (still nested under `browser/pl/`, matching
  `wrangler.toml`, or flattened back to `browser/` directly) — that should be
  confirmed by the same kind of real, reverted build experiment already used
  earlier in this plan's research, and `wrangler.toml`'s directory adjusted to
  match whatever is empirically observed.
- **Decision**: FIXED — added `"baseHref": ""` override to `angular.json`'s
  `i18n.locales.pl` block, marked `wrangler.toml`'s path as provisional pending
  the empirical check, and added automated checks 1.4 (base href resolves to
  `/`) and adjusted 1.3/1.5 in Phase 1's Success Criteria + Progress.

### F2 — Phase 1's `main.ts` contract doesn't match what `ng add @angular/localize` actually does for this builder

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — "Runtime polyfill entry point" (`src/main.ts`
  contract) and Critical Implementation Details ("`main.ts` import ordering")
- **Detail**: A sub-agent downloaded and inspected the actual `ng-add`
  schematic bundled with `@angular/localize@22.0.7`
  (`schematics/ng-add/ng_add_bundle.cjs`). For an `Application`/
  `BuildApplication` builder (which this project uses —
  `"builder": "@angular/build:application"` in `angular.json`), the schematic
  does **not** insert `import '@angular/localize/init';` into `main.ts`.
  Instead it inserts a `/// <reference types="@angular/localize" />`
  triple-slash comment into the file the `browser` option points to, and adds
  `"@angular/localize/init"` to that build target's `polyfills` array in
  `angular.json` — a file/field the plan never lists as changing at all. The
  `tsconfig.app.json` half of Phase 1's contract (`types` array) is confirmed
  correct — the same schematic does automate that part.

  The plan's Critical Implementation Details section also states the `main.ts`
  import "is Angular's own documented requirement for `ng add
  @angular/localize`" — that specific justification is incorrect for this
  builder type, even though the underlying idea (get `$localize` initialized
  before use) is sound.
- **Fix**: Correct Phase 1 item 2's contract to match the schematic's actual
  behavior: name `angular.json`'s `polyfills` array (for the relevant build
  target) as the file/field that changes, alongside whatever `ng add` does to
  `main.ts` (a triple-slash reference, not an import statement). Drop the
  incorrect "documented requirement" claim from Critical Implementation
  Details and replace it with a note that the exact mechanism depends on
  trusting `ng add`'s output rather than hand-writing the import.
  - Strength: Keeps the plan's contract accurate for whichever exact file
    changes the implementer will actually see after running the command,
    avoiding confusion mid-Phase-1.
  - Tradeoff: None significant — this is a documentation correction, not a
    behavior change; running `ng add @angular/localize` still fully resolves
    the underlying need either way.
  - Confidence: HIGH — based on direct inspection of the installed schematic's
    source matching the project's exact Angular/`@angular/localize` version.
  - Blind spot: Not independently re-verified in this pass beyond the
    sub-agent's inspection; low risk given the source was read directly rather
    than inferred from general Angular knowledge.
- **Decision**: FIXED — corrected Phase 1 item 2's contract to name
  `angular.json`'s `polyfills` array and the triple-slash reference in
  `main.ts` (trusting `ng add`'s actual output instead of hand-writing an
  import), and replaced the incorrect justification in Critical
  Implementation Details.
