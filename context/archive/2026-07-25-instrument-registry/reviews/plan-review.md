<!-- PLAN-REVIEW-REPORT -->
# Plan Review: F-03: Instrument Registry Implementation Plan

- **Plan**: context/changes/instrument-registry/plan.md
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE (before fixes) → SOUND (after triage)
- **Findings**: 2 critical, 1 warning, 0 observations — all fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

Grounding: 8/8 paths ✓, 5/5 symbols ✓, brief↔plan ✓ (no `docs/reference/contract-surfaces.md` in this repo — check skipped)

## Findings

### F1 — Phase blocks use `- [ ]` checkboxes instead of plain bullets

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 & Phase 2 — Success Criteria sections
- **Detail**: Every Success Criteria bullet in both Phase blocks was written as `- [ ] ...`. Per the canonical contract, Phase blocks must use plain `- ` bullets — only the bottom `## Progress` section owns checkbox state. Risked `/10x-implement` failing to parse the plan correctly.
- **Fix**: Strip `[ ]` from every Success Criteria bullet in both Phase blocks, leaving plain `- ` bullets. The `## Progress` section was already correct.
- **Decision**: FIXED

### F2 — Automated verification command doesn't check the code being changed

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 & Phase 2 — Automated Verification
- **Detail**: Both phases listed `npm run build` (= `ng build`, Angular-only) as the type-checking gate, but this plan changes only `src/worker/**`. `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.worker.json`) is the command that actually covers `tsconfig.worker.json`'s scope (`src/worker/**/*.ts`, `test/**/*.ts`). The plan could show a green checkbox with real type errors in the changed code.
- **Fix**: Replace `npm run build` with `npm run typecheck` in both phases' Automated Verification and the matching Progress titles (1.3, 2.2).
- **Decision**: FIXED

### F3 — New unguarded top-level query in the cron handler

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1, Change #3 — Cron refactor (`scheduled.ts`)
- **Detail**: `Object.keys(YAHOO_SYMBOLS)` (today) can never throw — every failure in `handleScheduled` is already isolated per-instrument inside the loop's try/catch. The plan's replacement, `SELECT ticker, rsi_eligible FROM instruments WHERE provider = 'yahoo'`, runs before the loop with no try/catch — a failure there (e.g. remote migration not yet applied when the cron fires, a risk this same plan's Migration Notes already flags) throws out of `handleScheduled` entirely, silently skipping every instrument that day with an unhandled exception instead of a logged, isolated failure.
- **Fix A ⭐ Recommended**: Wrap the instruments query in its own try/catch that logs and returns early, matching the per-instrument logging pattern already used in the loop.
  - Strength: Matches the existing failure-handling pattern in this function; a bad query becomes visible in logs instead of an unhandled rejection.
  - Tradeoff: One more try/catch block; net data outcome on failure is unchanged either way — this only improves observability.
  - Confidence: HIGH — directly grounded in the existing try/catch pattern at `scheduled.ts:26-49`.
  - Blind spot: Doesn't address the underlying deploy-ordering risk (migration must land on remote D1 before the cron fires) — that's an ops step, already flagged in Migration Notes.
- **Fix B**: Accept as-is, no plan change.
  - Strength: Zero extra code; if D1 is genuinely down, per-instrument writes would fail anyway, so the net data outcome is identical.
  - Tradeoff: Loses the one clear per-instrument log line for the specific case where the query itself (not the writes) fails.
  - Confidence: MED — plausible this scenario is rare enough not to matter in practice.
  - Blind spot: Whether Cloudflare's cron infrastructure surfaces an unhandled `scheduled()` rejection anywhere visible wasn't verified.
- **Decision**: FIXED (via Fix A)
