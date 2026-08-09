# F-04: GPW Equity Support via Yahoo (.WA Suffix) — Plan Brief

> Full plan: `context/changes/stooq-provider-support/plan.md`

## What & Why

The roadmap scoped F-04 as "Stooq provider support" — a second market-data fetch path for GPW-listed equities (`instruments.type = 'pl_stock'`, addable via S-10 but with no working fetch today). During planning, Stooq's CSV endpoint turned out to be gated by a live JS proof-of-work anti-bot challenge, while Yahoo's existing chart API — already used for `^VIX`/`^NDX`/`us_stock` — already covers GPW stocks via a `.WA` ticker suffix. This plan delivers F-04's actual goal (working data fetch for GPW equities) by extending the proven Yahoo path instead of building a new, riskier Stooq integration.

## Starting Point

`pl_stock` instruments are creatable via the admin panel (S-10) but inert: `deriveProvider` tags them `provider = 'stooq'`, and the cron only fetches `WHERE provider = 'yahoo'`, so they're silently skipped. `fetchDailyCloses` (Yahoo) already handles any compatible symbol and already returns `close`/`high`/`low` in the shape both the cron and admin backfill need.

## Desired End State

An admin adds a GPW stock with a plain ticker (e.g. `CDR`) and a `suffix` field that auto-suggests `.WA` for that type (editable/clearable). The cron and admin backfill fetch it from Yahoo as `ticker + suffix`, while every stored/displayed value stays the bare ticker. `instruments.currency` self-corrects against what Yahoo reports on every fetch, logged when it happens.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Data source for GPW equities | Yahoo (`.WA` suffix), not Stooq | Stooq's endpoint is now gated by a JS proof-of-work challenge of unverified feasibility from a Worker; Yahoo already works, live-verified. |
| Ticker identity | `instruments.ticker` stays the bare symbol (e.g. `CDR`) everywhere | Keeps alerts/history/admin display unchanged; avoids a display-vs-storage split. |
| Provider-symbol construction | New `instruments.suffix` column (admin-set, per-type default suggestion), concatenated at fetch time only | Decouples "which suffix" from code — a future non-GPW suffix needs no new branching logic, just a form value. |
| `provider` column dispatch | Simplified to always `'yahoo'`; cron's `WHERE provider='yahoo'` filter dropped | Only one real provider exists now; keeping branching code that never branches is misleading. |
| Currency mismatch handling | Auto-correct + log, on every fetch (not just the first) | Self-healing, no state-tracking needed; currency is display-only so a correction is low-risk. |
| Dynamic instrument categories (e.g. future "Spółka DE") | Explicitly out of scope — parked as a separate future roadmap item | Raised during planning; a genuinely separate feature (new categories table + CRUD), not a small F-04 addition. |

## Scope

**In scope:** `instruments.suffix` column + admin form field; Yahoo-symbol construction (`ticker + suffix`) in cron and admin backfill; currency parsing + auto-correction; `deriveProvider` simplification; roadmap doc update.

**Out of scope:** Stooq fetch/proof-of-work solving; dynamic/admin-editable instrument categories; ticker-format validation; exposing `suffix` publicly via `GET /api/instruments`; any currency conversion/arithmetic.

## Architecture / Approach

The fetch layer (cron, admin backfill) stays provider-agnostic and dumb — it always calls Yahoo, with the query symbol computed as `ticker + suffix` and every DB write keyed on bare `ticker`. All the "which suffix for which kind of instrument" intelligence lives once, at instrument-creation time in the admin form, not duplicated across fetch call sites.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + instrument creation | `suffix` column + migration; admin form field with per-type default; simplified `deriveProvider` | Low — additive schema change, no data migration |
| 2. Fetch layer + currency reconciliation | `ticker+suffix` fetch / bare-`ticker` writes in cron + backfill; `fetchDailyCloses` currency contract change; auto-correction | Medium — breaking return-type change touches ~10 existing tests + 2 call sites; easy to get the ticker/suffix split backwards |
| 3. Documentation | `roadmap.md` F-04 rewrite; dynamic-categories idea recorded | Low — docs only |

**Prerequisites:** F-02, F-03 (both done, per roadmap).
**Estimated effort:** ~1 session across 3 phases — mostly Phase 2's signature change and test updates.

## Open Risks & Assumptions

- Whether Stooq's anti-bot block is JS-only or also IP-reputation-based against Cloudflare Workers' egress IPs was never fully resolved — moot for this plan since Stooq isn't used, but worth remembering if Stooq is ever revisited.
- Yahoo's chart API is unofficial/undocumented (no published rate limit) — already an accepted, production-proven risk since F-02; this plan adds a handful more daily requests (one per GPW instrument), well within what's already running unproblematically.

## Success Criteria (Summary)

- Adding a GPW instrument via the admin panel and running a backfill produces correct `price_history` rows under the bare ticker.
- `instruments.currency` matches what Yahoo reports after any fetch, self-correcting if it didn't already.
- `index`/`us_stock` behavior is unchanged.
