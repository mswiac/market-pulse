---
change_id: test-plan-refresh-2026-08-25
title: Refresh test-plan.md - mutation sweep + admin panel coverage gap
status: archived
created: 2026-08-25
updated: 2026-08-25
archived_at: 2026-08-25T20:04:19Z
---

## Notes

Refresh of context/foundation/test-plan.md, triggered by explicit user request
(not the 3-month staleness rule — last refresh was 2026-08-22, 3 days ago).

Trigger signal: a full-repo Stryker mutation-testing triage (#91, commits
8a2884f..07bef80, 2026-08-24/25) closed coverage gaps across all 14
src/worker/** modules (session.ts, auth.ts, scheduled.ts, admin.ts, index.ts,
email.ts, market-data.ts, password.ts, alert-evaluation.ts, alerts.ts,
trigger-events.ts, admin-lib.ts, resend.ts, rsi.ts) — test-only commits, no
production code changed. This matured the backend test-base significantly in
a way test-plan.md §4/§7/§8 does not yet reflect.

New risk surfaced by user interview (Phase 2, 2026-08-25):

Risk #8 — Admin panel (Angular) has zero component-test coverage.
6 components (admin-panel, add-instrument, remove-instrument,
remove-instrument-confirm, remove-user, remove-user-confirm) handle
destructive admin-only actions (instrument/user removal — backend cascade
already verified via risk #5/#6) and type-driven form logic
(add-instrument's type→provider mapping, currency requirement), with no
test proving the UI wiring (confirm/cancel dialogs, payload sent to the
service, form validation) actually behaves as coded.

- Impact: High — destructive/irreversible actions; a UI wiring bug could
  trigger delete against the wrong target or bypass confirmation.
- Likelihood: Medium — 5 commits/30d in src/app/features/admin/ (S-09..S-12,
  all shipped in the last 3 weeks), zero test coverage, same
  "richest-untested-surface" pattern that previously justified closing old
  risk #4 (Alert Form) via §3 Phase 3.
  "admin panel" specifically as least-confident-to-change area); hot-spot
  churn (5 commits/30d in src/app/features/admin/); roadmap S-11 risk note
  (no FK safety net — cleanup logic implemented explicitly in the delete
  endpoint, so UI must send the right target).

Risk Response Guidance — Risk #8:
- Prove: confirm/cancel dialogs call the delete service only on explicit
  confirmation; add-instrument's type→provider mapping and required-field
  validation (ticker/name/currency, trimmed) reject invalid input before
  the API call — mirroring what Alert Form/Register (§6.5) already prove.
- Must challenge: "it's just a confirm dialog, too simple to break" —
  nothing today proves the UI sends the right id/payload or that the
  dialog can't be bypassed.
- Context needed: exact MatDialogRef/ActivatedRoute injection points per
  component (§6.5 already flags these as easy-to-miss); payload each admin
  service method sends; whether add-instrument has cross-field logic beyond
  simple required-field validation.
- Likely cheapest layer: component tests via Vitest +
  @testing-library/angular/zoneless — same tooling/pattern as §6.5, no new
  infra.
- Anti-pattern to avoid: shallow "renders without crashing" tests that
  don't assert on the actual confirm/cancel call or payload sent.

Proposed rollout phase (to append to §3 as Phase 5):
"Admin panel component coverage" — component tests (Vitest) for the 6
admin-panel components, closing risk #8. Change-id: this folder.

Documentation corrections to fold into this phase's final plan sub-phase
(not a separate phase):
- §4 Stack: fix the Angular row's stale "none yet" wording (Phase 3 shipped).
- §7/§8 Freshness Ledger: record the #91 mutation-testing sweep as a
  completed milestone (test-only, no risk-map change) and bump the
  reviewed date.
