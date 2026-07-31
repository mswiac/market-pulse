<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Trigger History Implementation Plan

- **Plan**: `context/changes/trigger-history/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-31
- **Verdict**: REVISE → SOUND after triage (all findings fixed)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 4/4 symbols ✓, brief↔plan ✓ (one citation off by one line — `app.routes.ts:12-14` should be `11-14` — cosmetic, not scored)

## Findings

### F1 — No error signal specified for a failed "load more" request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, Component contract
- **Detail**: Phase 2's Contract listed only one `loadError` signal (set on initial load). It didn't say what happens when a later `loadMore()` call fails. The plan's own cited reference pattern (`instrument-history.ts:52-53,96`) uses two distinct signals — one for the initial/blocking load, one scoped to a secondary action — so a secondary-action failure doesn't wipe already-rendered content.
- **Fix**: Add a second signal (`loadMoreError`) shown as an inline banner alongside existing rows — mirrors `historyError`/`deleteError` conventions elsewhere in the codebase.
- **Decision**: FIXED (applied to plan.md's Phase 2 Contract + Manual Verification + Progress 2.8)

### F2 — Frontend page size unspecified in the plan itself

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Service contract
- **Detail**: The service contract was `list(offset: number, limit: number)` — callers had to supply an explicit `limit`, but Phase 2's Contract never stated what value the component passes, and the endpoint's default (20) only appeared in `plan-brief.md`, not in `plan.md` itself.
- **Fix A ⭐ Recommended (chosen)**: Drop `limit` from the frontend service signature — frontend calls `GET /api/trigger-events?offset=` and relies on the backend's default/clamp as the single source of truth.
- **Fix B (not chosen)**: Define an explicit `PAGE_SIZE = 20` frontend constant matching the backend default.
- **Decision**: FIXED (applied Fix A to plan.md's Phase 2 Service Contract)

### F3 — Offset-based pagination can drift if new rows land mid-browse

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details / Phase 1
- **Detail**: Classic offset-pagination tradeoff — a new `trigger_events` row inserted while a user is mid-"load more" can shift later pages, repeating or skipping a row. Only writer is the once-daily cron, so this is low-probability, but wasn't named when "real pagination" was chosen.
- **Fix**: One-sentence acknowledgment added to Critical Implementation Details.
- **Decision**: FIXED (applied to plan.md's Critical Implementation Details)
