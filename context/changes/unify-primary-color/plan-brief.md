# Unify primary color — Plan Brief

> Full plan: `context/changes/unify-primary-color/plan.md`

## What & Why

The toolbar, the "+ New alert" FAB, and the active sidebar link each render a visibly different blue than the app's buttons, even though they're meant to read as one brand color. The root cause: Angular Material 3's legacy `color="primary"` input is dead code on these components (confirmed in the installed `@angular/material` source) — buttons only look right by coincidence, because their own M3 default token already happens to be `primary`.

## Starting Point

`mat-toolbar[color="primary"]` and `matFab color="primary"` compile to a no-op under M3 theming. The FAB's real M3 default is `primary-container` (a lighter, pastel token), which is why "+ New alert" currently reads close to the muted tone used on table headers. The active sidebar link uses an unrelated `--mat-sys-secondary-container` token.

## Desired End State

Toolbar, FAB, and active sidebar link all render the same vivid `--mat-sys-primary` blue as the existing buttons. Table/list headers and the alert-list accordion header are untouched, staying on their current lighter tone — this was a deliberate scope decision, not an oversight.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Table/list headers in scope? | No — explicitly excluded | Large flat data-display surfaces read better lighter; only nav/CTA elements need to match button color |
| Fix mechanism | Remove inert `color="primary"`, add explicit `--mat-sys-primary`/`on-primary` CSS | The attribute does nothing under M3 — root-caused by reading `@angular/material`'s theme SCSS directly |
| Contrast verification | Manual visual check, no new tooling | M3's paired primary/on-primary tokens are contrast-safe by design; no visual regression infra exists in this project |
| Bundled fixes | Home greeting spacing (`&nbsp;`) + admin nav label rename, in the same change | User explicitly asked to fold these small, otherwise-forgettable fixes in rather than open separate changes |

## Scope

**In scope:**
- Toolbar background/text color (`shell.html`, `shell.scss`)
- "+ New alert" FAB background/text color (`home.html`, `home.scss`)
- Active sidebar nav link color (`shell.scss`)
- Home page greeting missing-space fix (`home.html`)
- Admin sidebar link rename: "Market data" → "Fetch market data" / "Dane giełdowe" → "Pobierz dane giełdowe" (`shell.html`, `messages.xlf`, `messages.pl.xlf`)

**Out of scope:**
- Table/list headers (instrument history, trigger history)
- Alert-list accordion header (active or `.inactive`)
- Dark mode, automated contrast tooling

## Architecture / Approach

Same fix pattern applied twice (toolbar, FAB): drop the inert `color="primary"` template attribute, add an explicit CSS override reading the M3 system custom properties directly. Active-link and admin-label changes are straightforward token/text substitutions. The spacing fix uses `&nbsp;` instead of a literal space to survive Angular's whitespace handling regardless of exact root cause.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Unify primary color + bundled fixes | Toolbar/FAB/active-link match buttons; spacing + label fixes land | Low — CSS-only, no automated visual regression exists so final confirmation is manual |

**Prerequisites:** None.
**Estimated effort:** Single session, one phase, ~4 files.

## Open Risks & Assumptions

- Exact root cause of the missing-space rendering bug wasn't confirmed live (dev server not run during planning); the `&nbsp;` fix is chosen because it's robust regardless of cause, not because the cause was pinned down.

## Success Criteria (Summary)

- Toolbar, FAB, active sidebar link, and existing buttons all look like the same color when compared side by side in the browser.
- Table/list headers are visually unchanged.
- Home greeting has a visible space; admin nav link reads the new wording.
