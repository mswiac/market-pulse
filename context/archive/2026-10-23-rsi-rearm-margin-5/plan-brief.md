# Reduce RSI Alert Re-arm Margin to 5 Points — Plan Brief

> Full plan: `context/changes/rsi-rearm-margin-5/plan.md`

## What & Why

Lower the RSI alert re-arm margin from 10 to 5 points (GitHub #230) so a fired RSI alert becomes active again after a smaller retreat from the threshold.

## Starting Point

`RSI_RE_ARM_MARGIN_POINTS = 10` in `src/worker/lib/alert-evaluation.ts` drives re-arming; two worker tests assert the 10-point value. Nothing in docs or UI mentions it.

## Desired End State

A `down` RSI alert at 35 re-arms at RSI >= 40 (was 45); an `up` alert at 70 re-arms at RSI <= 65 (was 60).

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Extreme thresholds (down <= 5, up >= 95) | Leave as is | Same unreachable-re-arm edge case as today; no logic change |
| Docs | None | Nothing references the margin |

## Scope

**In scope:** the constant and the two RSI-margin tests.

**Out of scope:** PRICE margin, per-alert margin, clamping, docs.

## Architecture / Approach

Change one constant; no logic changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Constant + tests | Margin 5, tests updated | Test values must stay discriminating vs a percentage margin |

**Prerequisites:** none
**Estimated effort:** one short session

## Open Risks & Assumptions

- Smaller margin means more frequent re-arming and thus potentially more repeat emails when RSI oscillates around the threshold; accepted by the user's request.

## Success Criteria (Summary)

- Worker tests and build pass with the 5-point behavior.
