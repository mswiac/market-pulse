import { Hono } from 'hono';
import type { Env } from '../index';
import { sessionMiddleware } from '../lib/session';

type Variables = { userId: number };

const triggerEventsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

interface TriggerEventRow {
  id: number;
  ticker: string;
  instrument_name: string;
  currency: string | null;
  alert_type: string;
  direction: string;
  threshold: number;
  value_at_trigger: number;
  high_at_trigger: number | null;
  low_at_trigger: number | null;
  email_status: 'sent' | 'failed';
  email_error: string | null;
  triggered_at: number;
}

triggerEventsRoutes.use('*', sessionMiddleware);

triggerEventsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = parseLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));

  const { results } = await c.env.DB.prepare(
    `SELECT te.id, te.ticker, COALESCE(i.name, te.ticker) AS instrument_name, i.currency,
            te.alert_type, te.direction, te.threshold, te.value_at_trigger,
            te.high_at_trigger, te.low_at_trigger,
            te.email_status, te.email_error, te.triggered_at
     FROM trigger_events te
     LEFT JOIN instruments i ON i.ticker = te.ticker
     WHERE te.user_id = ?
     ORDER BY te.triggered_at DESC, te.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(userId, limit + 1, offset)
    .all<TriggerEventRow>();

  const hasMore = results.length > limit;
  const events = results.slice(0, limit).map((row) => ({
    id: row.id,
    ticker: row.ticker,
    instrumentName: row.instrument_name,
    currency: row.currency,
    alertType: row.alert_type,
    direction: row.direction,
    threshold: row.threshold,
    valueAtTrigger: row.value_at_trigger,
    highAtTrigger: row.high_at_trigger,
    lowAtTrigger: row.low_at_trigger,
    emailStatus: row.email_status,
    emailError: row.email_error,
    triggeredAt: row.triggered_at,
  }));

  return c.json({ events, hasMore }, 200);
});

export default triggerEventsRoutes;
