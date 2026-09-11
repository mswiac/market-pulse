# Alert List Long Instrument Names — Implementation Plan

## Overview

Two related presentational fixes, bundled at the user's request because they touch the same layout family:

1. Unify the `max-width` cap used by every content page (today mostly `48rem`, copy-pasted across 5+ files, with `trigger-history` already an ad hoc outlier at `60rem`) behind a single shared CSS custom property, and raise it to `64rem`.
2. Fix the alerts list (`alert-list.html` / `alert-list.scss`) so long instrument names (e.g. "Powszechna Kasa Oszczędności Bank Polski S.A.") no longer overflow and overlap the row above — by rebalancing the fixed grid columns in the instrument name's favor and allowing the name to wrap onto multiple lines instead of being truncated.

## Current State Analysis

- `src/styles.scss` is 24 lines with no custom `:root`/`html` properties of its own — every custom-property reference in the app (`var(--mat-sys-*)`) comes from Angular Material's own theme tokens.
- Five files share an *identical* `:host { display: block; padding: 2rem; max-width: 48rem; margin: 0 auto; }` block: `admin-panel.scss:1-5`, `add-instrument.scss:1-5`, `remove-instrument.scss:1-5`, `remove-user.scss:1-5`, `instrument-history.scss:1-5`.
- `trigger-history.scss:1-5` uses the same pattern but already deviates at `max-width: 60rem` — an existing, undocumented precedent for widening a data-heavy page.
- `home.scss` uses a different structure (flex column of two sections) but both `.welcome-card` (`home.scss:9-12`) and `.alerts-section` (`home.scss:14-17`) are capped at the same `48rem`.
- `login.scss` / `register.scss` use an unrelated `.auth-page` pattern (centered flex, `min-height: 100dvh`) for a single narrow form card — structurally different, not a content/table page.
- In `alert-list.scss`, `.list-header` (`:30-38`) and `.alert-summary` (`:67-73`) are two **separate CSS grids** with the same `grid-template-columns: 11rem 12rem 1fr`, but different available width — `.alert-summary` sits inside `mat-expansion-panel-header`, which reserves space on the right for Material's expand-arrow indicator that `.list-header` doesn't have. Confirmed by trial: making the first column `fr` (proportional) instead of a fixed length makes it resolve to a different pixel width in each grid, so "Alert type" / "Threshold" drift out of alignment between the header bar and the rows.
- The instrument-name column (`11rem`) is fixed *narrower* than the alert-type column (`12rem`), even though alert-type labels ("Price threshold" / "RSI threshold") need far less room than an instrument name — the columns are unbalanced, not equal.
- `mat-expansion-panel-header` has a Material-imposed fixed height (bound to `--mat-expansion-header-collapsed-state-height` / `-expanded-state-height`, 48px/64px by default). A name that doesn't fit on one line wraps inside that fixed-height box and visually overlaps the panel above it — this, not the wrapping itself, is the root cause of the reported bug.
- No `@media` query or `BreakpointObserver`/`matchMedia` usage exists anywhere in `src/app` — the app has no responsive/mobile design today, confirmed by search.

## Desired End State

- One CSS custom property, `--page-max-width: 64rem`, defined once in `src/styles.scss`, consumed via `var(--page-max-width)` by every content page's `max-width` declaration (`home.scss` ×2, `admin-panel.scss`, `add-instrument.scss`, `remove-instrument.scss`, `remove-user.scss`, `instrument-history.scss`, `trigger-history.scss`). `login.scss` / `register.scss` are untouched.
- The alerts list's instrument-name column is wider (fixed, not proportional) and the alert-type column is trimmed to what its labels actually need; `.list-header` and `.alert-summary` keep identical `grid-template-columns` so they stay visually aligned.
- A long instrument name that still doesn't fit on one line wraps onto multiple lines, and that row grows taller to fit — without clipping or overlapping neighboring rows. Rows are allowed to differ in height.
- No truncation/ellipsis/tooltip fallback exists for the instrument name — verified this doesn't reintroduce the original bug because the row height is no longer fixed.

### Key Discoveries:

- `grep -rn "max-width" src/app --include=*.scss` confirms the exact 8 declarations to change and their current values (see Current State Analysis).
- `src/app/features/home/home.scss:1-17`, `src/app/features/alerts/alert-list/alert-list.scss:1-92` — full current content already read; no other files reference these selectors (Angular's default `ViewEncapsulation.Emulated` scopes each component's styles, confirmed no `::ng-deep` usage in the affected files, so this change cannot leak into unrelated pages).
- Because every affected container is `width: 100%; max-width: <value>` (a fluid pattern), raising `--page-max-width` can never force a horizontal scrollbar on a narrower viewport — it only raises the ceiling on screens wide enough to reach it.

