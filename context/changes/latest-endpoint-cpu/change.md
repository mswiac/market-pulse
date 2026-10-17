---
change_id: latest-endpoint-cpu
title: Reduce CPU time of GET /api/instruments/latest
status: impl_reviewed
created: 2026-10-18
updated: 2026-10-18
archived_at: null
---

## Notes

GitHub issue #227: Reduce CPU time of GET /api/instruments/latest. Option A only — compute just the latest RSI per instrument (latestRsi) instead of building the full history, and read price rows with .raw(); keep price-history.ts as the single RSI definition and measure CPU before/after.
