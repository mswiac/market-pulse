---
change_id: alert-list-long-names
title: Alert list: long instrument names break table layout
status: impl_reviewed
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

GitHub issue: https://github.com/mswiac/market-pulse/issues/148

Long instrument names (e.g. "Powszechna Kasa Oszczędności Bank Polski S.A.") break the alerts list presentation — the instrument-name cell overflows/wraps inside the fixed-height accordion header row, overlapping the row above it.

Any fix must keep `.list-header` (column-label bar) and `.alert-summary` (each accordion row's title grid) visually aligned — they are two separate CSS grids with different available width, because the row reserves space for Material's expand-arrow indicator that the header bar doesn't have. Every column but the trailing one must stay a fixed length (not `fr`/`%`) in both grids, or the header and row columns drift apart (confirmed by trial-and-error).

Files involved: `src/app/features/alerts/alert-list/alert-list.html`, `src/app/features/alerts/alert-list/alert-list.scss`.

**Container width is also in scope.** `.alerts-section` in `src/app/features/home/home.scss` is capped at `max-width: 48rem`, same as `.welcome-card`. Per the S-02 (`alert-crud`) plan, that cap was set purely "for visual consistency" with the welcome card — not a deliberate constraint for a data list. On a wide/high-res screen the alerts list is squeezed into less than half the viewport for no functional reason. Decoupling `.alerts-section`'s max-width from `.welcome-card` (and widening it) is a legitimate alternative or complementary fix to juggling fixed column proportions inside the current 48rem.

**Current column widths are unbalanced, not equal.** `grid-template-columns: 11rem 12rem 1fr` (both `.list-header` and `.alert-summary`) gives the instrument-name column (11rem) *less* room than the alert-type column (12rem), even though "Price threshold" / "RSI threshold" labels need far less space than an instrument name. The trailing threshold column (`1fr`) claims whatever's left and ends up widest today simply because its content is short — it self-balances and doesn't need manual narrowing. The fix direction: keep the instrument-name column fixed (not `fr` — see alignment constraint above) but increase its fixed width (e.g. ~17rem), and shrink the alert-type column's fixed width down to what it actually needs (e.g. ~9.5rem); the trailing `1fr` column absorbs the difference automatically.

**Priority: widen, don't hide.** The instrument name is important information for identifying an alert — it should not be truncated/ellipsized as the primary solution. Prefer widening the alerts-section container (see above) and rebalancing column widths in its favor over shortening the displayed name. Ellipsis + tooltip (`matTooltip`), if used at all, is a fallback safety net for names too long for any reasonable column width — not the main fix.

**Wrapping onto multiple lines is acceptable, and takes priority over truncation.** After a single-line width is maximized (container + column rebalance above), a name that still doesn't fit should wrap rather than get ellipsized — even if that means the row grows taller than rows with a short instrument name. Rows are allowed to differ in height; visual inconsistency across rows is an accepted trade-off for showing the full name. This means `mat-expansion-panel-header`'s default fixed height (Material sets `--mat-expansion-header-collapsed-state-height` / `-expanded-state-height`) needs to be overridden to `height: auto` (or a `min-height`) for the instrument-name cell to be allowed to wrap without clipping or overlapping the row above/below — that fixed height is what actually caused the original visual bug in the issue, not the wrapping itself.

**Final decision: no ellipsis/tooltip fallback at all.** Confirmed with the user — widening + wrapping is expected to cover every case; a `matTooltip` truncation safety net was considered and explicitly rejected as unnecessary complexity that contradicts "widen, don't hide."

## Scope expansion: app-wide page width, not just alerts

During planning, the user asked whether widening only the alerts list would leave other pages inconsistent, and decided (confirmed) to widen **every content page except the auth screens (login/register)** to the same width — this grew beyond issue #148's original narrow scope, by explicit user request.

**Confirmed via codebase research:**
- 5 files share an *identical* `:host { display: block; padding: 2rem; max-width: 48rem; margin: 0 auto; }` block, copy-pasted verbatim: `admin-panel.scss`, `add-instrument.scss`, `remove-instrument.scss`, `remove-user.scss`, `instrument-history.scss`.
- `trigger-history.scss` already independently deviates at `max-width: 60rem` — an existing precedent for widening a data-heavy page beyond the copied default, done ad hoc with no shared token.
- `home.scss` has its own two sections (`.welcome-card`, `.alerts-section`), both today at `max-width: 48rem`, structured differently (flex column, not the `:host` pattern above) but same effective cap.
- `login.scss` / `register.scss` use a distinct `.auth-page` centered-card pattern (narrow single-form card, unrelated `min-height: 100dvh` flex centering) — **confirmed excluded** from this change; they are a different UI shape serving a different purpose, not a content/table page.
- No shared SCSS/CSS variables file exists anywhere in the project (`src/styles.scss` is 24 lines, no custom `:root` properties — only Material's own `var(--mat-sys-*)` tokens are referenced app-wide).

**Confirmed decisions:**
- **Scope**: widen all of `home.scss` (`.welcome-card` AND `.alerts-section`), `admin-panel.scss`, `add-instrument.scss`, `remove-instrument.scss`, `remove-user.scss`, `instrument-history.scss`, `trigger-history.scss` — 8 declarations across 7 files. `login.scss`/`register.scss` stay untouched.
- **Shared token**: introduce one CSS custom property, `--page-max-width`, defined once on `:root` in `src/styles.scss` — matches the existing app-wide convention of consuming `var(--mat-sys-*)` custom properties rather than SCSS `$variables`. Every one of the 8 declarations switches from a literal `max-width: 48rem` (or `60rem` for trigger-history) to `max-width: var(--page-max-width)`.
- **Target width**: `64rem` (1024px) — moderate increase from today's 48rem, close to the existing `trigger-history` precedent (60rem), safely below anything that risks readability problems on very short-content pages (e.g. `add-instrument`'s form).
- **Safety re: horizontal scroll**: confirmed via analysis this is a `width: 100% / max-width` fluid pattern in every affected file — raising the cap can never force a scrollbar on narrower viewports; it only raises the ceiling on screens wide enough to reach it. The only real narrow-viewport risk is the *fixed-rem* column widths inside `.alert-summary` (see above), and that risk is already near-identical to today's (pre-existing, undocumented mobile gap — confirmed zero `@media` queries or `BreakpointObserver` usage anywhere in the app). Mobile/narrow-viewport support stays explicitly out of scope for this change (confirmed with user: the app isn't used on phones).
