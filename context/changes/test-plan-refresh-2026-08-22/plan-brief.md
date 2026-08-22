# Test Plan Refresh (2026-08-22) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-08-22/plan.md`
> Research: `context/changes/test-plan-refresh-2026-08-22/research.md`

## What & Why

`context/foundation/test-plan.md` was written 2026-06-28, before implementation started. All 18 roadmap slices are now `done`, and the plan's 6-risk map, hot-spot data, and phase table describe a codebase that no longer exists. This change rewrites `test-plan.md` against the current, research-grounded state so the next rollout phase can pick it up without re-deriving what's already known.

## Starting Point

`test-plan.md`'s §3 points at a change folder (`testing-bootstrap-pipeline-units`) that was never created — the real backend test suite (12 files, 2918 lines) shipped ad hoc. Its risk map covers pre-implementation hypotheticals. `research.md` (this change's prior artifact) grounded a refreshed 7-risk map against current code with file:line evidence, and corrected one of its own findings mid-conversation: CI is already enforced via Cloudflare Workers Builds (build command `npm run ci`), not unenforced as first concluded.

## Desired End State

`test-plan.md` accurately describes today's codebase: 7 risks with grounded Risk Response Guidance, a Quality Gates section that credits the existing Cloudflare gate, a Stack section naming Vitest (not Karma) for Angular tests, and 4 rollout phases with corrected scope. `CLAUDE.md`'s Commands section stops claiming a Karma runner that doesn't exist.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Resend fix scope (risk #2) | Phase 1 includes fixing the uncaught-`fetch`-throw gap in `resend.ts`, not just testing it | It's a real, small, currently-unguarded code gap behind the user's top-stated concern | Plan |
| Remote D1 verification (risk #5) | One-time manual `wrangler d1 execute --remote` check in Phase 2, not automated CI | Matches existing project convention; automating it is disproportionate to a low-frequency admin action | Plan |
| Angular test tooling (risk #4) | Vitest, not Karma, for Phase 3 | `tsconfig.spec.json` already anticipates Vitest globals; avoids a second test runner in the repo | Plan |
| Yahoo-fetch pattern check | Folded into Phase 1 as a quick check alongside the resend.ts fix | Same failure shape as the resend.ts gap; cheap to verify while already in that code | Plan |
| Rollout structure | Keep 4 phases; drop the "wire `npm run ci`" item from Phase 4 | Research confirmed that gate is already enforced via Cloudflare Workers Builds | Plan |
| Rollout priority | Phase 1 (notification pipeline) called out as top priority if sequencing is forced | Covers the top-stated user concern and the one confirmed real code gap | Plan |
| CI gate status (§5) | Credit "lint + typecheck" and "unit + integration" as already-enforced, not future work | Corrected finding: Cloudflare Workers Builds required status check already runs `npm run ci` on every merge to `main` | Research |

## Scope

**In scope:**
- Rewriting `context/foundation/test-plan.md` §1, §2, §3, §4, §5, §7, §8 (§6 stays `TBD`)
- One-line correction to `CLAUDE.md`'s `npm test` comment

**Out of scope:**
- Any actual test code (RSI oracle tests, Resend assertions, remote-D1 check execution, Angular component tests)
- The `resend.ts` `try/catch` fix itself (decision recorded here; code change happens in Phase 1's future implementation change)
- Vitest+Angular tooling bootstrap (decision recorded here; setup happens in Phase 3's future change)
- Any other stale documentation beyond the one identified `CLAUDE.md` line

## Architecture / Approach

Single-phase documentation edit. The existing 8-section `test-plan.md` template is preserved — only content changes. Every claim in the rewrite must trace to a specific `research.md` finding, so the document stays self-verifying for the next reader (human or agent).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Rewrite test-plan.md + correct CLAUDE.md | Fully refreshed test-plan.md (§1–§5, §7, §8) and an accurate CLAUDE.md Commands line | Missing a stale claim that should have been corrected but wasn't caught by the grep checks |

**Prerequisites:** `research.md` complete (done); this session's 6 planning decisions confirmed (done).
**Estimated effort:** ~1 session, single phase — this is a documentation edit, not code.

## Open Risks & Assumptions

- The manual remote-D1 verification (risk #5, Phase 2) and the Vitest+Angular tooling setup (risk #4, Phase 3) are both deferred decisions-only here — if either turns out harder than expected once actually attempted, the corresponding phase's future plan will need to revisit scope.
- The `resend.ts` fix is scoped into Phase 1 now; if it turns out to need more than a small `try/catch` (e.g. retry logic, alerting), Phase 1's future plan should flag that as a scope change, not silently expand.

## Success Criteria (Summary)

- `test-plan.md` no longer references the non-existent `testing-bootstrap-pipeline-units` folder or the stale "17 commits" figure
- Every risk, coverage, and gate claim in the rewritten document traces to a specific `research.md` finding
- `CLAUDE.md` no longer claims Karma is the active test runner
