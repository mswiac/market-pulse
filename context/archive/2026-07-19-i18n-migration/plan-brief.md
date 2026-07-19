# i18n Migration — Plan Brief

> Full plan: `context/changes/i18n-migration/plan.md`

## What & Why

Move every user-facing UI string out of raw source-code literals and onto
Angular's built-in i18n mechanism (`$localize` + XLIFF), so no Polish (or any
natural-language UI text) lives directly in `.html`/`.ts` source. The
motivation is a stated preference to keep source code free of embedded
Polish, not any current defect — the app works fine today, this is a
code-hygiene / architecture change.

## Starting Point

9 files carry the app's entire user-facing text (5 templates, 4 `.ts` files
with embedded messages) — confirmed complete by a full-repo sweep, no other
file has translatable text. `login`/`register` are currently English
(pre-dating the project's Polish-UI convention); `home`/`alert-list`/
`alert-form` are currently Polish, hardcoded. No tests exist anywhere in the
repo, so there's no test surface to update. No i18n code exists today — clean
slate.

## Desired End State

Every template/`.ts` file contains English source text tagged with `i18n`/
`$localize` ids; all actual Polish wording lives in
`src/locale/messages.pl.xlf`. Production builds always emit a single,
permanent Polish bundle. The app looks and reads exactly as it does today on
already-Polish screens, and login/register are now genuinely Polish instead
of English.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Mechanism | Angular built-in i18n (`$localize`+XLIFF), not ngx-translate or a custom dictionary | Zero runtime cost, no new dependency to maintain beyond Angular's own package |
| Deploy path reconciliation | Point `wrangler.toml`'s `[assets].directory` at `dist/market-pulse/browser/pl` | Angular's esbuild builder always nests localized output under `browser/<locale>/` — confirmed by a real, reverted build experiment — so the existing flat path can't work unmodified |
| Build/deploy cutover | Direct cutover of `npm run build`/`deploy`, no parallel script | Small solo project, no staging environment — a temporary parallel script just adds state to track |
| Missing-translation handling | `i18nMissingTranslation: "error"` | Build fails loudly rather than silently shipping stray English text to Polish users |
| GitHub issue #23 | Left untouched/separate, even though login/register get real Polish translations as a side effect | Explicit user call — this change's scope doesn't formally close it |
| Migration scope | All 9 files in one change | Small, fully-catalogued surface area (~53 ids); splitting adds coordination cost without benefit at this size |
| Dev-time preview | Accept English during `npm start`; no dedicated `pl` serve config | Cut first if this change needs to shrink — Polish is only checked via production builds |
| Non-regression bar (already-Polish screens) | Byte-identical Polish output vs. today | Keeps the migration purely mechanical and trivially diffable; wording polish is a separate, later concern |
| Proper nouns / tickers | `VIX`, `NASDAQ-100`, `RSI` stay plain literals, no `i18n` markup | They're identical in both locales — marking them adds XLIFF noise with no translation value |

## Scope

**In scope:** all 9 files' user-facing strings, `angular.json`/`tsconfig.app.json`/
`main.ts`/`package.json` i18n wiring, `wrangler.toml` deploy-path fix, the
`messages.xlf`/`messages.pl.xlf` translation files.

**Out of scope:** multi-locale runtime switching, GitHub issue #23's tracking
state, a dev-server Polish-preview configuration, translating proper nouns/
tickers or the `<title>` brand name, any new test files.

## Architecture / Approach

Angular's compiler statically inlines `$localize`-tagged text at build time
per configured locale — there is no runtime translation lookup. `angular.json`
gets a project-level `i18n` block (`sourceLocale: en-US`, one target locale
`pl`) and the `production` build configuration is extended with `"localize":
["pl"]` + `"i18nMissingTranslation": "error"`, so `npm run build` always
produces exactly one, Polish, production bundle at
`dist/market-pulse/browser/pl/`. `wrangler.toml`'s asset binding points there.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Infrastructure & deploy config | `@angular/localize` installed, `angular.json`/`main.ts`/`tsconfig` wired, `wrangler.toml` repointed — no content changes yet | Getting the nested output path wrong would silently break the deployed site |
| 2. Content migration | All 9 files annotated, `messages.xlf` extracted, `messages.pl.xlf` authored | The `VIX_RSI_ERROR` sentinel constant in `alert-form.ts` must NOT be wrapped — doing so would break backend-error-matching logic |
| 3. Deploy verification | Confirmed SPA routing on the new path + real production deploy | SPA fallback (`not_found_handling`) behavior on the new nested directory is unverified until this phase |

**Prerequisites:** none — no external dependencies or access needed beyond
what's already in the repo.
**Estimated effort:** ~1 session across 3 phases; small, fully-scoped file set
(9 source files + 4 config files + 2 generated/authored XLIFF files).

## Open Risks & Assumptions

- Assumes `ng add @angular/localize` behaves as documented for Angular 22 —
  Phase 1's automated checks catch it immediately if not.
- Assumes no other hidden user-facing strings exist beyond the 9-file surface
  — verified by a full-repo sweep during planning, but worth a final
  `grep -rn "[ąćęłńóśźż...]"` sweep at the end of Phase 2 regardless (already
  in that phase's automated checks).

## Success Criteria (Summary)

- `grep` for Polish characters across `src/app/**/*.{html,ts}` returns nothing.
- The live production app renders in Polish, with home/alert-list/alert-form
  wording unchanged from today and login/register newly translated.
- `npm run deploy` continues to work as a single command, unchanged in its
  own definition.
