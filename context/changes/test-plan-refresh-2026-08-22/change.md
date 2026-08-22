---
change_id: test-plan-refresh-2026-08-22
title: Refresh test-plan.md against post-implementation codebase state
status: implemented
created: 2026-08-22
updated: 2026-08-22
archived_at: null
---

## Notes

Refresh context/foundation/test-plan.md — the guide was written 2026-06-28 during pre-implementation planning; all 18 roadmap slices (F-01–F-04, S-01–S-12) are now `done`. This change re-derives the risk map, hot-spot data, test-base profile, and rollout phases against the current codebase state, then updates test-plan.md.

What's stale in the current guide:
- §3 references change folder `testing-bootstrap-pipeline-units`, which does not exist on disk; the described tests instead landed ad hoc (12 files, 2918 lines in test/worker/, meaningful backend coverage).
- Hot-spot scan previously had insufficient signal (3 commits/30d); now 17 commits/30d show `src/app/features` (Angular frontend) as the highest-churn area in the repo — the frontend did not exist when the guide was written.
- Original risk map covered pre-implementation hypotheticals; actual shipped features (multi-provider fetch via ticker+suffix, cascading admin deletes, daily high/low evaluation) introduce different, now-verifiable risks.

Refreshed risk map (7 risks, ordered by impact × likelihood). Source discipline unchanged: evidence only (PRD/roadmap/interview/hot-spot), never file:line anchors — that grounding is /10x-research's job.

1. Regression risk in src/worker/lib (rsi.ts, alert-evaluation.ts, market-data.ts) from the S-08 high/low evaluation change — user named this file set as the least-confident area (interview); highest backend churn (14 touches/30d).
2. Silent notification failure — cron completes without error but Resend doesn't send, or sends a duplicate — user's top stated concern; PRD NFR; roadmap S-05 risk note.
3. Multi-provider fetch integrity (Yahoo + .WA suffix for GPW, self-correcting currency) — roadmap F-04 explicitly flagged the ticker-vs-suffix split as capable of silently corrupting price_history/market_data joins without an obvious error.
4. Zero automated frontend coverage (Angular, src/app/features) — user's stated under-tested concern; highest overall repo churn (83 touches/30d); test-base profile for frontend is `none`.
5. Cascading/orphaned deletes in the admin panel (S-11 instrument removal, S-12 user removal) — roadmap left block-vs-cascade as an unresolved unknown for S-11; S-12's cascade was verified only against local D1, not remote.
6. Cross-user isolation / IDOR across alert and admin endpoints — PRD NFR; abuse lens (authorization/access).
7. Resource abuse via repeated wide-range admin backfill (S-09) against the tight Workers Free CPU budget — abuse lens (resource abuse); roadmap F-02 risk note on CPU budget.

Risk Response Guidance per risk (what proves protection / what to challenge / context /10x-research must ground / likely cheapest layer / anti-pattern to avoid):

- #1: prove conditionMet matches an externally-sourced expected result, not the implementation's own output (oracle problem); ground which lookback/seed logic changed in S-08; cheapest layer unit (verify existing coverage, don't assume).
- #2: prove Resend is called exactly once with correct args when threshold crosses, and trigger_events dedups correctly after S-08; ground how Resend SDK errors surface; cheapest layer integration with a Resend stub.
- #3: prove price_history/market_data always key on bare ticker, never ticker+suffix, across all instrument types; ground exact suffix append/strip point in market-data.ts; cheapest layer unit with mocked Yahoo responses per type.
- #4: prove admin/alert forms reject invalid input before it reaches the API; ground actual validation logic (roadmap notes it may be non-empty-only); cheapest layer first Angular component tests (Karma/Jasmine, matches existing stack).
- #5: prove instrument/user removal on remote D1 behaves identically to local (cascade or block, per documented decision); ground whether PRAGMA foreign_keys=ON is set identically in both environments; cheapest layer integration + a manual remote-D1 check (do not overwrite existing local dev data without asking — project convention).
- #6: prove a request authenticated as one user/non-admin against another user's resource or an admin route returns 403/404; ground which admin routes check ADMIN_EMAILS independently of session validity; cheapest layer integration (partially covered already in auth.test.ts/admin.test.ts — verify, don't assume).
- #7: prove repeated wide-range admin backfill calls don't uncontrollably grow CPU/external calls; ground whether any rate/range limit exists today; cheapest layer unit/integration on boundary date ranges.

Proposed rollout phases (4):
1. Notification/evaluation pipeline regression audit — verify existing tests actually prove protection for risks #1 and #2 post-S-08; close gaps.
2. Multi-provider + admin-delete data integrity — verify risk #3 (suffix/currency) and risk #5 (remote D1 cascade behavior).
3. Frontend test bootstrap (admin panel + alert forms) — first Angular component tests, addressing risk #4.
4. Abuse-lens closure + quality-gate wiring — risks #6 and #7; also wire `npm run ci` (typecheck + test:worker + build) as an actually-enforced gate — it exists in package.json but nothing currently invokes it automatically (no GitHub Actions workflow, no wrangler build hook found).

Downstream continuation: this change proceeds to /10x-research next (not directly to /10x-plan or /10x-implement).
