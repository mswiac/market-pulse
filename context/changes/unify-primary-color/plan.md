# Unify primary color (toolbar, FAB, active nav link) Implementation Plan

## Overview

Three UI surfaces render a different blue than the app's buttons even though they're meant to look like one brand color: the top toolbar, the "+ New alert" FAB, and the active sidebar nav link. This plan makes those three match the buttons' vivid `--mat-sys-primary` tone, while explicitly leaving table/list headers on their current lighter tone. It also bundles two small, unrelated fixes the user asked to land in the same change: a missing space in the home page greeting, and a clearer label on the admin sidebar link.

## Current State Analysis

Angular Material 3 theming (`src/styles.scss`, `mat.theme((color: (primary: mat.$azure-palette, ...))`) drives all `--mat-sys-*` CSS custom properties used across the app. Inspecting the installed `@angular/material` package (`node_modules/@angular/material/{toolbar,button}/*-theme.scss`) shows the mechanism behind the inconsistency:

- Every legacy `color="primary"` input (`mat-toolbar`, `mat-flat-button`, `matFab`, ...) compiles a `.mat-primary` CSS class override, but that override is only emitted `@if inspection.get-theme-version($theme) != 1` — i.e. **only for Material 2 theming**. Under M3 (`mat.theme()`, version 1), the `.mat-primary` block is skipped entirely, so `color="primary"` is dead code on every component.
- `mat-flat-button`/`mat-fab` still theme correctly or incorrectly depending on their *own* M3 default token, independent of the `color` attribute:
  - Filled/unelevated buttons (`_m3-button.scss`): `button-filled-container-color: map.get($system, primary)` — default already IS primary, so admin/login/register/alert-form buttons look right by coincidence.
  - FAB (`_m3-fab.scss`): `fab-container-color: map.get($system, primary-container)` — a lighter/pastel token, distinct from `primary`. This is why "+ New alert" (`home.html:19`) currently reads close to the muted `secondary-container` tone used on table headers, not the vivid blue of the other buttons.
  - Toolbar (`_toolbar-theme.scss`) has no M3 default color token tied to "primary" at all — it falls back to base/surface tones, which is why it looks muted/different (`shell.html:1`).
- `.active-link` (`shell.scss:38-41`) uses `--mat-sys-secondary-container`/`--mat-sys-on-secondary-container` — a token unrelated to the primary palette, applied when `routerLinkActive` matches (`shell.html`).
- Table/list headers (`instrument-history.scss:45-51`, `trigger-history.scss:34-40`) and the alert-list accordion header (`alert-list.scss:20-22`) also use `--mat-sys-secondary-container`. These are explicitly staying as-is (see "What We're NOT Doing") — decided during planning that large flat data-display surfaces read better with a lighter tone, and only navigational/CTA elements need to visually match the buttons.
- `home.html:8` greeting — `<span i18n="@@home.loggedInAs">Logged in as:</span> <strong>{{ currentUser.email }}</strong>.` — renders with no visible space between the label and the email in the browser, despite a literal space character in the template source between the two elements.
- `shell.html:67` — the admin sidebar link uses `i18n="@@shell.nav.adminMarketData"` with text "Market data" (EN) / "Dane giełdowe" (PL). Since it's an action link (opens a form to fetch data), not a data view, the label reads better as "Fetch market data" / "Pobierz dane giełdowe" — matching the phrasing already used on the panel's own submit button (`adminPanel.submit`, which already says "Fetch market data" / "Pobierz dane giełdowe").

### Key Discoveries:

- `node_modules/@angular/material/toolbar/_toolbar-theme.scss:32-49` and `node_modules/@angular/material/button/_fab-theme.scss:32-49` — both confirm the `.mat-primary` override is M3-theme-version-gated and inert in this app.
- `node_modules/@angular/material/button/_m3-fab.scss:27` — `fab-container-color: map.get($system, primary-container)` is the FAB's true M3 default, explaining the visual mismatch the user spotted.
- `node_modules/@angular/material/button/_m3-button.scss:54` — `button-filled-container-color: map.get($system, primary)` is why flat buttons already look correct without the (inert) `color="primary"` attribute doing anything.

## Desired End State

Toolbar background, "+ New alert" FAB background, and the active sidebar nav link all render `--mat-sys-primary`/`--mat-sys-on-primary` — visually identical to the existing buttons (admin panel, login, register, alert-form). Table/list headers and the alert-list accordion header are visually unchanged. The home page greeting shows a visible space between "Logged in as:" and the email. The admin sidebar link reads "Fetch market data" / "Pobierz dane giełdowe".

