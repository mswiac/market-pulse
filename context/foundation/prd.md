---
project: "MarketPulse"
version: 1
status: draft
created: 2026-06-14
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Most stock market portals and applications allow users to view indicators like RSI in real time on their free plans, but setting an alert when an indicator reaches a specific value is locked behind a paywall. Price alerts, where available for free, are typically limited in number and expire after 30 days — forcing users to reset them monthly or lose coverage. TradingView is one well-known example of this pattern, but it holds across the industry.

Insight: market platforms deliberately limit the durability and depth of alerts to push users toward paid upgrades. A user who tracks only a handful of key macro indices (VIX, NASDAQ-100) and wants to set an alert once and forget about it has no free alternative that fits this profile.

## User & Persona

**Mateusz** — a retail investor tracking macro market indicators (VIX, NASDAQ-100) as sentiment signals. He does not trade actively; he uses index levels as context for his own decisions. He wants to set an alert once and return to normal life — without checking charts daily and without resetting alerts every 30 days.

## Success Criteria

### Primary
- User registers, logs in, creates an alert on VIX or NASDAQ-100 (price or RSI), and receives an email notification when the threshold is crossed.

### Secondary
- Current index value is visible on the alert list so the user can see how close the threshold is.
- History of triggered alerts (log of past notifications — when and what was fired).
- Support for more instruments and indicators beyond the MVP set (post-MVP expansion).

### Guardrails
- Alerts must be checked every day without fail — a missed evaluation means a missed notification, which is a core product failure.
- Email notifications must reach the recipient's inbox (not spam).
- Each user's alerts are fully isolated — no user can see or affect another user's data.

## User Stories

# TODO: user stories (Given/When/Then) — see Open Questions

## Functional Requirements

### Authentication
- FR-001: User can register an account with an email address and password. Priority: must-have
- FR-002: User can log in using their email address and password. Priority: must-have
- FR-003: User can log out of their account. Priority: must-have

### Alert Management
- FR-004: User can create an alert by selecting an instrument (VIX or NASDAQ-100), alert type, threshold value, and notification email address. VIX supports price alerts only; NASDAQ-100 supports price or RSI alerts. The email field is pre-filled from the user's account email but can be overridden per alert. Priority: must-have
  > Socrates: Counter-argument considered: "RSI on VIX is unconventional — VIX is a sentiment/volatility index read via absolute thresholds (e.g. >23 = fear), not a trending price series RSI is designed for. The one established technique applying RSI to VIX (Connors' VIX Reversal) uses non-default parameters and signals on a *different* instrument (S&P 500), not on VIX itself — a naive RSI(14, 30/70) on VIX has no established sentiment interpretation." Resolution: restrict RSI to NASDAQ-100; VIX alerts are price-only.
- FR-005: User can view their list of active alerts. Priority: must-have
  > Socrates: Counter-argument considered: "A list is unnecessary overhead for a single user with a handful of alerts." Resolution: kept — without a list the user has no visibility into what alerts are active.
- FR-006: User can edit an existing alert (change instrument, type, threshold value, or email). Priority: must-have
  > Socrates: Counter-argument considered: "Delete-only is simpler — just remove and recreate." Resolution: kept; edit is a deliberate must-have decision.
- FR-007: User can delete an existing alert. Priority: must-have

### Notifications
- FR-008: The system sends an email notification to the alert's designated email address when the threshold is crossed. Priority: must-have
  > Socrates: Counter-argument considered: "Email is unreliable and hard to test locally — a UI log would suffice for MVP." Resolution: both; email is the core value of the product, but a trigger history log in the app is also kept (FR-010 promoted to must-have).
- FR-008a: The system records each alert trigger event (timestamp, instrument, value at time of trigger) in persistent storage. Priority: must-have

### Nice-to-have
- FR-009: User can view the current index value alongside each alert on the list. Priority: nice-to-have
- FR-010: User can view a history of previously triggered alerts. Priority: must-have
- FR-011: User can create alerts for instruments and indicator types beyond the MVP set. Priority: nice-to-have

## Non-Functional Requirements

- Alert thresholds are evaluated against current market data every calendar day — a missed evaluation means a missed notification, which is a core product failure.
- The application is usable on the current and previous major versions of Chrome, Firefox, Safari, and Edge on desktop.
- Each user's alerts and trigger history are fully isolated — no user can read or affect another user's data.

## Business Logic

The system fetches daily market data, calculates indicators, and sends a notification when a user-defined threshold is crossed — requiring the user to act only once, at alert creation.

Supporting detail:
- **Inputs**: daily closing data for VIX and NASDAQ-100 sourced from a market data provider on a daily schedule. For RSI alerts (NASDAQ-100 only, see FR-004), RSI is derived from a sequence of recent daily closing values; for price alerts, no additional calculation is needed.
- **Output**: an email sent to the address designated on the alert, triggered at most once per day per alert when the threshold condition is met.
- **User encounter**: the user configures an alert once (instrument, type, threshold, email) and receives an email notification the day the condition is first satisfied, with no further action required.

## Access Control

Email address and password at registration. Login uses the email address and password — the email serves as both the login identifier and the default notification address pre-filled on new alerts. Flat role model — one type of user, everyone with identical permissions to manage their own alerts. The MVP serves a single user, but the account model is multi-user by design — adding more people does not require a rebuild. Unauthenticated users have no access to any application resource.

## Non-Goals

- No support for instruments other than VIX and NASDAQ-100 — stocks, other indices, and crypto are out of MVP scope. Rationale: limiting instruments constrains data sourcing and keeps the MVP shippable.
- No indicators other than price and RSI — MACD, Bollinger Bands, volume-based indicators are post-MVP. Rationale: RSI requires custom calculation; adding more indicators before validating the core flow is premature.
- No push notifications, SMS, or webhooks — email only. Rationale: additional notification channels add integration complexity without validating the core value.
- No intraday data or real-time alerts — daily data only, evaluated once per day. Rationale: real-time data requires a different (paid) data source and a fundamentally different architecture.

## Open Questions

1. **User stories (Given/When/Then format)**: No user stories were captured in shape-notes.md. The PRD schema requires at least one `### US-NN:` entry with a Given/When/Then acceptance-criteria block. — Owner: user. Block: yes (schema incomplete until resolved).
