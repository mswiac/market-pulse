# Test Plan Refresh (2026-08-25) Implementation Plan

## Overview

`context/foundation/test-plan.md` was refreshed 2026-08-22 and its four proposed rollout phases have since shipped. Two things have happened since that the doc doesn't yet reflect: a test-only Stryker mutation-testing sweep (PR #91, commits `8a2884f`..`07bef80`) closed coverage gaps across all of `src/worker/**`, and user interview surfaced a new risk — the admin panel (Angular, `src/app/features/admin/`) has zero component-test coverage despite handling destructive, irreversible actions. `context/changes/test-plan-refresh-2026-08-25/research.md` has grounded both against current code with file:line evidence. This plan rewrites the affected sections of `test-plan.md` to reflect that grounded state. This is a documentation-only change: no test code is written here — Phase 5 (admin panel component tests) gets its own future `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` cycle when it's actually worked, matching how Phases 1-4 were each run as separate changes.

## Current State Analysis

- `test-plan.md` §2's risk map has 7 risks, all now covered by shipped phases (§3 rows 1-4, all `shipped`). No risk currently names the admin panel's Angular components.
- §3's phase table stops at Phase 4; nothing schedules the admin panel work research.md's Risk #8 finding demands.
- §4's Stack table has stale `"none yet — see §3 Phase N"` phrasing on three rows (Worker unit+integration, HTTP edge mocking, Angular component tests) left over from before any phase had shipped — all three phases those rows point at (1 and 3) have since shipped.
- §7's Angular-snapshot-tests bullet already accounts for Phase 3 having shipped behavioral component tests; no further correction needed there per this refresh's scope.
- §8's Freshness Ledger has no entry recording PR #91's mutation-testing sweep, and its "Strategy (§1-§5) last reviewed" date (2026-08-22) predates this refresh's risk-map change.
- research.md corrected two assumptions from `change.md`'s original framing: none of the 6 admin components use `FormGroup` (all are signal-based, so §6.5's flagship "cast to `protected form`" pattern doesn't transfer as-is), and `add-instrument.ts`'s real untested logic is its type→suffix mapping, not a currency-validation gap (currency always has a UI default and can't be empty).
- Four decisions were made in the planning session (see Key Discoveries) that determine exactly how §2-§4 and §8 of the refreshed document should read.

## Desired End State

`context/foundation/test-plan.md` accurately reflects the current codebase: an 8-risk map (§2) with Risk #8 (admin panel) and its Risk Response Guidance row grounded in research.md's Detailed Findings; a Phased Rollout table (§3) with a new Phase 5 row and scope note covering all 6 admin components; a Stack table (§4) with the stale `"none yet"` phrasing removed from all three affected rows and a mutation-testing note added to the Worker row; and a Freshness Ledger (§8) recording PR #91 as a completed milestone with today's review date.

**Verification**: read the rewritten `test-plan.md` top to bottom; Risk #8 and its Risk Response Guidance row trace to specific research.md findings; the Phase 5 row and scope note match this session's scope decision (all 6 components, cookbook stays TBD); no `"none yet — see §3 Phase"` phrasing remains anywhere in §4; §8's ledger entry names PR #91's commit range and correctly states "no risk-map change" refers only to the sweep itself (Risk #8 is a separate, interview-sourced addition, not a PR #91 finding).

### Key Discoveries (decisions made this session):

1. **Risk #8 placement** — appended at the end of §2's risk table as row 8, not inserted mid-table by impact×likelihood rank. Source: this session's decision — the existing 7-row table is already not strictly sorted by risk score (e.g. row 4 is Medium/Medium, listed after row 3's High/Low), and reordering would invalidate risk-number references already baked into shipped phases' archived plans (e.g. `context/archive/2026-08-24-abuse-lens-closure/plan.md` refers to risks #6/#7 by number).
2. **Phase 5 scope** — covers all 6 admin components named in `change.md`, including `admin-panel.ts` (the manual market-data backfill form, which has no dialog/delete semantics). Source: this session's decision, matching the component list already agreed in `change.md`'s Notes and research.md's confirmed findings.
3. **§6.5 cookbook** — stays `TBD` for the signal-driven (no-`FormGroup`) testing pattern; not pre-written in this refresh. Source: this session's decision, preserving the doc's existing convention ("each sub-section is filled in once the relevant rollout phase ships" — §6). The gap itself (no `FormGroup` in any of the 6 components) is recorded as a one-line flag in §3's new Phase 5 scope note so the future phase's own planning step doesn't have to rediscover it.
4. **PR #91 process note** — not recorded as a lessons.md entry. Source: this session's decision — the sweep was test-only, low-risk, and well-documented in its own commit messages; a lightweight process rule for a one-off exception isn't warranted here.

## What We're NOT Doing

- Not writing any Angular component test code for the admin panel — that's Phase 5's own future implementation change.
- Not pre-designing the signal-driven test pattern in §6.5 — Key Discovery #3 records the decision to leave it for Phase 5.
- Not reordering the existing 7-risk table — Key Discovery #1.
- Not touching CLAUDE.md — its mutation-testing section (already documenting Stryker's `src/worker/**` scope, narrowed-run guidance, and the `vitest.related: false` gotcha) remains accurate per research.md; nothing here contradicts it.
- Not adding a lessons.md entry about PR #91's missing change folder — Key Discovery #4.
- Not re-deriving anything already grounded in `research.md` — this plan cites it rather than re-researching.

## Implementation Approach

Single-phase documentation edit. `test-plan.md`'s existing section structure is preserved — only content changes in §2, §3, §4, and §8. Every factual claim in the edit must trace to a specific `research.md` section so a future reader can verify it without re-deriving.

## Critical Implementation Details

**Forward-reference to the not-yet-created archive path.** The doc's header (lines 9-16) already follows an established convention: each refresh's "Last updated" note links to `context/archive/<date>-test-plan-refresh-<date>/`, even though at the moment the edit lands, this change folder is still under `context/changes/`, not yet archived (confirmed by commit order in the 2026-08-22 cycle: the `docs(test-plan-refresh-2026-08-22): rewrite test-plan.md` commit landed *before* the `chore(archive): close test-plan-refresh-2026-08-22` commit). Follow the same forward-reference: write `context/archive/2026-08-25-test-plan-refresh-2026-08-25/` in the new header line, matching this change-id's own date rather than waiting for the archive step to actually happen first.

## Phase 1: Rewrite affected test-plan.md sections

### Overview

Update §2 (Risk Map), §3 (Phased Rollout), §4 (Stack), and §8 (Freshness Ledger) of `test-plan.md` with content grounded in `research.md` and this session's four decisions. §1, §5, §6, §7 are unchanged.

### Changes Required:

#### 1. Test Plan — Header note (top of file)

**File**: `context/foundation/test-plan.md`

**Intent**: Add a new "Last updated" line recording this refresh, following the existing convention of forward-referencing the archive path (see Critical Implementation Details).

**Contract**: Append a new bullet/line after the existing header notes (after the current "§3 Phased Rollout table corrected 2026-08-24..." line): states the date (2026-08-25), that Risk #8 (admin panel) and §3 Phase 5 were added, that the PR #91 mutation-testing sweep was recorded in §4/§8 with no risk-map change of its own, and links to `context/archive/2026-08-25-test-plan-refresh-2026-08-25/`.

#### 2. Test Plan — Risk Map (§2)

**File**: `context/foundation/test-plan.md`

**Intent**: Add Risk #8 (admin panel zero component coverage) as a new row at the end of the risk table, and a matching row at the end of the Risk Response Guidance table.

**Contract**: Risk table (`# | Risk | Impact | Likelihood | Source`) gains row `8 | Admin panel (Angular) has zero component-test coverage across 6 components (admin-panel, add-instrument, remove-instrument[-confirm], remove-user[-confirm]) handling destructive/irreversible actions and non-trivial form logic (type→suffix mapping) | High | Medium | User interview (2026-08-25); 5 commits/30d in src/app/features/admin/ (S-09..S-12, shipped in the last 3 weeks); zero test coverage confirmed (research.md); roadmap S-11 risk note (no FK safety net — cleanup logic lives in the delete endpoint, so UI must send the right target)`.

Risk Response Guidance table gains row `#8 | Confirm/cancel dialogs call the delete service only on explicit confirmation; add-instrument's type→suffix mapping and ticker-uppercase-on-blur behave as coded; each component's error-code map renders the correct message | "it's just a confirm dialog, too simple to break" — nothing today proves the UI sends the right id/payload or that the dialog can't be bypassed | research.md confirms none of the 6 components use FormGroup (all signal-based); MatDialog (non-optional) is injected by the two "opener" components (remove-instrument.ts, remove-user.ts), while the two *-confirm dialog components never inject MatDialogRef directly — the mat-dialog-close template directive requires it from TestBed providers regardless; both delete flows share a repeated impact-preview→confirm→delete pattern | Angular component tests via Vitest + @testing-library/angular/zoneless — same tooling as §6.5, but needs a new signal-driven testing pattern since §6.5's FormGroup-cast trick doesn't apply here | Assuming §6.5's existing FormGroup-driven pattern transfers directly to these components without adaptation`.

#### 3. Test Plan — Phased Rollout (§3)

**File**: `context/foundation/test-plan.md`

**Intent**: Add a Phase 5 row covering Risk #8, and a scope note recording this session's scope decisions (Key Discoveries #2 and #3).

**Contract**: Phase table gains row `5 | Admin panel component coverage | Component tests (Vitest) for all 6 admin-panel components, closing risk #8 | #8 | component (Vitest) | not started | —`. New scope-note bullet under the existing ones: "**Phase 5**: covers risk #8. Scope includes all 6 admin components named in Risk #8, including `admin-panel.ts`'s manual backfill form (Key Discovery #2) — not just the destructive-action components. §6.5's cookbook stays `TBD` for this phase's signal-driven (no-`FormGroup`) testing pattern until it actually ships (Key Discovery #3); `research.md` already documents the DI/dialog specifics per component for whoever picks this phase up."

#### 4. Test Plan — Stack (§4)

**File**: `context/foundation/test-plan.md`

**Intent**: Remove the stale `"none yet — see §3 Phase N"` phrasing from all three affected rows (it predates any phase shipping) and add a note crediting PR #91's mutation-testing hardening on the Worker row.

**Contract**: "unit + integration (Worker)" row's Notes: replace `"; none yet — see §3 Phase 1"` with `"; hardened by Stryker mutation testing (\`npx stryker run\`, scope \`src/worker/**/*.ts\` per \`stryker.config.json\`) — most recently PR #91 (2026-08-24/25) closed survivor gaps across all \`src/worker/**\` modules"`. "HTTP edge mocking" row's Notes: remove `"; none yet — see §3 Phase 1"` (Phase 1 shipped; no replacement text needed, the preceding sentence already stands alone). "Angular component tests" row's Notes: replace `"; no separate Angular-specific test runner (Karma) is being introduced — none yet, see §3 Phase 3"` with `"; no separate Angular-specific test runner (Karma) was introduced. Two component test files shipped in §3 Phase 3 (\`alert-form.spec.ts\`, \`register.spec.ts\`); admin panel components remain uncovered — see §3 Phase 5 (risk #8)"`.

#### 5. Test Plan — Freshness Ledger (§8)

**File**: `context/foundation/test-plan.md`

**Intent**: Record PR #91's mutation-testing sweep as a completed milestone and bump the strategy-review date to reflect Risk #8's addition.

**Contract**: "Strategy (§1-§5) last reviewed" date changes from `2026-08-22` to `2026-08-25`. New bullet added: `"2026-08-25 — PR #91 mutation-testing triage (commits 8a2884f..07bef80, 6 commits): test-only sweep closing Stryker survivor gaps across src/worker/** (session/auth, scheduled/admin routes, index/email, market-data/password, alert-evaluation, alerts/trigger-events/admin/resend/rsi). ~823 lines added across 12 test/worker/*.test.ts files. No production code changed, no risk-map delta from this sweep itself (Risk #8 is a separate, interview-sourced addition — see §2)."`.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` renders as valid Markdown with no broken table syntax (visual check via Read — no Markdown linter is configured in this repo)
- No remaining stale phrasing: `grep -n "none yet" context/foundation/test-plan.md` returns nothing
- Risk #8 present: `grep -n "^| 8 |" context/foundation/test-plan.md` returns the new risk-map row
- Phase 5 present: `grep -n "^| 5 |" context/foundation/test-plan.md` returns the new phase row
- PR #91 recorded: `grep -n "PR #91" context/foundation/test-plan.md` returns the new Freshness Ledger bullet

#### Manual Verification:

- Read the full updated `test-plan.md` top to bottom; confirm Risk #8 and its Risk Response Guidance row trace to specific `research.md` findings, not paraphrased-from-memory claims
- Confirm the new Phase 5 scope note matches Key Discoveries #2 and #3 (all 6 components, cookbook left `TBD`)
- Confirm no risk in §2 was renumbered and no existing archived phase's risk-number references were invalidated (spot-check `context/archive/2026-08-24-abuse-lens-closure/plan.md`'s risk #6/#7 references still make sense against the updated table)
- Confirm §4's three corrected rows read naturally with the stale phrasing gone (no dangling punctuation or half-sentences left behind by the edit)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

Not applicable — this is a documentation-only change. No test suite covers Markdown content; verification is the automated grep checks plus the manual read-through above.

## References

- Research: `context/changes/test-plan-refresh-2026-08-25/research.md`
- Document being updated (in place): `context/foundation/test-plan.md`
- Original risk/phase proposal: `context/changes/test-plan-refresh-2026-08-25/change.md`
- Precedent for this same document-refresh shape: `context/archive/2026-08-22-test-plan-refresh-2026-08-22/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rewrite affected test-plan.md sections

#### Automated

- [x] 1.1 test-plan.md renders as valid Markdown with no broken table syntax — f56c734
- [x] 1.2 No remaining "none yet" phrasing anywhere in test-plan.md — f56c734
- [x] 1.3 Risk #8 row present in the risk map — f56c734
- [x] 1.4 Phase 5 row present in the Phased Rollout table — f56c734
- [x] 1.5 PR #91 milestone recorded in the Freshness Ledger — f56c734

#### Manual

- [x] 1.6 Full read-through confirms Risk #8 and its Risk Response Guidance row trace to research.md findings — f56c734
- [x] 1.7 New Phase 5 scope note matches Key Discoveries #2 and #3 — f56c734
- [x] 1.8 No existing risk was renumbered; archived phases' risk-number references still make sense — f56c734
- [x] 1.9 §4's three corrected rows read naturally with no leftover stale phrasing artifacts — f56c734
