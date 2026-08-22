# Test Plan Refresh (2026-08-22) Implementation Plan

## Overview

`context/foundation/test-plan.md` was written 2026-06-28, before implementation started. All 18 roadmap slices are now `done`, and `context/changes/test-plan-refresh-2026-08-22/research.md` has grounded a refreshed 7-risk map against the current codebase with file:line evidence. This plan rewrites `test-plan.md` to reflect that grounded, current state — plus one small drive-by correction to `CLAUDE.md`, which currently repeats the same stale claim (Karma) that research had to debunk. This is a documentation-only change: no test code is written here. Each rollout phase in the refreshed §3 will get its own future `/10x-new` → `/10x-plan` → `/10x-implement` cycle when it's actually worked.

## Current State Analysis

- `test-plan.md`'s risk map (§2) covers 6 pre-implementation hypotheticals; several no longer match shipped features (e.g. Stooq-specific risks, when the project switched to Yahoo Finance for both indices per project memory).
- §3's rollout table points at `context/changes/testing-bootstrap-pipeline-units`, a folder that was never created — the actual backend test suite (12 files, 2918 lines) landed ad hoc without a dedicated phase-1 change.
- §1's hot-spot note says churn data had "insufficient signal (3 commits/30d)" — the frontend didn't exist yet at that point.
- research.md re-grounded all of this: a corrected 7-risk map, verified hot-spot figures, and a corrected CI-gate finding (Cloudflare Workers Builds already enforces `npm run ci` as a required branch-protection status check on `main` — the research doc's first pass missed this and was corrected mid-conversation).
- Six decisions were made in this planning session (see Key Discoveries) that determine exactly how §2–§5 of the refreshed document should read.

## Desired End State

`context/foundation/test-plan.md` accurately reflects the current codebase: a 7-risk map with Risk Response Guidance grounded in research.md's Detailed Findings, a corrected Quality Gates section that credits the existing Cloudflare Workers Builds gate instead of describing it as future work, a Stack section that names Vitest (not Karma) for Angular component tests, and a Phased Rollout table whose 4 phases carry the corrected scope from this session's decisions. `CLAUDE.md`'s Commands section no longer claims a Karma test runner that doesn't exist in the repo.

**Verification**: read the rewritten `test-plan.md` top to bottom; every risk, coverage claim, and gate status must trace to a specific finding in `research.md`; no reference to the non-existent `testing-bootstrap-pipeline-units` folder remains; `CLAUDE.md` no longer asserts Karma is the test runner.

### Key Discoveries (decisions made this session):

1. **Risk #2 (resend.ts)** — Phase 1's scope includes *fixing* the uncaught-`fetch`-throw gap (a small `try/catch` addition), not just testing the current silent-failure behavior. Source: this session's planning decision, grounded in `research.md`'s Risk #2 finding (`src/worker/lib/resend.ts:23-42`).
2. **Risk #5 (remote D1)** — Phase 2's scope includes one one-time manual `wrangler d1 execute --remote` verification of `PRAGMA foreign_keys` + cascade behavior, not an automated recurring CI step. Source: this session's decision, grounded in `research.md`'s Risk #5 finding and the project's existing "no D1 migration SQL correctness automation" convention (test-plan.md §7).
3. **Risk #4 (Angular tooling)** — Phase 3 will use Vitest for Angular component tests, not bootstrap Karma. Source: this session's decision, grounded in `research.md`'s finding that `tsconfig.spec.json:8` already declares `vitest/globals` and no Karma package exists.
4. **Risk #1 scope addition** — Phase 1 also includes a quick check of whether `market-data.ts`'s Yahoo `fetch` call has the same uncaught-throw pattern as `resend.ts`, since it's the same failure shape and cheap to check alongside the resend.ts work. Source: this session's decision, grounded in `research.md` Open Question 4.
5. **Rollout structure** — keep 4 phases (not merge/split), only correct scope per the above; Phase 4 drops the "wire `npm run ci`" item since `research.md` confirmed it's already enforced via Cloudflare Workers Builds. Source: this session's decision.
6. **Rollout priority** — Phase 1 (notification/evaluation pipeline) is called out as the top priority if phases must be sequenced under time pressure, since it covers both the user's top-stated concern and the one confirmed real code gap. Source: this session's decision.

## What We're NOT Doing

- Not writing any test code (RSI oracle tests, Resend call-arg assertions, remote-D1 checks, Angular component tests, etc.) — those are each rollout phase's own future implementation change.
- Not applying the `resend.ts` `try/catch` fix in this change — Key Discovery #1 records the *decision* that Phase 1's future change will include it; no code under `src/worker/` is touched here.
- Not bootstrapping Vitest+Angular tooling itself — Key Discovery #3 records the decision; the actual config work happens in Phase 3's future change.
- Not running the manual remote-D1 check — that's a manual step inside Phase 2's future change.
- Not touching any other stale documentation beyond the one identified `CLAUDE.md` line.
- Not re-deriving anything already grounded in `research.md` — this plan cites it rather than re-researching.

## Implementation Approach

Single-phase documentation edit. `test-plan.md`'s existing 8-section template (§1 Strategy, §2 Risk Map, §3 Phased Rollout, §4 Stack, §5 Quality Gates, §6 Cookbook Patterns, §7 Negative Space, §8 Freshness Ledger) is preserved — only content changes, not structure. §6 stays `TBD` (no rollout phase has shipped a test yet under this refresh). Every factual claim in the rewrite must cite back to a specific `research.md` section so a future reader can verify it without re-deriving. The `CLAUDE.md` fix is a one-line, mechanical correction applied last.

## Phase 1: Rewrite test-plan.md and correct CLAUDE.md

### Overview

Replace §1–§5, §7, and §8 of `test-plan.md` with content grounded in `research.md` and this session's six decisions; leave §6 as `TBD`. Apply the one-line `CLAUDE.md` correction.

### Changes Required:

#### 1. Test Plan — Strategy & Freshness (§1, §8)

**File**: `context/foundation/test-plan.md`

**Intent**: Update the header date and §1's hot-spot paragraph with the corrected churn figures; update §8's Freshness Ledger dates to today.

**Contract**: §1's hot-spot sentence changes from "3 commits — insufficient signal" to citing the verified figures (`src/app/features`: 14 commits / 83 file touches in 30 days; `src/worker/lib`: 14 touches in 30 days) per `research.md`'s Hot-spot verification section. §8's three ledger lines get today's date.

#### 2. Test Plan — Risk Map (§2)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the stale 6-risk table and its Risk Response Guidance with the refreshed 7-risk map from `change.md`, each row updated to state the *current, research-grounded* finding rather than a pre-implementation hypothetical.

**Contract**: §2's risk table (`# | Risk | Impact | Likelihood | Source`) gets 7 rows, one per risk in `change.md`'s proposed map, sourced from `research.md`'s per-risk Summary bullets. The Risk Response Guidance table (`Risk | What would prove protection | Must challenge | Context /10x-research must ground | Likely cheapest layer | Anti-pattern to avoid`) gets 7 matching rows — the "Context ... must ground" column changes from a forward-looking question (as in `change.md`) to a backward-looking statement of what was *found*, since that grounding is now done; "Likely cheapest layer" stays forward-looking (still describes the test not yet written).

#### 3. Test Plan — Phased Rollout (§3)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the stale 4-phase table (pointing at the non-existent `testing-bootstrap-pipeline-units` folder, covering pre-implementation risks) with the corrected 4 phases, each carrying this session's scope decisions.

**Contract**: §3's phase table (`# | Phase name | Goal | Risks covered | Test types | Status | Change folder`), all 4 rows `Status: not started`, `Change folder: —`. Add a short scope note under the table (or as an extra "Scope notes" column, whichever renders more clearly given the existing table width) spelling out, per phase:
- Phase 1 ("Notification/evaluation pipeline regression audit"): risks #1, #2; includes the `resend.ts` fix (Key Discovery #1) and the Yahoo-fetch pattern check (Key Discovery #4).
- Phase 2 ("Multi-provider + admin-delete data integrity"): risks #3, #5; includes the one-time manual remote-D1 check (Key Discovery #2).
- Phase 3 ("Frontend test bootstrap"): risk #4; uses Vitest, not Karma (Key Discovery #3).
- Phase 4 ("Abuse-lens closure + local quality-gate hook"): risks #6, #7, plus the still-open local post-edit hook; drops the CI-wiring item since it's already enforced (per `research.md`'s CI correction).

#### 4. Test Plan — Stack (§4)

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Angular component tests row from "none yet" to name the decided tool, and refresh the grounding-tools freshness block.

**Contract**: §4's stack table row for "Angular component tests" changes to `Vitest (not Karma — see Key Discovery #3)`, `latest`, with a short note that `tsconfig.spec.json` already anticipates this and no separate Angular-specific test runner is being introduced. The "Stack grounding tools (current session)" block's `checked:` dates update to today; tool availability notes stay as previously recorded (still none available) unless this session used one (it did not).

#### 5. Test Plan — Quality Gates (§5)

**File**: `context/foundation/test-plan.md`

**Intent**: Correct the gates table so "lint + typecheck" and "unit + integration (Worker)" reflect that they are already enforced today, not planned for after a future phase.

**Contract**: §5's gates table — "lint + typecheck" and "unit + integration (Worker)" rows: `Required?` becomes `required — enforced via Cloudflare Workers Builds status check on main`, replacing the old `required after §3 Phase 1` wording; "Where" stays `local + CI` but the CI half should name the Workers Build explicitly so a future reader doesn't have to re-discover it via `gh api`. The "post-edit hook" row keeps its existing `recommended after §3 Phase 1` / not-yet-implemented status — this is the one gate that's still genuinely open per `research.md`.

#### 6. Test Plan — Negative Space (§7)

**File**: `context/foundation/test-plan.md`

**Intent**: Correct the first bullet, which currently claims "no Angular components with business logic exist yet" — `research.md` found the Alert Form has custom validators and cross-field dynamic validation, which is business logic.

**Contract**: §7's first bullet — replace the outdated premise with the corrected one: component tests are deferred to Phase 3 not because there's no business logic to test, but because the tooling decision (Vitest, Key Discovery #3) needed resolving first and Phase 3 hasn't started yet. Keep the rest of the bullet's spirit (re-evaluate scope once the phase ships) intact.

#### 7. CLAUDE.md — Commands section correction

**File**: `CLAUDE.md`

**Intent**: The `npm test` line in the Commands section currently claims "Karma unit tests," which `research.md` found to be false (no Karma package exists; `ng test` would fail outright today). Correct it so this doc doesn't keep asserting something a future agent would have to re-debunk.

**Contract**: The one-line comment next to `npm test` in the Commands code block — change from claiming Karma to accurately stating that no test target is currently configured (or, if the reader wants forward-looking framing, note that Angular component testing is planned via Vitest per `test-plan.md` §4, once Phase 3 of the test rollout ships).

### Success Criteria

#### Automated Verification:

- [ ] `test-plan.md` renders as valid Markdown with no broken table syntax (visual check via Read — no Markdown linter is configured in this repo)
- [ ] No remaining reference to the non-existent folder: `grep -r "testing-bootstrap-pipeline-units" context/foundation/test-plan.md` returns nothing
- [ ] No remaining stale hot-spot figure: `grep "17 commits" context/foundation/test-plan.md` returns nothing
- [ ] `CLAUDE.md` no longer claims Karma as the active test runner: `grep -i karma CLAUDE.md` returns nothing (or only a corrected/historical framing, never a present-tense claim that it's in use)

#### Manual Verification:

- [ ] Read the full updated `test-plan.md` top to bottom; confirm every risk row and Risk Response Guidance row traces to a specific `research.md` finding
- [ ] Confirm all 4 rollout-phase scope notes match the six Key Discoveries above
- [ ] Confirm §5's gate table doesn't overclaim — it should credit the existing Cloudflare Workers Builds gate without implying the local post-edit hook exists yet

## Testing Strategy

Not applicable — this is a documentation-only change. No test suite covers Markdown content; verification is the automated grep checks plus the manual read-through above.

## References

- Research: `context/changes/test-plan-refresh-2026-08-22/research.md`
- Document being replaced (in place): `context/foundation/test-plan.md`
- Original risk map and phase proposal: `context/changes/test-plan-refresh-2026-08-22/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rewrite test-plan.md and correct CLAUDE.md

#### Automated

- [x] 1.1 test-plan.md renders as valid Markdown with no broken table syntax
- [x] 1.2 No remaining reference to `testing-bootstrap-pipeline-units`
- [x] 1.3 No remaining stale "17 commits" figure
- [x] 1.4 CLAUDE.md no longer claims Karma as the active test runner

#### Manual

- [x] 1.5 Full read-through of updated test-plan.md confirms every risk/coverage/gate claim traces to research.md
- [x] 1.6 All 4 rollout-phase scope notes match the six Key Discoveries
- [x] 1.7 §5's gate table doesn't overclaim the local post-edit hook's status
