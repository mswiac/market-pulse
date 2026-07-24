# Market Data Pipeline (F-02) — Plan Brief

> Full plan: `context/changes/market-data-pipeline/plan.md`

## What & Why

Add a daily Cloudflare Cron Trigger that fetches VIX and NASDAQ-100 closing prices, stores them in D1, and computes RSI(14) for NASDAQ-100. This is a foundation slice — no UI or email notifications yet — that unblocks S-04 (market-data-display) and S-05 (alert-notifications), the last two roadmap items before the product delivers its core value.

## Starting Point

No `scheduled()` handler or `[triggers]` config exists yet (F-01 deliberately deferred both). No outbound `fetch()` to any external service exists anywhere in the codebase — this is the first. The `alerts` table already encodes the `VIX`/`NASDAQ100` instrument codes and the "no RSI for VIX" rule; this change reuses both.

## Desired End State

Every weekday evening, D1 holds a growing history of daily closes plus a `market_data` table with each instrument's current price and (for NASDAQ-100) current RSI — verifiable via `wrangler d1 execute`. S-04 can read `market_data` directly once built.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Data source | Yahoo Finance chart API (`^VIX` + `^NDX`, one endpoint) | Stooq has no VIX download and CBOE's free CSV doesn't cover NDX (both verified live during planning) — Yahoo is the only source covering both instruments from one place |
| RSI computation | Hand-written Wilder's RSI(14) in `lib/rsi.ts` | No technical-indicator library is installed, and using a 3rd-party pre-computed RSI would surrender control over the exact formula the product's alerts depend on |
| `price_history` retention | Keep forever, no deletion | Even at a future 140-GPW-stock scale this is ~7.8 MB/year against a 5 GB free-tier limit — no cleanup logic needed for 600+ years |
| `market_data` shape | One row per instrument, UPSERT | S-04 needs only the latest value; historical RSI is always reconstructable later from `price_history` since RSI is a pure function of closes |
| Fetch window per run | Rolling ~30 calendar days (`range=1mo`) | Self-heals after any missed cron run without a separate backfill script, and solves RSI's cold-start (needs 15 closes) on the very first run |
| Fetch failure handling | 1-2 retries + `console.error`, no new DB table | Mitigates transient network errors without the scope creep of a dedicated observability table this early |
| Cron schedule | 23:00 UTC, Mon-Fri | ~2h safety margin after NASDAQ/VIX close (20:00-21:00 UTC depending on DST) — the `infrastructure.md`-suggested 18:00 UTC was found to be before market close and corrected here |
| Yahoo mock strategy | Vitest's built-in `fetch` stub, no new dependency | Matches the codebase's existing no-extra-mocking-library style; MSW would add a dependency to check against `nodejs_compat` for one external endpoint |
| Manual verification | `wrangler d1 execute` direct SELECT | Zero extra code — no throwaway debug endpoint to build and later remove |

## Scope

**In scope:** `price_history` + `market_data` migrations, Yahoo fetch/validation module, RSI(14) module, `scheduled()` handler with per-instrument retry/failure isolation, Cron Trigger config.

**Out of scope:** alert evaluation, email notifications (S-05), UI display of market data (S-04), `trigger_events` table, historical RSI storage/charting, `price_history` retention/cleanup, a dedicated pipeline-run observability table, instruments beyond VIX/NASDAQ-100.

## Architecture / Approach

`scheduled()` orchestrates two independently-testable library modules: `lib/market-data.ts` (Yahoo fetch + response validation) and `lib/rsi.ts` (pure Wilder's-smoothing calculation). Each instrument is processed as an isolated unit inside one cron invocation, so a Yahoo hiccup on one symbol doesn't block the other's data from landing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. D1 Schema | `price_history` + `market_data` tables | Low — pure `CREATE TABLE`, no existing data to migrate |
| 2. Yahoo Fetch & Validation | `lib/market-data.ts`, tested against malformed/error responses | Yahoo's endpoint is unofficial — response shape could change without notice |
| 3. RSI Calculation | `lib/rsi.ts`, tested against a real reference value | Getting Wilder's smoothing subtly wrong would silently corrupt every downstream alert |
| 4. Cron Orchestration | `scheduled()` handler + `wrangler.toml` trigger | Cron Triggers have no built-in retry — per-instrument isolation is the main mitigation |

**Prerequisites:** F-01 (done) — Worker entry point, D1 binding.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Yahoo's chart API is unofficial and undocumented — it could change or be blocked without notice (same category of risk the roadmap already flagged for Stooq, just consolidated to one provider instead of two).
- The 23:00 UTC schedule assumes Yahoo finalizes daily closes within ~2 hours of market close; unverified under real production conditions until the pipeline has run for a few days.

## Success Criteria (Summary)

- After a scheduled run, `market_data` has exactly two rows (VIX, NASDAQ100) with a recent `updated_at`, VIX's `rsi` is `NULL`, and NASDAQ100's `rsi` is a plausible 0-100 value.
- A simulated failure fetching one instrument does not prevent the other instrument's data from being written.
- Re-running the pipeline (overlapping fetch window) never creates duplicate `price_history` rows.
