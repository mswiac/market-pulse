import { Hono } from 'hono';
import type { Env } from '../index';
import { EMAIL_PATTERN, normalizeEmail } from '../lib/email';
import type { InstrumentRow } from '../lib/instruments';
import { sessionMiddleware } from '../lib/session';

const VALID_ALERT_TYPES = ['PRICE', 'RSI'] as const;

type AlertType = (typeof VALID_ALERT_TYPES)[number];

type Variables = { userId: number };

const alertsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

alertsRoutes.use('*', sessionMiddleware);

async function lookupTicker(db: D1Database, ticker: unknown): Promise<InstrumentRow | null> {
  if (typeof ticker !== 'string') return null;
  return db.prepare('SELECT ticker, rsi_eligible FROM instruments WHERE ticker = ?').bind(ticker).first<InstrumentRow>();
}

function normalizeAlertType(alertType: unknown): AlertType | null {
  return typeof alertType === 'string' && (VALID_ALERT_TYPES as readonly string[]).includes(alertType)
    ? (alertType as AlertType)
    : null;
}

function validateThreshold(alertType: AlertType, threshold: unknown): number | null {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null;
  if (alertType === 'RSI') {
    return threshold >= 0 && threshold <= 100 ? threshold : null;
  }
  return threshold > 0 ? threshold : null;
}

async function parseAlertBody(c: { req: { json: () => Promise<unknown> } }): Promise<{
  ticker?: unknown;
  alertType?: unknown;
  threshold?: unknown;
  notificationEmail?: unknown;
} | null> {
  try {
    return (await c.req.json()) as {
      ticker?: unknown;
      alertType?: unknown;
      threshold?: unknown;
      notificationEmail?: unknown;
    };
  } catch {
    return null;
  }
}

type AlertValidationResult =
  | { ok: true; instrument: InstrumentRow; alertType: AlertType; threshold: number; notificationEmail: string }
  | { ok: false; error: string };

// Shared by POST and PUT — both need the same ticker/alertType/threshold/email/
// RSI-eligibility checks before writing.
async function validateAlertInput(
  db: D1Database,
  body: { ticker?: unknown; alertType?: unknown; threshold?: unknown; notificationEmail?: unknown },
): Promise<AlertValidationResult> {
  const instrument = await lookupTicker(db, body.ticker);
  if (!instrument) {
    return { ok: false, error: 'invalid instrument' };
  }

  const alertType = normalizeAlertType(body.alertType);
  if (!alertType) {
    return { ok: false, error: 'invalid alert type' };
  }

  const threshold = validateThreshold(alertType, body.threshold);
  if (threshold === null) {
    return { ok: false, error: 'invalid threshold' };
  }

  const notificationEmail = normalizeEmail(body.notificationEmail);
  if (!notificationEmail || !EMAIL_PATTERN.test(notificationEmail)) {
    return { ok: false, error: 'invalid notification email' };
  }

  if (!instrument.rsi_eligible && alertType === 'RSI') {
    return { ok: false, error: 'RSI is not available for VIX' };
  }

  return { ok: true, instrument, alertType, threshold, notificationEmail };
}

// Shared join across alerts/instruments/market_data. LEFT JOIN market_data so an
// alert for a ticker with no market data yet (before the first cron run) still
// appears, with currentPrice/currentRsi as null.
const ALERT_SELECT = `
  SELECT
    a.id,
    a.ticker,
    i.name AS instrumentName,
    i.type AS instrumentType,
    a.alert_type AS alertType,
    a.threshold,
    a.notification_email AS notificationEmail,
    a.created_at AS createdAt,
    a.updated_at AS updatedAt,
    m.price AS currentPrice,
    m.rsi AS currentRsi
  FROM alerts a
  JOIN instruments i ON i.ticker = a.ticker
  LEFT JOIN market_data m ON m.ticker = a.ticker
`;

alertsRoutes.post('/', async (c) => {
  const body = await parseAlertBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body' }, 400);
  }

  const validation = await validateAlertInput(c.env.DB, body);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }
  const { instrument, alertType, threshold, notificationEmail } = validation;

  const userId = c.get('userId');

  try {
    // RETURNING can't reference joined tables, and a separate sequential
    // SELECT after INSERT would leave a non-atomic window (write succeeds,
    // re-select fails). batch() runs both as one atomic unit; both
    // statements bind values already known from the request, so neither
    // depends on the other's result.
    const [, selectResult] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email) VALUES (?, ?, ?, ?, ?)`,
      ).bind(userId, instrument.ticker, alertType, threshold, notificationEmail),
      c.env.DB.prepare(`${ALERT_SELECT} WHERE a.user_id = ? AND a.ticker = ? AND a.alert_type = ? AND a.threshold = ?`).bind(
        userId,
        instrument.ticker,
        alertType,
        threshold,
      ),
    ]);

    return c.json(selectResult.results[0], 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert' }, 409);
    }
    throw err;
  }
});

alertsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(`${ALERT_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`)
    .bind(userId)
    .all();

  return c.json(results, 200);
});

function parseAlertId(idParam: string): number | null {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

alertsRoutes.put('/:id', async (c) => {
  const id = parseAlertId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid alert id' }, 400);
  }

  const body = await parseAlertBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body' }, 400);
  }

  const validation = await validateAlertInput(c.env.DB, body);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }
  const { instrument, alertType, threshold, notificationEmail } = validation;

  const userId = c.get('userId');

  try {
    // Same batch()-based atomicity as POST above. A non-matching id/user_id
    // pair yields zero rows from both statements, so checking the select
    // result covers "doesn't exist" and "belongs to another user" alike,
    // identical to the old RETURNING-based null check.
    const [, selectResult] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE alerts SET ticker = ?, alert_type = ?, threshold = ?, notification_email = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?`,
      ).bind(instrument.ticker, alertType, threshold, notificationEmail, id, userId),
      c.env.DB.prepare(`${ALERT_SELECT} WHERE a.id = ? AND a.user_id = ?`).bind(id, userId),
    ]);

    const updated = selectResult.results[0];
    if (!updated) {
      return c.json({ error: 'alert not found' }, 404);
    }

    return c.json(updated, 200);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert' }, 409);
    }
    throw err;
  }
});

alertsRoutes.delete('/:id', async (c) => {
  const id = parseAlertId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid alert id' }, 400);
  }

  const userId = c.get('userId');

  const deleted = await c.env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ? RETURNING id')
    .bind(id, userId)
    .first();

  if (!deleted) {
    return c.json({ error: 'alert not found' }, 404);
  }

  return c.body(null, 204);
});

export default alertsRoutes;
