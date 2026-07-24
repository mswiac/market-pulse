import { Hono } from 'hono';
import type { Env } from '../index';
import { EMAIL_PATTERN, normalizeEmail } from '../lib/email';
import { sessionMiddleware } from '../lib/session';

const VALID_INSTRUMENTS = ['VIX', 'NASDAQ100'] as const;
const VALID_ALERT_TYPES = ['PRICE', 'RSI'] as const;

type Instrument = (typeof VALID_INSTRUMENTS)[number];
type AlertType = (typeof VALID_ALERT_TYPES)[number];

type Variables = { userId: number };

const alertsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

alertsRoutes.use('*', sessionMiddleware);

function normalizeInstrument(instrument: unknown): Instrument | null {
  return typeof instrument === 'string' && (VALID_INSTRUMENTS as readonly string[]).includes(instrument)
    ? (instrument as Instrument)
    : null;
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
  instrument?: unknown;
  alertType?: unknown;
  threshold?: unknown;
  notificationEmail?: unknown;
} | null> {
  try {
    return (await c.req.json()) as {
      instrument?: unknown;
      alertType?: unknown;
      threshold?: unknown;
      notificationEmail?: unknown;
    };
  } catch {
    return null;
  }
}

const ALERT_ROW_COLUMNS =
  'id, instrument, alert_type AS alertType, threshold, notification_email AS notificationEmail, created_at AS createdAt, updated_at AS updatedAt';

alertsRoutes.post('/', async (c) => {
  const body = await parseAlertBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body' }, 400);
  }

  const instrument = normalizeInstrument(body.instrument);
  if (!instrument) {
    return c.json({ error: 'invalid instrument' }, 400);
  }

  const alertType = normalizeAlertType(body.alertType);
  if (!alertType) {
    return c.json({ error: 'invalid alert type' }, 400);
  }

  const threshold = validateThreshold(alertType, body.threshold);
  if (threshold === null) {
    return c.json({ error: 'invalid threshold' }, 400);
  }

  const notificationEmail = normalizeEmail(body.notificationEmail);
  if (!notificationEmail || !EMAIL_PATTERN.test(notificationEmail)) {
    return c.json({ error: 'invalid notification email' }, 400);
  }

  if (instrument === 'VIX' && alertType === 'RSI') {
    return c.json({ error: 'RSI is not available for VIX' }, 400);
  }

  const userId = c.get('userId');

  try {
    const inserted = await c.env.DB.prepare(
      `INSERT INTO alerts (user_id, instrument, alert_type, threshold, notification_email)
       VALUES (?, ?, ?, ?, ?)
       RETURNING ${ALERT_ROW_COLUMNS}`,
    )
      .bind(userId, instrument, alertType, threshold, notificationEmail)
      .first();

    return c.json(inserted, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert' }, 409);
    }
    if (err instanceof Error && err.message.includes('CHECK constraint failed')) {
      return c.json({ error: 'RSI is not available for VIX' }, 400);
    }
    throw err;
  }
});

alertsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(
    `SELECT ${ALERT_ROW_COLUMNS} FROM alerts WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
  )
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

  const instrument = normalizeInstrument(body.instrument);
  if (!instrument) {
    return c.json({ error: 'invalid instrument' }, 400);
  }

  const alertType = normalizeAlertType(body.alertType);
  if (!alertType) {
    return c.json({ error: 'invalid alert type' }, 400);
  }

  const threshold = validateThreshold(alertType, body.threshold);
  if (threshold === null) {
    return c.json({ error: 'invalid threshold' }, 400);
  }

  const notificationEmail = normalizeEmail(body.notificationEmail);
  if (!notificationEmail || !EMAIL_PATTERN.test(notificationEmail)) {
    return c.json({ error: 'invalid notification email' }, 400);
  }

  if (instrument === 'VIX' && alertType === 'RSI') {
    return c.json({ error: 'RSI is not available for VIX' }, 400);
  }

  const userId = c.get('userId');

  try {
    const updated = await c.env.DB.prepare(
      `UPDATE alerts
       SET instrument = ?, alert_type = ?, threshold = ?, notification_email = ?, updated_at = unixepoch()
       WHERE id = ? AND user_id = ?
       RETURNING ${ALERT_ROW_COLUMNS}`,
    )
      .bind(instrument, alertType, threshold, notificationEmail, id, userId)
      .first();

    if (!updated) {
      return c.json({ error: 'alert not found' }, 404);
    }

    return c.json(updated, 200);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert' }, 409);
    }
    if (err instanceof Error && err.message.includes('CHECK constraint failed')) {
      return c.json({ error: 'RSI is not available for VIX' }, 400);
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