Verification: `npm run ci` passes (typecheck + build, including strict i18n translation checking), and manual visual comparison in the browser confirms all four primary-colored surfaces (toolbar, FAB, active link, existing buttons) look the same shade.

## Critical Implementation Details

**MDC internal color tokens, not inheritance.** Angular Material's MDC-based components (`mat-button`, `matFab`) paint from their own internal CSS custom properties, not from an inherited ancestor `color`. Confirmed in the installed `@angular/material` source: plain `mat-button` (the toolbar's "Log out" button) has `button-text-label-text-color: primary` hardcoded regardless of its container's color (`_m3-button.scss:109`) — so once the toolbar background becomes `--mat-sys-primary`, that same-colored label text would go invisible unless explicitly overridden too. Likewise `matFab`'s icon/label color comes from its own `fab-foreground-color`/`fab-state-layer-color` tokens (default `on-primary-container`, `_m3-fab.scss:41,67`), so a plain `color:` rule on `.new-alert-fab` is not guaranteed to reach the icon/label. Phase 1 must identify the actual CSS custom property names via browser devtools (inspect computed styles on `.mdc-text-button__label` inside the toolbar, and on `.mdc-fab__icon` / `.mdc-fab-extended__label`) and override those directly, rather than relying on `background-color`/`color` alone. `.active-link` is unaffected — it targets a plain `<a mat-list-item>`, not an MDC color-token-driven element, and its existing background-color override already works without this treatment.

## What We're NOT Doing

- Not touching table/list headers (`instrument-history.scss`, `trigger-history.scss`) or the alert-list accordion header background (`alert-list.scss`) — these intentionally keep `--mat-sys-secondary-container`.
- Not touching the alert-list accordion's `.inactive` state (`alert-list.scss:24-27`) — that's a business-semantic "disabled alert" indicator, unrelated to this color-consistency fix.
- Not adding automated contrast/WCAG tooling — relying on M3's paired `primary`/`on-primary` tokens, which are designed to already meet contrast requirements, plus a manual visual check.
- Not adding dark mode support — the app hardcodes `color-scheme: light` (`src/styles.scss:18`); out of scope here.
- Not changing `sort-col:hover` in `alert-list.scss:58` — it already correctly uses `--mat-sys-primary`.

## Implementation Approach

Same fix pattern for all three "M3 legacy `color` input is dead" cases (toolbar, FAB): drop the now-inert `color="primary"` attribute from the template and add an explicit CSS rule in the component's `.scss` targeting `--mat-sys-primary`/`--mat-sys-on-primary` directly. The active-link and admin-nav-label changes are simple token/text substitutions. The greeting-spacing fix replaces the literal space text node with `&nbsp;`, which Angular's whitespace-collapsing does not treat as removable (unlike a plain space character), guaranteeing the space survives regardless of the exact rendering cause.

## Phase 1: Unify primary color + bundled small fixes

### Overview

Single phase — all changes are independent, low-risk CSS/HTML/i18n edits across 4 files with no ordering dependencies between them.

### Changes Required:

#### 1. Toolbar primary color

**File**: `src/app/core/shell/shell.html`

**Intent**: Remove the inert `color="primary"` attribute since it has no effect under M3 theming.

**Contract**: `<mat-toolbar color="primary">` → `<mat-toolbar>`.

**File**: `src/app/core/shell/shell.scss`

**Intent**: Add explicit primary-color styling so the toolbar matches the buttons' vivid blue, including the nested "Log out" button — see "Critical Implementation Details" for why the button needs its own explicit override, not just the toolbar background.

**Contract**: Set the toolbar's own background/text to `--mat-sys-primary`/`--mat-sys-on-primary`. Additionally, scoped to this toolbar only, override the nested `mat-button`'s internal label-color custom property (confirm the exact variable via devtools on `.mdc-text-button__label`, e.g. `--mdc-text-button-label-text-color`) to `--mat-sys-on-primary`, so "Log out" stays readable against the new background.

#### 2. "+ New alert" FAB primary color

**File**: `src/app/features/home/home.html`

