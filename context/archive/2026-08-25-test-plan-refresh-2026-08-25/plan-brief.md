# Test Plan Refresh (2026-08-25) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-08-25/plan.md`
> Research: `context/changes/test-plan-refresh-2026-08-25/research.md`

## What & Why

Refresh `context/foundation/test-plan.md` to reflect two things that happened since its 2026-08-22 refresh: a test-only Stryker mutation-testing sweep (PR #91) hardened all of `src/worker/**`, and user interview surfaced a new risk — the admin panel (Angular) has zero component-test coverage despite handling destructive, irreversible actions (instrument/user removal).

## Starting Point

`test-plan.md`'s 7-risk map is fully covered by 4 shipped rollout phases (§3, all `shipped`). §4's Stack table still carries `"none yet — see §3 Phase N"` phrasing left over from before any phase shipped. No admin-panel component test exists anywhere in the repo (`find src/app -name "*.spec.ts"` → only `alert-form.spec.ts`, `register.spec.ts`).

## Desired End State

`test-plan.md` has an 8th risk (admin panel) with full Risk Response Guidance, a 5th rollout phase scheduled (not started) to close it, a Stack table with no stale phrasing and a note crediting the mutation-testing hardening, and a Freshness Ledger entry recording PR #91. No test code is written in this change — Phase 5 becomes its own future `/10x-new` → `/10x-plan` → `/10x-implement` cycle, same as Phases 1-4.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Risk #8 table position | Appended as row 8, not reordered by score | Existing table isn't strictly sorted already, and reordering would invalidate risk-number references already baked into shipped phases' archived plans | Plan |
| Phase 5 scope | All 6 admin components, including `admin-panel.ts`'s backfill form | Matches the component list already agreed in `change.md`; closes 100% of the uncovered surface in one future phase | Plan |
| §6.5 cookbook | Left `TBD`, only a one-line flag added to §3's Phase 5 scope note | Preserves the doc's existing "fills in once the phase ships" convention; research.md already has the DI/dialog details for whoever picks it up | Plan |
| PR #91 process gap | No lessons.md entry for the missing change folder | Sweep was test-only, low-risk, well-documented in commits — not a pattern worth codifying from one exception | Plan |

## Scope

**In scope:** `test-plan.md` §2 (Risk Map — add Risk #8), §3 (Phased Rollout — add Phase 5 + scope note), §4 (Stack — remove stale phrasing, add mutation-testing note), §8 (Freshness Ledger — record PR #91, bump review date), header note.

**Out of scope:** Any admin-panel test code (Phase 5's own future change); pre-writing a signal-driven §6.5 cookbook pattern; reordering existing risks #1-#7; CLAUDE.md changes (mutation-testing section already accurate); a lessons.md entry about PR #91.

## Architecture / Approach

Single-phase, single-file documentation edit — no code, no config changes. Every new claim traces to a specific `research.md` finding. Follows the exact same shape as the 2026-08-22 refresh cycle (see `context/archive/2026-08-22-test-plan-refresh-2026-08-22/plan.md` for precedent).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Rewrite affected test-plan.md sections | Risk #8, Phase 5 row, corrected §4 stack notes, §8 ledger entry | Missing a stale "none yet" occurrence, or a risk-number reference elsewhere in the repo that silently goes stale |

**Prerequisites:** None — `research.md` is complete and all planning decisions are made.
**Estimated effort:** Single session, one phase, ~5 targeted edits to one file.

## Open Risks & Assumptions

- Assumes this change will be archived under `context/archive/2026-08-25-test-plan-refresh-2026-08-25/` (matching the change-id's date) — the header note forward-references this path per the established convention; if archiving happens on a later date, the folder name (and thus this reference) would need a manual fix at archive time.
- Assumes no other document outside `test-plan.md` references the current 7-risk numbering in a way that would break — only `test-plan.md` itself and already-archived phase plans were checked; not a full-repo grep.

## Success Criteria (Summary)

- `test-plan.md` reads as internally consistent top to bottom, with every new claim traceable to `research.md`
- No stale `"none yet"` phrasing remains anywhere in §4
- Risk #8 and Phase 5 are both present and cross-referenced correctly
