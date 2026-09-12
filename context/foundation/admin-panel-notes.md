# Admin panel — deletion & side-effect details

Exact backend behavior behind the admin panel's destructive/mutating actions
(`src/worker/routes/admin.ts`). README's "Admin panel" section covers what
each screen does; this note covers the mechanics worth knowing before calling
these endpoints directly or changing them.

## Remove instrument (`DELETE /admin/instruments/:ticker`)

`instruments.ticker` has no foreign key anywhere in the schema, so nothing
cleans up related rows automatically. The route does it by hand, in one
`DB.batch()` so the delete is atomic and the reported `alertsDeleted` count
always matches exactly what was removed:

1. count `alerts` for the ticker
2. delete `alerts` for the ticker
3. delete `price_history` for the ticker
4. delete `market_data` for the ticker
5. delete the `instruments` row

`trigger_events` is deliberately **not** touched — it already tolerates a
missing instrument via `LEFT JOIN` + `COALESCE` (see
`src/worker/routes/trigger-events.ts`), so historical trigger records survive
an instrument's removal.

`GET /admin/instruments/:ticker/impact` (used by the confirm screen) just
returns the `alertsCount` that would be deleted, so the admin sees the blast
radius before confirming.

## Remove user (`DELETE /admin/users/:id`)

Unlike instruments, `sessions`, `alerts`, and `trigger_events` all carry real
`REFERENCES users(id) ON DELETE CASCADE` constraints, and D1 enforces foreign
keys by default — so a single `DELETE FROM users WHERE id = ?` cascades
everywhere on its own. The route still runs count queries for `alerts` and
`trigger_events` in the same batch as the delete, purely to report accurate
`alertsDeleted` / `triggerEventsDeleted` numbers back to the confirm screen.

An admin can never delete their own account — `id === c.get('userId')`
returns `403 cannot_delete_self` before anything else runs.

`GET /admin/users/:id/impact` mirrors the instrument impact endpoint: returns
`alertsCount` and `triggerEventsCount` for the confirm screen, no deletion.

## Run cron manually (`POST /admin/cron/run`)

Calls `handleScheduled()` directly — the exact same function the real
Cloudflare Cron Trigger invokes on its daily schedule (`src/worker/scheduled.ts`).
It is not a dry run or simulation: it fetches real closes, writes real
`price_history`/RSI state, evaluates every active alert, and sends real
Resend emails for anything that crosses a threshold. Treat it as "run today's
cron job right now," not as a preview.
