<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Market Data Pipeline (F-02) Implementation Plan

- **Plan**: `context/changes/market-data-pipeline/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-24
- **Verdict**: REVISE (all findings fixed during triage — see Decisions below)
- **Findings**: 1 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

5/5 paths ✓ (wrangler.toml, package.json, src/worker/index.ts, migrations/0005_create_alerts.sql, test/worker/auth.test.ts), 4/4 symbols ✓ (Env interface, app.route, exports.default.fetch pattern, migrations numbering — 0006/0007 confirmed free via `ls migrations/`), brief↔plan ✓

## Findings

### F1 — Phase blocks use checkbox syntax instead of plain bullets

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All 4 phases — every Success Criteria section (plan.md:105-106,110,138-139,143,171-172,176,228-230,234-235 as originally written)
- **Detail**: Every Success Criteria bullet across all 4 phases used `- [ ]` checkbox syntax instead of plain `- ` bullets. Per the plan-format contract, checkbox state belongs exclusively to the `## Progress` section.
- **Fix**: Strip `[ ] ` from every Success Criteria bullet in Phases 1-4, leaving plain `- ` bullets.
- **Decision**: FIXED — applied via `sed` across lines 1-273, leaving the `## Progress` section's checkbox state untouched.

### F2 — Sequential per-row D1 writes instead of env.DB.batch()

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 — scheduled handler contract
- **Detail**: The handler upserted every `{date, close}` individually — ~20-30 sequential awaited D1 calls per instrument (60+ round-trips per cron run) — instead of using D1's `env.DB.batch()`, which handles exactly this case in one round-trip with implicit-transaction atomicity. No existing codebase precedent either way (alerts.ts is single-row only).
- **Fix A ⭐ Recommended**: Use `env.DB.batch()` for the price_history + market_data upserts per instrument.
  - Strength: One round-trip instead of ~20-30; all-or-nothing atomicity per instrument.
  - Tradeoff: First use of D1's batch API in this codebase — a new pattern to establish.
  - Confidence: MEDIUM — batch() is documented and stable, but unverified at this statement volume in this repo.
  - Blind spot: D1 batch() statement-count/size limits not checked.
- **Fix B**: Keep the sequential per-row loop as originally written.
  - Strength: Matches the codebase's ad hoc, no-abstraction D1 style.
  - Tradeoff: Unnecessary latency, no atomicity.
  - Confidence: HIGH — guaranteed to work, just not optimal.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 4's scheduled handler contract rewritten to batch all writes for an instrument into a single `env.DB.batch([...])` call, with a note to verify D1 batch limits during implementation.

### F3 — Cron Trigger propagation delay not mentioned in verification step

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Manual Verification (post-deploy step)
- **Detail**: `context/foundation/infrastructure.md`'s risk register notes Cron Trigger schedule changes can take up to 15 minutes to propagate; the post-deploy manual verification step didn't mention this, risking a false "it's broken" read on a delayed first run.
- **Fix**: Add a one-line note to the post-deploy manual verification step about the propagation delay.
- **Decision**: FIXED — note added.

### F4 — Scheduled-Worker duration limits not checked against retry design

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 4 — scheduled handler contract (retry wrapper)
- **Detail**: The plan correctly notes Workers' CPU-time billing excludes `fetch()` await time, but that's distinct from any wall-clock/invocation-duration ceiling for scheduled Workers. Worst-case retry timing (up to 6 fetches across both instruments) wasn't checked against current Cloudflare docs.
- **Fix**: Add a note in Phase 4's retry-wrapper contract to spot-check current duration limits during implementation; no design change unless that check finds a real ceiling.
- **Decision**: FIXED — note added.
