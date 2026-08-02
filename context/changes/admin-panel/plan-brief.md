# Admin Panel — Plan Brief

> Full plan: `context/changes/admin-panel/plan.md`

## What & Why

Add an admin-only panel where an allowlisted administrator can manually fetch/refresh market data (close/high/low) for a chosen instrument over a chosen date range, on demand. This backs roadmap slice `S-09` and directly resolves the "self-backfill window" gap flagged during `S-08`'s plan review — today's cron only ever fetches ~30 days back, so deeper historical backfill has no path.

## Starting Point

The daily cron (`src/worker/scheduled.ts`) fetches a fixed ~30-day window from Yahoo for both instruments and upserts it into `price_history`/`market_data`. There's no admin/role concept anywhere in the codebase — auth is flat, sessions only carry a `userId`, and `/api/me` is the sole place that resolves a session to an email.

## Desired End State

An admin sees an "Admin" sidebar tile below "History". Opening it shows a form (category + instrument combobox, exactly like the instrument-history page, plus a from/to date range). Submitting fetches that exact range from Yahoo and overwrites the matching `price_history` rows, then shows a "Saved N days" confirmation. Non-admins never see the tile in normal use, and even a client-side bypass can't get real data out of the endpoint — the server independently re-checks admin status on every request.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| What gets overwritten | `price_history` only, never `market_data` | `market_data` is the "current value" row alerts are evaluated against — writing an arbitrary historical range into it could regress the live price/RSI and break alert evaluation until the next cron run |
| Admin identification | `ADMIN_EMAILS` env var/secret, case-insensitive comparison against the session's DB email | Matches the project's flat-role baseline with minimal footprint; no DB schema change; consistent with how other secrets (`RESEND_API_KEY`) are already managed |
| Client-side `isAdmin` | UX-only (hide tile, block route) — never trusted for authorization | SPA client state is always attacker-controlled; the real boundary is the server re-validating session + email on every admin request |
| Date range → Yahoo | `fetchDailyCloses` takes explicit `from`/`to`, using Yahoo's `period1`/`period2` params instead of `range` | One code path for both the cron's fixed window and the admin's arbitrary range; cron passes its existing default explicitly, so its behavior is unchanged |
| Date range input | Two native `<input type="date">` fields | Zero new dependencies, fully accessible, sufficient for a single-admin internal tool |
| Max range per request | 730 days | Keeps a single D1 batch and Yahoo fetch comfortably sized; no chunking logic needed at this scale |
| Instrument combobox scope | Same as instrument-history (S-07), no provider filtering | Provider split happens at the category level (Index→Yahoo today, future GPW→Stooq), not per-instrument — filtering here would be a premature abstraction |
| Success feedback | Banner showing exact day count written | Lets the admin verify the fetch covered what they expected without checking D1 by hand |

## Scope

**In scope:**
- `ADMIN_EMAILS` allowlist (env/secret) + `isAdmin` on `/api/me` and `AuthUser`
- `POST /api/admin/market-data` — fetch + overwrite `price_history` for a ticker + date range
- Admin sidebar tile, guarded route, panel UI (combobox + date range + submit + result banner)
- `fetchDailyCloses` signature change to explicit date range (cron call site updated, behavior unchanged)

**Out of scope:**
- Any `market_data` write from the admin action
- DB-backed roles/permissions table
- Any admin action beyond this one fetch/backfill form
- Rate limiting or audit logging on the new endpoint
- RSI-specific handling (RSI for display is already computed on read from `price_history`, so backfilled rows are picked up automatically)

## Architecture / Approach

Backend-first: extend the shared Yahoo-fetch layer to take an explicit date range and extract the `price_history` upsert into a reusable helper (Phase 1), add the admin-gated endpoint on top of it (Phase 2), then wire up frontend routing/guard/visibility (Phase 3) and the panel UI itself (Phase 4). The endpoint is fully testable via `vitest` before any UI exists.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `fetchDailyCloses(ticker, from, to)` + shared `upsertPriceHistory` helper; cron behavior unchanged | Getting the Unix-timestamp date conversion right (UTC midnight) |
| 2. Backend endpoint | `POST /api/admin/market-data`, admin-gated, `price_history`-only writes | Ensuring the admin check is truly server-side and can't be bypassed via client state |
| 3. Frontend routing | Guard, lazy route, conditional sidebar tile | None significant — direct copy of the existing auth-guard pattern |
| 4. Frontend UI | Combobox + date range form, result banner, i18n | Combobox reuse must match the S-07 pattern exactly to avoid UX drift |

**Prerequisites:** S-01, F-02, F-03 (all done, per roadmap `S-09`)
**Estimated effort:** ~1 session across 4 phases

## Open Risks & Assumptions

- Assumes Yahoo's chart API accepts `period1`/`period2` for arbitrary historical ranges the same way it does for `range=1mo` — not yet verified against a live request during planning; first manual test in Phase 2 will confirm.
- Assumes the two-instrument, low-frequency usage pattern holds; the 730-day cap and lack of chunking would need revisiting if usage patterns change materially.

## Success Criteria (Summary)

- Admin can pick an instrument + date range and see `price_history` correctly overwritten with a matching day count.
- Non-admins cannot see the panel in normal use, and cannot get any data through the endpoint even via a direct request.
- The daily cron's existing behavior is provably unchanged (existing `scheduled.test.ts` suite passes without modification).
