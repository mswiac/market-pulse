# Admin can add a new instrument to the registry — Plan Brief

> Full plan: `context/changes/admin-add-instrument/plan.md`

## What & Why

An admin needs a way to grow the `instruments` registry beyond the two hardcoded rows (`^VIX`, `^NDX`) without a manual DB write. This slice adds a form to the existing admin panel — type, ticker, company name, currency, RSI-eligible — so PL- and US-listed equities can be onboarded through the UI. It's the second of two roadmap items (`S-10`) that unlock multi-provider instrument support; the other (`F-04`, Stooq fetch) is separate and not required for this form to work for US instruments.

## Starting Point

The admin panel (`S-09`, done) already exists with one action ("Fetch market data") and was explicitly built to host more. The `instruments` table exists but has no write endpoint — only `GET /api/instruments`. The `type` column is `CHECK`-constrained to `'index'` only.

## Desired End State

An admin opens `/admin`, fills in a second "Add instrument" card, and the new ticker is immediately usable everywhere the registry is already consumed: instrument history, alert creation, and admin backfill — no deploy or manual SQL required.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Type options in the roadmap's combobox | Index / PL companies / US companies, all three addable | Roadmap named all three; user confirmed Index must stay addable | Plan (user, mid-session) |
| RSI-eligible field | Explicit checkbox, default checked, shown for all types | Can't be inferred from type alone — existing VIX (index) has `rsi_eligible=0`; VIX is expected to stay the only exception | Plan (user, mid-session) |
| Currency field | Added to the form (not in the roadmap's original 3-field spec) | `instruments.currency` is `NOT NULL DEFAULT 'USD'` — silently wrong for PL companies without an explicit field | Plan |
| `provider` derivation | Auto from type (`pl_stock`→`stooq`, else `yahoo`) | Mechanical, objective — same pattern as the roadmap already resolved | Roadmap |
| New endpoint's error shape | `{error, code}`, matching `admin.ts` | `alerts.ts`'s alternative (`{error}` + string-matching) was found to be the fragile, older pattern during planning | Plan (user, mid-session) |
| Scope: fix `alerts.ts` too | Yes, same plan, separate phase | User chose to fix the inconsistency now rather than defer it | Plan (user, mid-session) |
| Duplicate ticker handling | 409, catch `UNIQUE` constraint (no pre-check `SELECT`) | Matches the existing `alerts.ts` pattern; avoids a race-prone extra round-trip | Plan (user) |
| `INSTRUMENT_TYPE_LABELS` duplication (3 components) | Extract to one shared constant | Adding 2 new types to 3 separate copies invites drift | Plan (user) |
| Post-insert UI refresh | Invalidate cache + refetch `GET /api/instruments` | Guarantees UI matches server-derived `provider`/`rsi_eligible`, not a client-side guess | Plan (user) |
| Migration technique | Shadow-table (create/copy/drop/rename) | D1/SQLite can't `ALTER` a `CHECK` constraint; repo already has a precedent (`0011_alert_notifications.sql`) | Research |

## Scope

**In scope:** migration widening `instruments.type`; new `POST /api/admin/instruments` endpoint; `alerts.ts` error-code convention fix (backend + its frontend consumer); shared instrument-type label/constant extraction; the new admin-panel form.

**Out of scope:** Stooq fetch support (`F-04` — separate roadmap item); instrument edit/delete; changing `GET /api/instruments`'s response shape; migrating error conventions anywhere beyond `alerts.ts`.

## Architecture / Approach

Bottom-up: schema (Phase 1) → new endpoint that depends on it (Phase 2) → adjacent `alerts.ts` convention fix, backend half (Phase 3) → shared frontend constants + `alerts.ts` convention fix, frontend half (Phase 4) → the new form itself, which needs both the endpoint and the shared constants (Phase 5).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migration | `instruments.type` accepts `pl_stock`/`us_stock` | Shadow-table rebuild on a live table — low risk, well-precedented in this repo |
| 2. Backend endpoint | `POST /api/admin/instruments` with validation + duplicate handling | New error codes must not collide with `/market-data`'s existing codes (shared frontend lookup table) |
| 3. `alerts.ts` codes (backend) | Every `alerts.ts` error response gains a `code` field | None — additive, existing test assertions use `toMatchObject` so they don't break |
| 4. Shared constants (frontend) | One `INSTRUMENT_TYPE_LABELS`/`CREATABLE_INSTRUMENT_TYPES` source; `alert-form.ts` matches on `code` | Missing `messages.pl.xlf` entries fail the Polish build outright, not just a lint warning |
| 5. Add-instrument form | The user-facing feature | Same i18n-catalog risk as Phase 4, larger surface (new card, new checkbox control) |

**Prerequisites:** none — `S-09` and `F-03` (both roadmap prerequisites) are already done.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- Assumes every PL-listed equity is PLN-denominated and every US-listed equity is USD-denominated — true for the two markets this project scopes to, but not enforced beyond the currency field being free text (validated as a 3-letter code, not against the selected type).
- The admin is trusted to enter the exact ticker symbol the instrument's provider (Yahoo or Stooq) expects — the form validates non-empty, not provider-specific syntax (per the roadmap's resolved ticker-format contract). A `pl_stock` ticker's provider (Stooq) has no working fetch until `F-04` lands, so it can be added but won't get data yet.

## Success Criteria (Summary)

- An admin can add a PL or US company instrument through the UI and see it usable in instrument history and alert creation within the same session, no deploy required.
- Duplicate-ticker and validation errors are clear and specific, not generic failures.
- The Polish build (`development-pl`) renders every new string correctly — no missing-translation build failures.
