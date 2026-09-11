# Alert List Long Instrument Names — Plan Brief

> Full plan: `context/changes/alert-list-long-names/plan.md`

## What & Why

Long instrument names (e.g. "Powszechna Kasa Oszczędności Bank Polski S.A.") broke the alerts list's presentation — the name overflowed a fixed-height row and visually overlapped the row above it. While fixing that, the user also asked to stop wasting screen space on wide monitors, and then to make that width consistent across every content page rather than fixing it only for alerts.

## Starting Point

The alerts list renders as two synced CSS grids (`.list-header` and each row's `.alert-summary`) with unbalanced fixed column widths (name narrower than alert-type, despite needing more room). Every content page (`home`, `admin-panel`, `add-instrument`, `remove-instrument`, `remove-user`, `instrument-history`, `trigger-history`) independently copy-pastes its own `max-width: 48rem` (mostly identical `:host` blocks); `trigger-history` already deviates ad hoc at `60rem`. `login`/`register` use an unrelated centered-card pattern. No shared CSS variables file and no responsive/mobile handling exist anywhere in the app.

## Desired End State

Every content page (except login/register) shares one `--page-max-width: 64rem` token, defined once in `src/styles.scss`. The alerts list gives the instrument name more room, and any name still too long simply wraps onto more lines — growing that row's height — instead of ever being clipped, overlapped, or truncated with an ellipsis.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Truncation vs. wrapping | Always wrap, never truncate | Instrument name is important identifying info and must not be hidden | Plan (user) |
| Page width scope | All content pages except login/register | User wanted consistency once alerts widened, not a one-off | Plan (user) |
| Shared width value | `64rem` (1024px), up from 48rem | Meaningfully uses wide screens, close to the existing `trigger-history` 60rem precedent, still readable for short-content pages | Plan (user) |
| Implementation mechanism | One CSS custom property (`--page-max-width`) | Matches the app's existing `var(--mat-sys-*)` convention; eliminates 8 copy-pasted literals | Plan (user) |
| Ellipsis/tooltip fallback | Rejected entirely | Wrapping + wider container covers every case; keeps "widen, don't hide" intact | Plan (user) |
| Header/row column alignment | Both columns before the last stay fixed-length (not `fr`) in both grids | Confirmed by trial: a proportional first column resolves to different pixel widths in `.list-header` vs. `.alert-summary` (different reserved space for the expand-arrow), breaking alignment | Plan |
| Mobile/responsive scope | Explicitly out of scope | App has zero existing `@media`/breakpoint handling and isn't used on phones | Plan (user) |

## Scope

**In scope:**
- One shared `--page-max-width` CSS variable, consumed by 7 files (8 declarations).
- Alerts list column-width rebalance (`11rem 12rem 1fr` → `17rem 9.5rem 1fr`) in both `.list-header` and `.alert-summary`.
- Removing `mat-expansion-panel-header`'s fixed height so wrapped names grow the row instead of clipping.

**Out of scope:**
- `login.scss` / `register.scss` (different UI pattern, untouched).
- Any responsive/mobile breakpoint work.
- Ellipsis/tooltip truncation fallback.
- Changes to `alert-list.html` / `alert-list.ts` (no template or component-logic changes needed).

## Architecture / Approach

Pure CSS change, two phases: (1) introduce and roll out the shared width token app-wide, (2) fix the alerts list's column proportions and let its header wrap. No new dependencies, no Angular Material modules added, no component logic touched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared page-width token | Every content page (except auth) at a consistent, wider `64rem` cap | Low — fluid `width:100%/max-width` pattern can't force a scrollbar on narrower viewports |
| 2. Alert list column rebalance and wrapping | Long instrument names wrap cleanly with no clipping/overlap; header stays aligned | Overriding Material's fixed header height loses its collapsed/expanded height animation distinction — cosmetic only |

**Prerequisites:** None — self-contained CSS change in an already-scaffolded app.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes "ekran logowania" (login screen) was meant to cover both `login` and `register` (same `.auth-page` pattern) — confirmed by the user not correcting this reading during planning.
- Fixed-rem column widths inside `.alert-summary` still carry a pre-existing (not newly introduced) narrow-viewport overflow risk below ~472px CSS width; accepted as out of scope since the app isn't used on phones.

## Success Criteria (Summary)

- Every content page except login/register visibly uses the new, wider shared width, with no horizontal scrollbar introduced at any common desktop width.
- A long instrument name in the alerts list always displays in full (wrapped if needed), never clipped, overlapped, or ellipsized.
- Header columns stay visually aligned with row values regardless of instrument-name length.