## What We're NOT Doing

- Not touching `login.scss` / `register.scss` — different UI pattern (centered narrow auth card), explicitly excluded.
- Not adding any responsive/mobile breakpoint handling — the app has none today, and this is confirmed out of scope (the app isn't used on phones).
- Not adding an ellipsis/tooltip truncation fallback (`matTooltip` or similar) — explicitly rejected in favor of always wrapping.
- Not changing `alert-list.html` or `alert-list.ts` — no new Angular imports or template changes are needed; the fix is CSS-only.
- Not introducing a general SCSS design-tokens file or variable system beyond the single `--page-max-width` property — scoped to the problem at hand.

## Implementation Approach

Two independent, sequentially-ordered phases so each can be reviewed and manually verified on its own:

1. Introduce the shared width token and roll it out to every affected page (mechanical, low-risk, no visual-logic changes beyond the width itself).
2. Fix the alerts list specifically: rebalance the grid columns, then remove the fixed-height constraint that turns wrapping into visual breakage.

**Note:** Phase 1 alone does not close GitHub issue #148 — the instrument-name column stays at its old width until Phase 2 lands, so long names still overflow in the interim. Both phases should land together before considering the reported bug resolved.

## Phase 1: Shared page-width token

### Overview

Replace the copy-pasted `max-width: 48rem` (and `trigger-history`'s outlier `60rem`) with one CSS custom property, raised to `64rem`, consumed everywhere via `var()`.

### Changes Required:

#### 1. Define the shared token

**File**: `src/styles.scss`

**Intent**: Establish one source of truth for the app's content-page width cap, following the project's existing convention of consuming CSS custom properties (`var(--mat-sys-*)`) rather than SCSS `$variables`.

**Contract**: Add `--page-max-width: 64rem;` inside the existing `html { ... }` block (the same element Angular Material's own `mat.theme()` mixin emits its tokens onto).

#### 2. Consume the token in every content page

**Files**:
- `src/app/features/home/home.scss` (`.welcome-card`, `.alerts-section`)
- `src/app/features/admin/admin-panel.scss` (`:host`)
- `src/app/features/admin/add-instrument/add-instrument.scss` (`:host`)
- `src/app/features/admin/remove-instrument/remove-instrument.scss` (`:host`)
- `src/app/features/admin/remove-user/remove-user.scss` (`:host`)
- `src/app/features/instrument-history/instrument-history.scss` (`:host`)
- `src/app/features/trigger-history/trigger-history.scss` (`:host`)

**Intent**: Replace each file's literal `max-width` value with the shared token so all content pages move in lockstep going forward.

**Contract**: In each listed selector, change `max-width: 48rem;` (or `60rem` for `trigger-history`) to `max-width: var(--page-max-width);`. No other property in these blocks changes.

### Success Criteria:

#### Automated Verification:

- Production build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- On a wide viewport (e.g. 1440px+ browser window), each affected page (home/alerts, admin panel, add instrument, remove instrument, remove user, instrument history, trigger history) visibly uses the new, wider max width and is horizontally centered.
- `login` and `register` pages are visually unchanged.
- No page shows a horizontal scrollbar at common desktop widths (1280px, 1440px, 1920px) or when the browser window is narrowed to roughly 800px.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Alert list column rebalance and wrapping

### Overview

Give the instrument-name column more (fixed) width, shrink the over-sized alert-type column, and let the instrument name wrap onto multiple lines by removing `mat-expansion-panel-header`'s fixed height — so long names never clip or overlap neighboring rows again.

### Changes Required:

#### 1. Rebalance the grid columns

**File**: `src/app/features/alerts/alert-list/alert-list.scss`

**Intent**: Give the instrument-name column noticeably more room and reclaim the alert-type column's unused space, without breaking the header/row alignment.

**Contract**: In both `.list-header` (`:32`) and `.alert-summary` (`:69`), change `grid-template-columns: 11rem 12rem 1fr;` to `grid-template-columns: 17rem 9.5rem 1fr;`. Both selectors must be changed to the **exact same value** — this is the load-bearing invariant that keeps the header bar and each row's columns aligned (see Current State Analysis). Only the trailing column may be a flexible `1fr`; the first two must stay fixed lengths in both places.

#### 2. Allow the instrument name to wrap without clipping

**File**: `src/app/features/alerts/alert-list/alert-list.scss`

**Intent**: Remove Material's fixed header height so a wrapped, multi-line instrument name grows the row instead of overlapping the row above/below it.

**Contract**: Override `mat-expansion-panel-header`'s height so it's driven by content instead of a fixed value: `height: auto !important; min-height: var(--mat-expansion-header-collapsed-state-height, 48px) !important;` so single-line rows keep their current height and only rows with a wrapped name grow taller. **`!important` is required, not optional**: Material's own rule is `.mat-expansion-panel-header { height: ...; }` — a class selector (specificity 0,1,0) — while this override targets the bare element selector `mat-expansion-panel-header` (specificity 0,0,1); without `!important` the override is silently beaten by Material's own rule and changes nothing. This is the same reason the file's existing `background-color` override on this selector already carries `!important`.

### Critical Implementation Details

**Header height override interacts with Material's expand/collapse animation.** Material normally animates the header's height between its collapsed (48px) and expanded (64px) states when a panel opens. Setting `height: auto` for both states means that subtle size difference (and its animation) goes away — expand/collapse will still work, but the header itself won't visibly grow by that extra 16px on focus/expand. This is an accepted, minor cosmetic side effect, not a functional regression; confirm during manual verification that the panel still opens/closes without a visual glitch (e.g. an abrupt snap) and that vertical padding still looks balanced for both single-line and wrapped multi-line rows — tune padding if the wrapped state looks cramped.

### Success Criteria:

#### Automated Verification:

- Production build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Adding an alert for an instrument with a long name (e.g. "Powszechna Kasa Oszczędności Bank Polski S.A.") shows the full name, wrapped onto multiple lines if needed, with no clipping and no overlap with the row above or below.
- "Alert type" and "Threshold" column headers stay visually aligned with their corresponding row values, including on a row with a wrapped (multi-line) instrument name and on a row with a short single-line name.
- Expanding/collapsing a panel with a wrapped instrument name still works and doesn't visually glitch.
- A row with a short instrument name is unaffected (same single-line height as before).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — `skipTests: true` is set globally (`angular.json`); this is a CSS-only presentational change with no new component logic.

### Integration Tests:

- None planned. This is out of scope for Playwright/E2E per the project's E2E workflow (functional flows, not visual/layout regression).

### Manual Testing Steps:

1. `npm start`, log in, and open the home page with an existing alert list.
2. Resize the browser window across common widths (800px, 1280px, 1440px, 1920px+) and confirm the alerts section and welcome card both grow to the new width with no horizontal scrollbar.
3. Visit admin panel, add instrument, remove instrument, remove user, instrument history, and trigger history pages at a wide viewport and confirm they all share the same new width.
4. Visit login and register and confirm they look unchanged.
5. Add an alert for a long-named instrument (e.g. PKO BP — "Powszechna Kasa Oszczędności Bank Polski S.A.") and confirm the name wraps cleanly with no overlap, and the header/column alignment holds.
6. Toggle sorting by each column and confirm alignment holds across all rows, short and wrapped alike.

## Performance Considerations

None — this is a static CSS change with no additional computation, network calls, or DOM churn.

## Migration Notes

Not applicable — no data model or persisted-state changes.

## References

- GitHub issue: https://github.com/mswiac/market-pulse/issues/148
- Change notes: `context/changes/alert-list-long-names/change.md`
- Existing precedent for widening beyond the copied default: `src/app/features/trigger-history/trigger-history.scss:4` (`max-width: 60rem`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared page-width token

#### Automated

- [x] 1.1 Production build succeeds: `npm run build`
- [x] 1.2 Lint passes: `npm run lint`

#### Manual

- [ ] 1.3 Every affected page visibly uses the new, wider max width and is horizontally centered
- [ ] 1.4 `login` and `register` pages are visually unchanged
- [ ] 1.5 No page shows a horizontal scrollbar at common desktop widths or down to ~800px

### Phase 2: Alert list column rebalance and wrapping

#### Automated

- [ ] 2.1 Production build succeeds: `npm run build`
- [ ] 2.2 Lint passes: `npm run lint`

#### Manual

- [ ] 2.3 Long instrument name wraps onto multiple lines with no clipping or overlap
- [ ] 2.4 Column headers stay aligned with row values, including on wrapped rows
- [ ] 2.5 Expand/collapse on a wrapped row works without visual glitches
- [ ] 2.6 A short-name row is unaffected (unchanged single-line height)
