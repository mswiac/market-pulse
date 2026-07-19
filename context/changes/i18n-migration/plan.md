# i18n Migration Implementation Plan

## Overview

Move every user-facing UI string in the Angular frontend out of raw source-code
literals and onto Angular's built-in i18n mechanism (`$localize` + XLIFF). After
this change, `.html` templates and `.ts` files contain only English source text
tagged with `i18n`/`$localize`; the actual Polish wording the app's users see
lives entirely in `src/locale/messages.pl.xlf`. Production builds compile a
single, permanent `pl`-localized bundle — this is not a multi-locale switcher,
the app has exactly one shipped language.

## Current State Analysis

- 9 source files carry the app's entire user-facing text surface: 5 templates
  (`login.html`, `register.html`, `home.html`, `alert-list.html`,
  `alert-form.html`) and 4 `.ts` files with embedded literal messages
  (`login.ts`, `register.ts`, `alert-list.ts`, `alert-form.ts`). Confirmed by a
  full repo sweep — no other `.ts`/`.html` file contains user-facing text, no
  `aria-label`/`title`/`alt`/`placeholder` attributes exist anywhere, and there
  is no `MatSnackBar`/`alert()`/`confirm()` usage.
- `login.html`/`login.ts` and `register.html`/`register.ts` are currently
  **English** (predating the project's Polish-UI convention; tracked separately
  by GitHub issue #23). `home.html`, `alert-list.html`/`.ts`, and
  `alert-form.html`/`.ts` are currently **Polish**, written directly in source.
- No `.spec.ts` (Karma) files and no Playwright/e2e test files exist anywhere in
  the repo (`skipTests: true` is set globally per `CLAUDE.md`) — there is zero
  test surface that this migration could break.
- No i18n-related code exists today: no `$localize`, no `ngx-translate`, no
  `LOCALE_ID`/`registerLocaleData`, no `@angular/localize` dependency. Clean
  slate.
- The frontend is deployed as a **single Cloudflare Worker** (not the separate
  "Cloudflare Pages" product `CLAUDE.md`'s architecture section describes) —
  `wrangler.toml`'s `[assets]` block points its `directory` at
  `./dist/market-pulse/browser`, and `npm run deploy` is just `ng build &&
  wrangler deploy`.
- The build uses the modern esbuild-based `@angular/build:application` builder
  (Angular 22). This matters because its i18n output-path behavior differs from
  the legacy webpack builder and had to be verified empirically (see Key
  Discoveries).

### Key Discoveries

- **Localized builds are always nested under `browser/<locale>/`, never flat,
  and this cannot be changed via `angular.json`.** Confirmed by tracing
  `node_modules/@angular/build/src/builders/application/i18n.js` and
  `.../options.js`, then verified with a real, reverted `ng build --localize`
  run: output was `dist/market-pulse/browser/pl/index.html`, with **no**
  `index.html` remaining at `dist/market-pulse/browser/` root. The only thing
  that flattens output (`forceI18nFlatOutput`) is an internal flag not exposed
  in `angular.json`'s schema — it's set automatically only by the dev server.
  This means `wrangler.toml` **must** change once localization is enabled, or
  the deployed Worker will serve nothing (Phase 1, file 5).
- **`ng build --localize=pl` (the ad-hoc CLI flag) silently fails to localize**
  — it produces a flat, untranslated `en-US` build with no warning. Only a
  proper `angular.json` build configuration with `"localize": ["pl"]` produces
  correct output. See Critical Implementation Details.
- **The dev server (`ng serve`/`npm start`) does not localize by default** — it
  renders the raw English source text. Confirmed via
  `node_modules/@angular/build/src/builders/dev-server/vite/index.js`: the dev
  server supports localizing only if a serve configuration's build target
  resolves to exactly one configured locale; with 0 or 2+ locales it disables
  localization outright and warns. Per the phasing decision below, this project
  is accepting English during `npm start` rather than wiring up a dedicated
  preview configuration.
- **`alert-form.ts:12`'s `VIX_RSI_ERROR` constant is not a UI string** — it's a
  sentinel compared against the backend's raw HTTP error body
  (`serverError === VIX_RSI_ERROR`, `alert-form.ts:103`). It must be left as a
  plain, untouched English literal. Wrapping it in `$localize` would make the
  build inline it to the *Polish* translation (since `pl` is the only build
  locale), permanently breaking the comparison against the backend's
  always-English error text and silently falling through to the generic error
  message. See Critical Implementation Details.
- **A locale's `subPath` also becomes its `<base href>`, and this needs an
  explicit override.** Found during plan review by tracing
  `node_modules/@angular/build/src/utils/i18n-options.js` and
  `.../builders/application/options.js` (`getLocaleBaseHref`), then confirmed
  against a real (non-localized) build showing today's
  `dist/market-pulse/browser/index.html` ships `<base href="/">` with
  relative asset URLs. Without an override, the `pl` locale's `index.html`
  would ship `<base href="/pl/">` by the same default-to-locale-code
  mechanism that drives the nested output path above — but `wrangler.toml`
  (Phase 1, file 4) serves `.../browser/pl` at the URL root with **no** `/pl/`
  prefix, so every JS/CSS asset reference would 404 in production. Phase 1
  now includes an explicit `baseHref` override and an empirical check for
  this (Changes Required #3, Success Criteria).

## Desired End State

- Every template and `.ts` file in the 9-file surface area contains English
  source text only, each translatable unit marked with a custom `i18n="@@id"`
  attribute (templates) or a `$localize` tagged template (`.ts` literals).
- `src/locale/messages.xlf` (extracted, source-of-truth structure) and
  `src/locale/messages.pl.xlf` (hand-authored Polish translations) exist and
  are complete — every extracted id has a corresponding Polish `<target>`.
- `npm run build` (production) always produces a Polish-localized bundle at
  `dist/market-pulse/browser/pl/`; `wrangler.toml` points there; `npm run
  deploy` ships that bundle unchanged in its existing single command.
- The rendered app is visually and textually **identical** to today on the
  screens that are already Polish (home, alert list, alert form) and now
  genuinely **Polish** (not English) on login/register.
- Verification: `grep -rn "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" src/app --include=*.html
  --include=*.ts` (excluding `src/locale/`) returns nothing — no Polish
  character survives in application source.

## What We're NOT Doing

- Not building multi-locale runtime switching. `pl` is the only shipped locale;
  `en-US` (the source locale) is never built or served in production.
- Not closing or superseding GitHub issue #23. Login/register end up with real
  Polish translations as a side effect of this migration, but per an explicit
  decision this change does not touch or reference #23's tracking state —
  that's left to the user to reconcile separately.
- Not adding a dedicated dev-server locale-preview configuration (e.g. `ng
  serve --configuration=pl-only`). `npm start` will show English source text;
  Polish is only visible in a production-configuration build. Flagged as the
  first thing to cut if this change needs to shrink.
- Not marking proper nouns/tickers (`VIX`, `NASDAQ-100`, the `RSI` alert-type
  option) with `i18n` — they're identical in both locales and stay plain
  literals.
- Not touching `src/index.html`'s `<title>MarketPulse</title>` — a brand name,
  not translatable content.
- Not adding any test files — none exist today and none of the automated or
  manual verification below requires creating any.
- Not splitting this into multiple changes or landing it incrementally across
  several PRs — all 9 files migrate together in this one change.
- Not adding a parallel `build:localize` script alongside the existing `build`
  — `npm run build`/`npm run deploy` are cut over directly to the localized
  output in Phase 1.

## Implementation Approach

Three phases, each leaving the app in a deployable state:

1. **Infrastructure** — install `@angular/localize`, wire the `i18n` block and
   localize/missing-translation settings into `angular.json`, and repoint
   `wrangler.toml` at the new nested output path. No template content changes
   yet, so a deploy at the end of this phase would ship the exact same text as
   today, just through the new (now-nested) build path — safe, reversible via
   `git revert` if the deploy step misbehaves.
2. **Content migration** — annotate all 9 files with `i18n`/`$localize`,
   extract the real message set, and hand-author `messages.pl.xlf` so every
   already-Polish screen renders byte-identical output and login/register
   render new, real Polish translations.
3. **Deploy verification** — confirm the new asset path serves correctly
   (including SPA fallback routing) before and via the real `npm run deploy`.

## Critical Implementation Details

- **`VIX_RSI_ERROR` exclusion (`alert-form.ts:12`)**: this constant is compared
  byte-for-byte against the Worker backend's raw error response
  (`alert-form.ts:103`) and must never be wrapped in `$localize` or given an
  `i18n` id. Only the *displayed* message on the next line
  (`alert-form.ts:104`, `'RSI nie jest dostępne dla VIX.'`) is real UI text and
  gets migrated normally. The two strings look similar but serve entirely
  different purposes — do not consolidate them into one id.
- **`ng add @angular/localize`'s actual effect on `main.ts`/`angular.json`
  (corrected during plan review)**: for this project's esbuild
  `@angular/build:application` builder, `ng add @angular/localize` does NOT
  insert an `import '@angular/localize/init';` line into `main.ts` — that's
  the legacy webpack-builder behavior. Instead it adds a triple-slash type
  reference to `main.ts` and registers `"@angular/localize/init"` in the
  `browser` target's `polyfills` array in `angular.json`, which is what
  actually initializes the runtime polyfill before any `$localize`-tagged
  code executes. Confirmed by reading
  `node_modules/@angular/localize/schematics/ng-add/ng_add_bundle.cjs`
  directly. Run the schematic and trust its output; don't hand-write an
  import on top of it.
- **Never invoke `ng build --localize=pl` directly.** That ad-hoc flag silently
  produces an untranslated, flat `en-US` build with no error. Localization must
  come from the `angular.json` build configuration's `"localize": ["pl"]`
  array, which `npm run build` already resolves to by default once Phase 1
  lands — there should be no reason to pass `--localize` on the command line at
  all after this change.

## Phase 1: i18n Infrastructure & Deploy Config

### Overview

Install and wire Angular's i18n tooling and reconcile the Cloudflare Worker
deploy config with the new nested build output — without touching any UI
content yet.

### Changes Required:

#### 1. Package and TypeScript config

**Files**: `package.json`, `tsconfig.app.json`

**Intent**: install `@angular/localize` (via `ng add @angular/localize`) so
`$localize` and the XLIFF extraction/build tooling are available, and type the
global `$localize` function for `.ts` files.

**Contract**: `package.json` dependencies gain `@angular/localize` at a version
matching the installed Angular 22 line; `tsconfig.app.json`'s
`compilerOptions.types` includes `"@angular/localize"`. Also add a convenience
script: `"extract-i18n": "ng extract-i18n --output-path src/locale"`.

#### 2. Runtime polyfill entry point

**Files**: `src/main.ts`, `angular.json`

**Intent**: initialize the `$localize` global at runtime, required for any
`$localize`-tagged code to resolve correctly outside of build-time inlining
(e.g. during `ng serve`).

**Contract**: run `ng add @angular/localize` and trust its output rather than
hand-writing an import — for this project's `@angular/build:application`
builder, the schematic inserts a `/// <reference types="@angular/localize" />`
triple-slash comment at the top of `main.ts` (not an `import` statement) and
adds `"@angular/localize/init"` to the `browser` build target's `polyfills`
array in `angular.json`. Confirmed by reading the installed
`@angular/localize` package's `ng-add` schematic source directly (see
Critical Implementation Details) — don't manually add an `init` import to
`main.ts` on top of what the schematic produces.

#### 3. Angular i18n & build configuration

**File**: `angular.json`

**Intent**: declare the source locale and the one Polish target locale, and
make every production build compile only the `pl`-localized bundle, failing
loudly rather than silently shipping English text if a translation is missing.

**Contract**: add a project-level block:
```
"i18n": {
  "sourceLocale": "en-US",
  "locales": {
    "pl": {
      "translation": "src/locale/messages.pl.xlf",
      "baseHref": ""
    }
  }
}
```
and extend `architect.build.configurations.production` with `"localize":
["pl"]` and `"i18nMissingTranslation": "error"`. `defaultConfiguration` stays
`"production"` and the `development` configuration is untouched (per the
decision to accept English during `npm start`) — no new build or serve
configuration is added.

The `"baseHref": ""` override is required (added during plan review): without
it, Angular defaults the `pl` locale's `<base href>` to `/pl/`, which breaks
every asset reference once `wrangler.toml` serves `.../browser/pl` at the URL
root with no `/pl/` prefix (see Key Discoveries). Confirm empirically after
this phase's build (Success Criteria below) that the served `index.html`
actually resolves to `<base href="/">` — and check whether the override also
changes the physical output path (still nested under `browser/pl/`, or
flattened); adjust file 4's `wrangler.toml` path if the latter.

#### 4. Cloudflare Worker asset path

**File**: `wrangler.toml`

**Intent**: point the Worker's static-assets binding at the one path a
`"localize": ["pl"]` production build actually produces, since
`dist/market-pulse/browser/` no longer has a root `index.html` once
localization is active (see Key Discoveries).

**Contract**: `[assets].directory` changes from `"./dist/market-pulse/browser"`
to `"./dist/market-pulse/browser/pl"`. `binding` and `not_found_handling`
(SPA fallback) stay unchanged. **This path is provisional** — confirm it
against the actual build output in this phase's Success Criteria below; if the
`baseHref` override in file 3 also flattens the physical output, point this at
`"./dist/market-pulse/browser"` instead (unchanged from today) and drop the
nested-path assumption.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npx ng extract-i18n --output-path src/locale` exits 0 and produces
  `src/locale/messages.xlf` (near-empty at this point — no content is
  annotated yet, this only proves the i18n config parses)
- `npm run build` exits 0 and produces a built `index.html` for the `pl`
  locale (path depends on whether `baseHref: ""` also flattens output — locate
  it with `find dist/market-pulse -name index.html`)
- The built `index.html`'s `<base href>` resolves to `"/"`, not `"/pl/"` (e.g.
  `grep -o '<base href="[^"]*"' <the located index.html>`) — this is the
  concrete check for the base-href gap found during plan review

#### Manual Verification:

- Serve the built `pl` output locally (e.g. a static file server, from
  whichever directory the automated check above located) and confirm the app
  loads and renders exactly as it does today (content is unchanged at this
  point — only the build path/config moved)

---

## Phase 2: Content Migration

### Overview

Annotate every user-facing string across the 9-file surface with
`i18n`/`$localize`, extract the full message set, and author the Polish
translation file.

### Changes Required:

#### 1. Login screen

**Files**: `src/app/features/auth/login/login.html`,
`src/app/features/auth/login/login.ts`

**Intent**: mark every user-facing string with a custom, hierarchical id;
existing English wording becomes the extracted source text.

**Contract**: template text stays English; each translatable element/literal
gets an id under the `login.*` namespace:

| id | English source | Polish target |
|---|---|---|
| `login.title` | Log in | Zaloguj się |
| `login.email.label` | Email | Email |
| `login.email.errorRequired` | Email is required. | Email jest wymagany. |
| `login.email.errorInvalid` | Enter a valid email address. | Podaj prawidłowy adres e-mail. |
| `login.password.label` | Password | Hasło |
| `login.password.errorRequired` | Password is required. | Hasło jest wymagane. |
| `login.submit` | Log in | Zaloguj się |
| `login.footer.prompt` | Need an account? | Nie masz konta? |
| `login.footer.link` | Register | Zarejestruj się |
| `login.errorInvalidCredentials` (`.ts:40`) | Invalid email or password. | Nieprawidłowy e-mail lub hasło. |

#### 2. Register screen

**Files**: `src/app/features/auth/register/register.html`,
`src/app/features/auth/register/register.ts`

**Intent**: same shape as login.

**Contract**: ids under `register.*`:

| id | English source | Polish target |
|---|---|---|
| `register.title` | Create your account | Utwórz konto |
| `register.email.label` | Email | Email |
| `register.email.errorRequired` | Email is required. | Email jest wymagany. |
| `register.email.errorInvalid` | Enter a valid email address. | Podaj prawidłowy adres e-mail. |
| `register.password.label` | Password | Hasło |
| `register.password.errorRequired` | Password is required. | Hasło jest wymagane. |
| `register.password.errorMinlength` | Password must be at least 8 characters. | Hasło musi mieć co najmniej 8 znaków. |
| `register.submit` | Register | Zarejestruj się |
| `register.footer.prompt` | Already have an account? | Masz już konto? |
| `register.footer.link` | Log in | Zaloguj się |
| `register.errorEmailTaken` (`.ts:42`) | This email is already registered. | Ten adres e-mail jest już zarejestrowany. |
| `register.errorGeneric` (`.ts:44`) | Something went wrong. Please try again. | Coś poszło nie tak. Spróbuj ponownie. |

Note: `register.html:16-18`'s `{{ emailError() }}` interpolation stays as-is —
its source strings are handled entirely in `register.ts`.

#### 3. Home screen

**File**: `src/app/features/home/home.html`

**Intent**: convert today's Polish source text to English source + `i18n` ids;
the Polish target must render byte-identical to today's output.

**Contract**: ids under `home.*`. `"MarketPulse"` (the brand span) and the
dynamic `{{ currentUser.email }}`/`{{ currentUser.email }}` interpolations stay
untouched.

| id | English source (new) | Polish target (byte-identical to today) |
|---|---|---|
| `home.logout` | Log out | Wyloguj |
| `home.welcomeTitle` | Welcome back | Witaj ponownie |
| `home.loggedInAs` | Logged in as: | Zalogowano jako: |
| `home.alertsSectionTitle` | Your alerts | Twoje alerty |
| `home.newAlertFab` | New alert | Nowy alert |

#### 4. Alert list

**Files**: `src/app/features/alerts/alert-list/alert-list.html`,
`src/app/features/alerts/alert-list/alert-list.ts`

**Intent**: same byte-identical-target bar as home. `INSTRUMENT_LABELS`'s
values (`VIX`, `NASDAQ-100`) stay untouched plain literals (proper nouns);
`ALERT_TYPE_LABELS`'s values are real phrases and get `$localize`-wrapped.

**Contract**: ids under `alertList.*`. `alertList.detail.noData` is reused for
both occurrences of "Brak danych" (`alert-list.html:39,41`) — same phrase, same
id, no duplication.

| id | English source (new) | Polish target (byte-identical to today) |
|---|---|---|
| `alertList.sort.instrument` | Instrument | Walor |
| `alertList.sort.alertType` | Alert type | Typ alertu |
| `alertList.sort.threshold` | Threshold | Próg |
| `alertList.detail.currentPrice` | Current price: | Aktualna cena: |
| `alertList.detail.currentRsi` | Current RSI: | Aktualne RSI: |
| `alertList.detail.notificationEmail` | Notification email: | E-mail powiadomień: |
| `alertList.detail.lastEdited` | Last edited: | Ostatnia edycja: |
| `alertList.loadError` | Failed to load alerts. | Nie udało się wczytać alertów. |
| `alertList.detail.noData` | No data | Brak danych |
| `alertList.emptyState` | No alerts yet — add your first one to get started. | Brak alertów — dodaj pierwszy, aby zacząć. |
| `alertList.type.price` (`.ts`, `ALERT_TYPE_LABELS.PRICE`) | Price threshold | Próg cenowy |
| `alertList.type.rsi` (`.ts`, `ALERT_TYPE_LABELS.RSI`) | RSI threshold | Próg RSI |

#### 5. Alert form

**Files**: `src/app/features/alerts/alert-form/alert-form.html`,
`src/app/features/alerts/alert-form/alert-form.ts`

**Intent**: same byte-identical-target bar. The `RSI` `mat-option` value
(`alert-form.html:18`) and the `VIX`/`NASDAQ-100` `mat-option` values
(`alert-form.html:8-9`) stay untouched plain literals. `VIX_RSI_ERROR`
(`.ts:12`) is explicitly excluded — see Critical Implementation Details.

**Contract**: ids under `alertForm.*`. `alertForm.threshold.errorRequired` is
reused for both "Field required." occurrences (`alert-form.html:27,39`) — same
phrase, same id.

| id | English source (new) | Polish target (byte-identical to today) |
|---|---|---|
| `alertForm.title` | New alert | Nowy alert |
| `alertForm.instrument.label` | Instrument | Instrument |
| `alertForm.alertType.label` | Alert type | Typ alertu |
| `alertForm.alertType.price` | Price | Cena |
| `alertForm.threshold.label` | Threshold | Próg |
| `alertForm.threshold.errorRequired` | Field required. | Pole wymagane. |
| `alertForm.threshold.errorRange` | Value must be between 0 and 100. | Wartość musi mieścić się w zakresie 0–100. |
| `alertForm.threshold.errorPositive` | Value must be greater than 0. | Wartość musi być większa od 0. |
| `alertForm.notificationEmail.label` | Notification email | E-mail do powiadomień |
| `alertForm.notificationEmail.errorInvalid` | Enter a valid email address. | Wprowadź prawidłowy adres e-mail. |
| `alertForm.cancel` | Cancel | Anuluj |
| `alertForm.submit` | Create alert | Utwórz alert |
| `alertForm.error.duplicateAlert` (`.ts:100`) | An alert like this already exists. | Taki alert już istnieje. |
| `alertForm.error.rsiUnavailableForVix` (`.ts:104`) | RSI is not available for VIX. | RSI nie jest dostępne dla VIX. |
| `alertForm.error.generic` (`.ts:107`) | Something went wrong. Please try again. | Wystąpił błąd. Spróbuj ponownie. |

#### 6. Extracted message files

**Files**: `src/locale/messages.xlf` (generated), `src/locale/messages.pl.xlf`
(hand-authored)

**Intent**: regenerate the source XLIFF from the now-annotated templates/`.ts`
files, then author the Polish translation file with one `<target>` per
extracted `<trans-unit>`, using the tables above.

**Contract**: `messages.xlf` is produced by `ng extract-i18n` and should not be
hand-edited beyond what extraction produces. `messages.pl.xlf` mirrors its
`trans-unit id`s exactly (all ~53 ids across the five tables above) with the
Polish text from the "Polish target" column as each `<target>`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npx ng extract-i18n --output-path src/locale` exits 0 and `messages.xlf`
  contains every id listed in the tables above (spot-checked via `grep`)
- `npm run build` exits 0 with `i18nMissingTranslation: "error"` active (this
  fails the build if any id from `messages.xlf` has no matching translation in
  `messages.pl.xlf` — a real, load-bearing check, not just a smoke test)
- `grep -rn "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" src/app --include=*.html --include=*.ts`
  returns no matches (no Polish characters survive outside `src/locale/`)

#### Manual Verification:

- Serve the built `dist/market-pulse/browser/pl/` locally and click through
  every screen (login, register, home, alert list — including expanding a
  VIX price alert and a NASDAQ-100 RSI alert to see both detail-panel
  variants, alert form — including both PRICE and RSI alert types and at
  least one validation error per field)
- Confirm home/alert-list/alert-form render **exactly** the same Polish
  wording as before this change (side-by-side with a pre-migration screenshot
  or the current `main` branch)
- Confirm login/register now render in Polish (not English)

---

## Phase 3: Deploy Verification

### Overview

Confirm the new asset path serves correctly — including SPA fallback routing —
before and via a real production deploy.

### Changes Required:

No further source changes. This phase is verification-only.

### Success Criteria:

#### Automated Verification:

- `npm run build` exits 0 (final confirmation with all content migrated)
- `npm run deploy` (`ng build && wrangler deploy`) exits 0

#### Manual Verification:

- Locally verify SPA fallback routing against the new nested asset directory
  (e.g. `wrangler dev --local` or equivalent), confirming a deep-link/refresh
  on a non-root route still resolves to `index.html` rather than 404ing
- After the real deploy, spot-check the live production URL: app loads in
  Polish, login/register/home/alert-list/alert-form all render correctly, and
  refreshing on a non-root route doesn't break

---

## Testing Strategy

### Unit Tests:

None — no `.spec.ts` files exist in this repo (`skipTests: true` globally) and
this migration doesn't introduce any new logic that would warrant an
exception.

### Integration Tests:

None — no Playwright/e2e suite exists in this repo today.

### Manual Testing Steps:

1. Phase 1: confirm the infra-only localized build serves the unchanged app.
2. Phase 2: click through every screen and alert-type/error-state combination,
   confirming byte-identical Polish on previously-Polish screens and new
   Polish on login/register.
3. Phase 3: confirm SPA routing survives on the new asset path, then verify
   the real production deploy.

## Performance Considerations

None expected. This is a build-time-only transform on a statically-served
frontend (see the change's `Notes` in `change.md` for the earlier discussion
confirming zero impact on the Cloudflare Workers CPU budget, which applies only
to the Hono backend/cron, not static asset serving).

## Migration Notes

No data migration involved — this only touches frontend source, build config,
and the Worker's static-assets path.

## References

- Change notes: `context/changes/i18n-migration/change.md`
- `alert-form.ts:12,103-104` — the `VIX_RSI_ERROR` sentinel exclusion (see
  Critical Implementation Details)
- `node_modules/@angular/build/src/builders/application/i18n.js`,
  `.../options.js`, `.../dev-server/vite/index.js` — traced during planning to
  confirm the nested-output and dev-server-locale behavior described in Key
  Discoveries

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: i18n Infrastructure & Deploy Config

#### Automated

- [x] 1.1 `npm run typecheck` passes — 63dd425
- [x] 1.2 `npx ng extract-i18n --output-path src/locale` exits 0 and produces `src/locale/messages.xlf` — 63dd425
- [x] 1.3 `npm run build` exits 0 and produces a built `index.html` for the `pl` locale — 63dd425
- [x] 1.4 The built `index.html`'s `<base href>` resolves to `"/"`, not `"/pl/"` — 63dd425

#### Manual

- [ ] 1.5 Serve the built `pl` output locally and confirm the app renders exactly as today

### Phase 2: Content Migration

#### Automated

- [x] 2.1 `npm run typecheck` passes
- [x] 2.2 `npx ng extract-i18n --output-path src/locale` exits 0 and `messages.xlf` contains every planned id
- [x] 2.3 `npm run build` exits 0 with `i18nMissingTranslation: "error"` active
- [x] 2.4 `grep -rn "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" src/app --include=*.html --include=*.ts` returns no matches

#### Manual

- [ ] 2.5 Click through every screen and alert-type/error-state combination on the built `pl` bundle
- [ ] 2.6 Confirm home/alert-list/alert-form render byte-identical Polish wording vs. before this change
- [ ] 2.7 Confirm login/register now render in Polish

### Phase 3: Deploy Verification

#### Automated

- [ ] 3.1 `npm run build` exits 0
- [ ] 3.2 `npm run deploy` exits 0

#### Manual

- [ ] 3.3 Locally verify SPA fallback routing against the new nested asset directory
- [ ] 3.4 Spot-check the live production URL after deploy
