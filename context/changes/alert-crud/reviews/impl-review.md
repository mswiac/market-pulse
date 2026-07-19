<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alert CRUD (S-02)

- **Plan**: context/changes/alert-crud/plan.md
- **Scope**: Phases 1-4 (all)
- **Date**: 2026-07-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated verification (run directly this session)

- `npm run typecheck` — PASS
- `npm run test:worker` — PASS (4 files, 30 tests)
- `npm run build` — PASS
- `npm run migrate:local` — PASS ("No migrations to apply" — already applied)

## Findings

### F1 — Silent failure on initial alert-list load

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/alerts/alert-list/alert-list.ts:50
- **Detail**: `this.alertsService.list().subscribe()` has no error callback. If `GET /api/alerts` fails (network blip, D1 timeout, session expiry), the failure is swallowed silently — the user sees "Brak alertów", indistinguishable from actually having zero alerts. Every other user-facing request in this codebase surfaces an error; this is the one silent gap.
- **Fix**: Add an error callback to the subscribe call that sets a load-error signal, surfaced in the template as a short Polish message (e.g. "Nie udało się wczytać alertów.").
- **Decision**: FIXED — added `loadError` signal in `alert-list.ts`, error callback on `list().subscribe()`, template shows "Nie udało się wczytać alertów." and suppresses the empty-state/list when in error state.

### F2 — Phase 4 marked done without a commit; branch has substantial uncommitted work

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/alert-crud/plan.md Progress §Phase 4 / working tree
- **Detail**: Progress rows 4.1/4.2 are `[x]` with no `— <sha>` suffix — the phase-end commit ritual never ran for Phase 4. All of Phase 4 (alert-form.ts/html/scss, home.ts/html dialog wiring) plus every post-Phase-4 UI refinement (sorting, grid layout, colors, FAB, decimal formatting, welcome-card width) is uncommitted in the working tree. Automated checks (typecheck/tests/build) all pass against this uncommitted state, confirmed directly this session.
- **Fix**: Run the Phase 4 commit ritual now (or a single consolidated commit covering Phase 4 + the UI-polish work), writing the SHA back into rows 4.1/4.2.
- **Decision**: FIXED — committed as `e0ba3a6` (Phase 4 + UI polish), SHA written back into Progress rows 4.1/4.2.

### F3 — Plan's Phase 3/4 text no longer describes the shipped UI

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Scope Discipline
- **Location**: context/changes/alert-crud/plan.md Phase 3 §2, Phase 4 §2
- **Detail**: Actual alert-list.ts/html/scss and home.ts/html carry substantial functionality never described in the plan text: column sorting (instrument/type/threshold with direction toggle), CSS grid column alignment, M3 color-token styling, an extended FAB instead of a plain button, and 2-decimal formatting. None of this contradicts "What We're NOT Doing," so it isn't scope creep in a concerning sense — but the plan document is now a stale description of Phase 3/4's actual contract.
- **Fix**: Add a short addendum to Phase 3/4 "Changes Required" noting the UI-polish additions, so the plan stays an accurate record.
- **Decision**: FIXED — added addendum paragraphs to Phase 3 item 2, Phase 4 item 1, and Phase 4 item 2 in plan.md describing the sorting/grid/color/FAB/decimal/blur-formatting/spacing additions.

### F4 — Defensive CHECK-constraint fallback path untested

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Success Criteria
- **Location**: src/worker/routes/alerts.ts:105-107
- **Detail**: The `CHECK constraint failed` → 400 branch is unreachable through the public API (app-level validation already rejects VIX+RSI first) and has no test exercising it directly. Not a bug — it's documented defense-in-depth — just an untested code path.
- **Fix**: Optional — add a unit test that bypasses app validation (direct D1 insert) to confirm the catch branch's message match still works, or accept as-is.
- **Decision**: FIXED — added a test in `alerts.test.ts` that inserts VIX+RSI directly via `env.DB` (bypassing the route), asserting the DB throws with a message matching `CHECK constraint failed` — confirming the assumption the route's catch branch (alerts.ts:105-107) relies on.

## Sub-agent evidence (verbatim)

### Agent 1 — Plan Drift Detection

All verified. Here is the review.

#### Phase 1 — Database schema

**`migrations/0005_create_alerts.sql`** — MATCH. All columns, types, defaults, `UNIQUE(user_id, instrument, alert_type, threshold)`, `CHECK (NOT (instrument = 'VIX' AND alert_type = 'RSI'))`, and `idx_alerts_user_id` index present exactly as planned (`migrations/0005_create_alerts.sql:1-14`).

#### Phase 2 — Backend API

- **`src/worker/lib/email.ts`** — MATCH. Exports `EMAIL_PATTERN` and `normalizeEmail(email: unknown): string | null` exactly as specified (lines 1-7).
- **`src/worker/routes/auth.ts`** — MATCH. Imports `EMAIL_PATTERN`/`normalizeEmail` from `../lib/email` (line 4), local definitions removed, no other behavior changed.
- **`src/worker/routes/alerts.ts`** — MATCH. `alertsRoutes.use('*', sessionMiddleware)` at module level (line 16); validation helpers match spec (lines 18-36); VIX+RSI rejected with 400 before insert (lines 85-87); `POST /` validates fields independently, inserts scoped to `c.get('userId')`, uses the exact `RETURNING`/`SELECT` column aliasing (line 56-57, 92-98, 115-117), 201 on success; UNIQUE→409 `duplicate alert` (lines 102-103); CHECK failure→400 VIX/RSI message (lines 105-107); `GET /` uses correct ordering, returns array (200), empty array allowed.
- **`src/worker/index.ts`** — MATCH. `app.route('/api/alerts', alertsRoutes)` mounted (line 14) before the SPA catch-all (line 22).
- **`test/worker/alerts.test.ts`** — MATCH. Covers all planned cases. Note: the defensive CHECK-triggered 400 path (unreachable via API validation) is not separately tested — reasonable, since it's explicitly described as unreachable defense-in-depth (see F4 above).

