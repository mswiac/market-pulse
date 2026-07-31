# Alert Notifications (S-05) — Plan Brief

> Full plan: `context/changes/alert-notifications/plan.md`

## What & Why

MarketPulse's daily cron fetches market data and computes RSI, but nothing evaluates alerts against it yet. This plan closes the loop: the cron checks every active alert against the day's price/RSI, sends an email via Resend when the user-chosen direction's threshold is crossed, and records the outcome — so a user who set an alert once actually gets notified, without checking charts daily (the product's core pitch, per `context/foundation/prd.md`).

## Starting Point

Alert CRUD, market data pipeline, and RSI calculation are all done (S-02, S-03, S-04, F-02). The cron only writes `price_history`/`market_data` today (`src/worker/scheduled.ts:25-62`); `alerts` has no direction or state field; Resend is completely unwired (no SDK, no API key, no `Env` binding).

## Desired End State

Users pick a direction ("rises above" / "falls below") when creating or editing an alert. The list shows whether an alert is currently active (waiting) or inactive (already fired, waiting to re-arm), with a grayed-out header for inactive ones. Each day, alerts whose condition is newly met get an email and a permanent `trigger_events` record; alerts that already fired only re-arm once the value retreats meaningfully past the threshold, so a value hovering right at the line doesn't spam the inbox.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Crossing detection | Explicit `direction` field + `armed` state on `alerts`, computed server-side | Pure day-over-day comparison couldn't distinguish "watching for a rise" from "watching for a fall," and the user wanted direction to be user-visible/settable rather than silently inferred |
| Re-arm buffer | 10% of threshold (both price and RSI) | Matches general hysteresis/deadband practice for threshold alerting; the user's initial 1% guess was verified against research to be too tight to meaningfully suppress noise |
| Trigger recording | Always write `trigger_events`; track `email_status` separately | Decouples the NFR-critical crossing-detection correctness from Resend's availability |
| Failure handling | Best-effort per alert (catch and continue) | Matches the existing per-ticker error handling already in `scheduled.ts`; one bad alert can't block everyone else's notifications |
| Resend setup | Stay on the sandbox (no custom domain); pre-flight recipient check instead of parsing API errors | Verified with Resend's docs that no paid plan removes the domain-verification requirement; a course project doesn't need delivery to arbitrary recipients, and a self-checked recipient comparison is more robust than depending on a third-party error message's wording |
| Email content | Plain text, mirrors the alert list's existing fields/labels exactly | Consistency with the app the user already sees, zero new design/formatting work |
| Resend client | Raw `fetch`, no SDK | Matches how the rest of the backend calls external providers (Yahoo Finance), avoids `nodejs_compat` SDK edge cases |
| Demo data for grading | Left to the user, out of scope for this plan | The user will create their own test account and pre-trigger alerts manually; no seeding tooling needed |

## Scope

**In scope:**
- `alerts` schema: `direction`, `armed` columns; extended `UNIQUE` constraint; new `trigger_events` table
- Backend: direction validation, server-computed `armed`, evaluation/notification logic wired into the cron
- Resend client (fetch-based) with sandbox pre-flight check
- Frontend: direction selector in the alert form; active/inactive status + styling in the alert list
- Documentation of the two new required secrets and the sandbox limitation

**Out of scope:**
- Custom domain / Resend domain verification (sandbox-only delivery)
- Retry logic for failed sends
- Demo/seed data tooling
- S-06 (trigger history UI) — this plan only creates and populates `trigger_events`

## Architecture / Approach

The cron gains a second stage, `evaluateAlerts()`, called after the existing market-data loop so it always reads that day's fresh values. Each alert carries its own `direction` and `armed` state, computed once at create/edit time and mutated in place by the evaluation loop (fire → disarm; retreat past margin → re-arm). Email sending is a small, dependency-free wrapper around Resend's REST API with a pre-flight recipient check that skips the network call entirely for non-verified recipients.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema and migration | `direction`/`armed` on `alerts`, `trigger_events` table | Rebuilding `alerts` drops the RSI-eligibility triggers from migration 0009 unless explicitly recreated |
| 2. Backend alert CRUD updates | Direction validation, server-computed `armed` | Must read `market_data` at create/edit time, not just at evaluation time |
| 3. Resend integration | Fetch-based email client, sandbox pre-flight check | Requires a manual, human-only step (Resend account + API key) before this phase can be verified |
| 4. Cron evaluation and notification logic | Fire/re-arm state machine, `trigger_events` recording | Getting the margin/direction boundary conditions exactly right (tested explicitly) |
| 5. Frontend: alert form and list | Direction selector, active/inactive UI | Keeping to existing Material tokens rather than introducing new colors |
| 6. Documentation | Updated infra doc | Low risk — documentation only |

**Prerequisites:** A Resend account and API key (manual, human-only — no automation possible for account creation).
**Estimated effort:** ~2-3 sessions across 6 phases.

## Open Risks & Assumptions

- The `armed` default for pre-existing alerts backfilled by the migration is a best-effort approximation (no historical "value at creation" exists for rows created before this feature) — a small number of already-existing alerts may start in an unexpected armed/disarmed state until their first natural crossing.
- Sandbox-only Resend delivery means only the account owner's own email can ever receive a real notification; anyone else evaluating the feature (e.g., a grader) will see `trigger_events` with `email_status = 'failed'` rather than an actual email, by design.

## Success Criteria (Summary)

- A user can pick a direction on an alert and see whether it's currently active or inactive.
- An alert whose condition is crossed sends an email (to the verified address) and is recorded in `trigger_events`, exactly once per crossing, with correct re-arm behavior after a 10%-margin retreat.
- One failing alert (bad recipient, transient error) never blocks evaluation of the rest.
