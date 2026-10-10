# App overview

What the MarketPulse UI offers to users and admins. For local setup and deployment see the repository `README.md`; for admin deletion cascades and manual cron run mechanics see `admin-panel-notes.md`.

## Pages

- **Dashboard** (`/`, the landing page after login) — one row per instrument from its latest close (date, close, high, low, RSI), filterable by type and instrument and sortable by column. Backed by `GET /api/instruments/latest`.
- **Alerts** (`/alerts`) — the user's alerts with filters, and the "New alert" action. Each alert has a Pause / Resume button: a paused alert shows a "Paused" status and is skipped entirely by the daily cron (no emails, no re-arm) until it is resumed. Editing an alert never changes its paused state.
- **History** — triggered alerts (`/history/triggers`) and per-instrument price history (`/history`).

## Admin panel

Users whose email is listed in `ADMIN_EMAILS` get an "Admin" section in the app. Access is enforced both client-side (`adminGuard`) and server-side (`adminMiddleware`), which re-derives admin status from the `users` table on every request rather than trusting anything the client claims. It exposes:

- **Fetch market data** (`/admin`) — manually backfills price history for one instrument over an arbitrary date range (up to 730 days), through the same Yahoo Finance fetch path the daily cron uses.
- **Run the cron pipeline manually** (`/admin/cron-run`) — re-runs the full daily job on demand instead of waiting for the scheduled Cron Trigger. This sends real emails and mutates real alert state if a threshold is crossed.
- **Add instrument** (`/admin/add-instrument`) — registers a new instrument (index, US stock, or GPW-listed Polish stock) beyond the seeded VIX/NASDAQ-100 pair.
- **Remove instrument** (`/admin/remove-instrument`) — previews how many alerts reference the instrument, then deletes it and its dependent data.
- **Remove user** (`/admin/remove-user`) — previews how many alerts and trigger events belong to the account, then deletes it; an admin cannot delete their own account.

Exact deletion cascades and the mechanics of the manual cron run (the
per-market fetch requests and the evaluation request) are documented in
`admin-panel-notes.md`.