#### Phase 3 — Frontend list

- **`alerts.service.ts`** — MATCH. `Alert` interface has all 7 planned fields (lines 5-13); private signal + `.asReadonly()` (lines 26-27); `list()` GET+tap-set (line 30); `create()` POST+tap-prepend (lines 33-37).
- **`alert-list/alert-list.ts/.html/.scss`** — MATCH on core contract: standalone `app-alert-list`, uses `MatExpansionModule`/`MatIconModule`, injects `AlertsService`, `list().subscribe()` in constructor (line 50), accordion rendering, empty-state text exact match (`alert-list.html:45`), current-RSI row gated to NASDAQ100+RSI only (`showCurrentRsi`, `alert-list.ts:70-72`, used at `alert-list.html:37-39`).
  - EXTRA (documented iterative polish, as expected): column sort with toggle direction and arrow icons (`alert-list.ts:17-18,30-60`, `alert-list.html:1-21`); CSS grid header/summary layout (`alert-list.scss:25-33,62-68`); threshold formatted via `DecimalPipe` `1.2-2` (`alert-list.html:31`); date formatting via `DatePipe` (`alert-list.html:41`); Material-token-based color styling (`alert-list.scss:10-23`).
- **`home.ts`/`home.html`** — MATCH. `AlertList` imported (line 10, used at `home.html:24`); Polish translations present verbatim; placeholder replaced with `<app-alert-list />`.

#### Phase 4 — Frontend creation dialog

- **`alert-form/alert-form.ts/.html/.scss`** (untracked, read from disk) — MATCH on functional contract: `MatDialogRef<AlertForm>` injected (line 34); form group fields/validators match (lines 38-43); all four Polish messages present verbatim; VIX→RSI-option-omitted via `@if (showRsiOption())`, not merely disabled; instrument→VIX while alertType=RSI resets to PRICE (ts:49-53); submit error mapping correct (ts:97-108); `submitting.set(false)` on error keeps dialog open and interactive, never silently stuck.
  - DOCUMENTED DEVIATION (accepted, not drift): plan text says the error mechanism should mirror `register.ts`'s `setErrors`+`markAsTouched()`; actual code uses a `formError` signal + banner, matching `login.ts`'s pattern instead. Behavior verified intact.
- **`home.ts`/`home.html`** dialog trigger — MATCH on mechanism: `MatDialog` injected (ts:21), `openNewAlertDialog()` calls `this.dialog.open(AlertForm, { width: '32rem' })` (ts:29-31).
  - DOCUMENTED DEVIATION (accepted, not drift): plan specifies a plain button; actual is an extended FAB — intentional UI iteration.

No MISSING files found; all ~13 planned artifacts exist and were verified against disk content (not git history), including the untracked `alert-form/` directory.

### Agent 2 — Safety, Quality & Pattern Compliance

Migration numbering is correct and sequential. Report follows.

**src/app/features/alerts/alert-list/alert-list.ts:50** — reliability/pattern, WARNING. `this.alertsService.list().subscribe()` has no error callback. See F1 above.

**src/worker/routes/alerts.ts:105-107**, data-safety/reliability, OBSERVATION. The `CHECK constraint failed` catch branch is unreachable through the public API. See F4 above.

**src/worker/routes/alerts.ts / test/worker/alerts.test.ts**, data-safety, OBSERVATION (positive). `.bind()` is used correctly everywhere, no string concatenation with user input. `UNIQUE`/`CHECK` enforced both in DB and app code; `sessionMiddleware` mounted via `alertsRoutes.use('*', sessionMiddleware)` covers every route; cross-user isolation test confirms no data leakage. No missing-authz or injection issues found.

**src/worker/routes/auth.ts / src/worker/lib/email.ts**, pattern, no finding. `EMAIL_PATTERN`/`normalizeEmail` cleanly extracted with no behavior change (verified via `git diff` — pure move); `alerts.ts` reuses the same functions and mirrors `auth.ts`'s message-substring UNIQUE-detection style.

**src/app/features/alerts/alerts.service.ts vs core/auth/auth.service.ts**, pattern, no finding. Same shape: private writable signal + `.asReadonly()`, `tap()` to sync state, no leak given components live for the session.

**src/app/features/alerts/alert-form/alert-form.ts vs register.ts/login.ts**, pattern, no finding. The deliberate deviation (single `formError` signal/banner) is applied consistently: banner renders reliably on any submit error, submit button disabled via `[disabled]="form.invalid || submitting()"` while in-flight, `submitting` correctly reset to `false` in the error path. No follow-on breakage.

**migrations/0005_create_alerts.sql**, data-safety, no finding. Numbered correctly after `0004_sessions_cascade_delete.sql`; `ON DELETE CASCADE` and both constraints appropriate; no destructive operations.

**CLAUDE.md / prd.md / roadmap.md diffs**, no finding. Only the stated Polish-UI-carve-out and FR-004/S-02 VIX-RSI-restriction notes changed; nothing unrelated slipped in.

No CRITICAL findings. One WARNING (silent list-load failure), two OBSERVATIONs (unreachable-but-harmless CHECK fallback path; a positive confirmation note on the auth/alerts security posture).
