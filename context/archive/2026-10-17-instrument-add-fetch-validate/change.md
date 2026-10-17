---
change_id: instrument-add-fetch-validate
title: Fetch and validate market data when an instrument is added
status: archived
created: 2026-10-17
updated: 2026-10-17
archived_at: 2026-10-17T17:26:23Z
---

## Notes

GitHub issue #213. On POST /api/admin/instruments, fetch ~200 sessions from Yahoo, store price_history and market_data (with converged RSI), and reject the insert when the symbol returns no data.