**Intent**: Remove the inert `color="primary"` attribute (FAB's M3 default is `primary-container`, not `primary`, so the attribute currently does nothing and the real fix is explicit CSS).

**Contract**: `<button matFab extended color="primary" class="new-alert-fab" ...>` → `<button matFab extended class="new-alert-fab" ...>`.

**File**: `src/app/features/home/home.scss`

**Intent**: Add explicit primary-color styling to `.new-alert-fab` so it matches the toolbar and buttons — see "Critical Implementation Details" for why the icon/label need their own explicit override, not just a plain `color` rule.

**Contract**: Set `.new-alert-fab`'s container background to `--mat-sys-primary`. Additionally override the FAB's internal container/icon/label custom properties (confirm exact variable names via devtools on `.mdc-fab`, `.mdc-fab__icon`, `.mdc-fab-extended__label`) to `--mat-sys-primary`/`--mat-sys-on-primary` so the icon and "New alert" label stay readable against the new background.

#### 3. Active sidebar link color

**File**: `src/app/core/shell/shell.scss`

**Intent**: Switch the active nav-link highlight from the unrelated secondary-container token to the primary palette, matching the toolbar/FAB/buttons.

**Contract**: In `.active-link` (currently lines 38-41), replace `--mat-sys-secondary-container`/`--mat-sys-on-secondary-container` with `--mat-sys-primary`/`--mat-sys-on-primary`.

#### 4. Home page greeting spacing fix

**File**: `src/app/features/home/home.html`

**Intent**: Guarantee a visible space renders between the "Logged in as:" label and the email address.

**Contract**: Replace the literal space between `</span>` and `<strong>` on line 8 with `&nbsp;`.

#### 5. Admin nav link label

**File**: `src/app/core/shell/shell.html`

**Intent**: Reword the admin sidebar link so it reads as an action ("fetch"), matching the panel's own submit button wording, rather than sounding like a data view.

**Contract**: `i18n="@@shell.nav.adminMarketData"` text content: "Market data" → "Fetch market data".

**File**: `src/locale/messages.xlf`

**Intent**: Keep the English source translation unit in sync with the template text.

**Contract**: `shell.nav.adminMarketData` `<source>`: "Market data" → "Fetch market data".

**File**: `src/locale/messages.pl.xlf`

**Intent**: Update the hand-maintained Polish translation to match, using the same phrasing already established on the submit button.

**Contract**: `shell.nav.adminMarketData` `<target>`: "Dane giełdowe" → "Pobierz dane giełdowe".

### Success Criteria:

#### Automated Verification:

- `npm run ci` passes (typecheck, worker tests, production build — build enforces `i18nMissingTranslation: "error"`, catching any EN/PL mismatch on the renamed string)

#### Manual Verification:

- Toolbar, "+ New alert" FAB, active sidebar link, and an existing button (e.g. admin panel submit) all visually render the same shade of blue
- Table/list headers (instrument history, trigger history) and the alert-list accordion header are visually unchanged from before this change
- Text on toolbar, FAB, and active link stays clearly readable against the new background (on-primary contrast)
- Home page greeting shows a visible space: "Logged in as: <email>." / "Zalogowano jako: <email>."
- Admin sidebar link reads "Fetch market data" (EN) / "Pobierz dane giełdowe" (PL)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Manual Testing Steps:

1. Log in as a regular user, view toolbar and active sidebar link colors alongside the "+ New alert" FAB and an existing form button — confirm identical shade.
2. Navigate to instrument history and trigger history — confirm table headers are unchanged (still the lighter tone).
3. Open the alert list — confirm the accordion header is unchanged.
4. Log in as an admin, expand the "Admin" menu — confirm the link now reads "Pobierz dane giełdowe" and still navigates to `/admin` correctly.
5. View the home page welcome card — confirm a visible space between "Zalogowano jako:" and the email.

## Migration Notes

None — CSS/HTML/i18n-only change, no data or API impact.

## References

- GitHub issue: https://github.com/mswiac/market-pulse/issues/62

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Unify primary color + bundled small fixes

#### Automated

- [x] 1.1 `npm run ci` passes (typecheck, worker tests, production build)

#### Manual

- [x] 1.2 Toolbar, FAB, active sidebar link, and an existing button render the same shade of blue
- [x] 1.3 Table/list headers and alert-list accordion header are visually unchanged
- [x] 1.4 Text stays readable (on-primary contrast) on toolbar, FAB, and active link
- [x] 1.5 Home page greeting shows a visible space between label and email
- [x] 1.6 Admin sidebar link reads "Fetch market data" / "Pobierz dane giełdowe" and still navigates correctly
