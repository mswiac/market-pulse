import { Hono } from 'hono';
import type { Env } from '../index';
import { resolveFiringValue } from '../lib/alert-evaluation';
import { EMAIL_PATTERN, normalizeEmail } from '../lib/email';
import type { InstrumentRow } from '../lib/instruments';
import { sessionMiddleware } from '../lib/session';

const VALID_ALERT_TYPES = ['PRICE', 'RSI'] as const;
const VALID_DIRECTIONS = ['up', 'down'] as const;

type AlertType = (typeof VALID_ALERT_TYPES)[number];
type Direction = (typeof VALID_DIRECTIONS)[number];

type Variables = { userId: number };

const alertsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

alertsRoutes.use('*', sessionMiddleware);

async function lookupTicker(db: D1Database, ticker: unknown): Promise<InstrumentRow | null> {
  if (typeof ticker !== 'string') return null;
  return db.prepare('SELECT ticker, rsi_eligible, currency FROM instruments WHERE ticker = ?').bind(ticker).first<InstrumentRow>();
}

function normalizeAlertType(alertType: unknown): AlertType | null {
  return typeof alertType === 'string' && (VALID_ALERT_TYPES as readonly string[]).includes(alertType)
    ? (alertType as AlertType)
    : null;
}

function normalizeDirection(direction: unknown): Direction | null {
  return typeof direction === 'string' && (VALID_DIRECTIONS as readonly string[]).includes(direction)
    ? (direction as Direction)
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
  direction?: unknown;
} | null> {
  try {
    return (await c.req.json()) as {
      ticker?: unknown;
      alertType?: unknown;
      threshold?: unknown;
      notificationEmail?: unknown;
      direction?: unknown;
    };
  } catch {
    return null;
  }
}

type AlertValidationResult =
  | {
      ok: true;
      instrument: InstrumentRow;
      alertType: AlertType;
      threshold: number;
      notificationEmail: string;
      direction: Direction;
    }
  | { ok: false; error: string; code: string };

// Shared by POST and PUT — both need the same ticker/alertType/threshold/email/
// RSI-eligibility checks before writing.
async function validateAlertInput(
  db: D1Database,
  body: { ticker?: unknown; alertType?: unknown; threshold?: unknown; notificationEmail?: unknown; direction?: unknown },
): Promise<AlertValidationResult> {
  const instrument = await lookupTicker(db, body.ticker);
  if (!instrument) {
    return { ok: false, error: 'invalid instrument', code: 'invalid_instrument' };
  }

  const alertType = normalizeAlertType(body.alertType);
  if (!alertType) {
    return { ok: false, error: 'invalid alert type', code: 'invalid_alert_type' };
  }

  const threshold = validateThreshold(alertType, body.threshold);
  if (threshold === null) {
    return { ok: false, error: 'invalid threshold', code: 'invalid_threshold' };
  }

  const notificationEmail = normalizeEmail(body.notificationEmail);
  if (!notificationEmail || !EMAIL_PATTERN.test(notificationEmail)) {
    return { ok: false, error: 'invalid notification email', code: 'invalid_notification_email' };
  }

  const direction = normalizeDirection(body.direction);
  if (!direction) {
    return { ok: false, error: 'invalid direction', code: 'invalid_direction' };
  }

  if (!instrument.rsi_eligible && alertType === 'RSI') {
    return { ok: false, error: 'RSI is not available for VIX', code: 'rsi_not_eligible' };
  }

  return { ok: true, instrument, alertType, threshold, notificationEmail, direction };
}

interface CurrentMarketValue {
  price: number;
  rsi: number | null;
  high: number | null;
  low: number | null;
}

// Computed server-side from the ticker's current market_data row, never
// trusted from the request — an alert starts disarmed if the direction's
// condition is already true against today's value (so it doesn't fire
// immediately on stale/pre-existing data), armed otherwise. No market_data
// row yet (before the first cron run for a fresh ticker) defaults to armed —
// this early return must stay before resolveFiringValue, which requires a
// full snapshot and has no "row doesn't exist at all" case of its own.
async function computeArmed(
  db: D1Database,
  ticker: string,
  alertType: AlertType,
  threshold: number,
  direction: Direction,
): Promise<number> {
  const row = await db
    .prepare('SELECT price, rsi, high, low FROM market_data WHERE ticker = ?')
    .bind(ticker)
    .first<CurrentMarketValue>();
  if (!row) return 1;

  const value = resolveFiringValue(alertType, direction, row);
  if (value === null) return 1;

  const conditionAlreadyMet = direction === 'up' ? value >= threshold : value <= threshold;
  return conditionAlreadyMet ? 0 : 1;
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
    i.currency AS currency,
    a.alert_type AS alertType,
    a.threshold,
    a.direction AS direction,
    a.armed AS active,
    a.notification_email AS notificationEmail,
    a.created_at AS createdAt,
    a.updated_at AS updatedAt,
    m.price AS currentPrice,
    m.rsi AS currentRsi,
    m.high AS currentHigh,
    m.low AS currentLow
  FROM alerts a
  JOIN instruments i ON i.ticker = a.ticker
  LEFT JOIN market_data m ON m.ticker = a.ticker
`;

// D1 returns raw 0/1 for the `armed` INTEGER column — convert to a real
// JSON boolean at the response boundary so the frontend gets `active: boolean`.
function toAlertResponse(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, active: row['active'] === 1 };
}

alertsRoutes.post('/', async (c) => {
  const body = await parseAlertBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body', code: 'invalid_body' }, 400);
  }

  const validation = await validateAlertInput(c.env.DB, body);
  if (!validation.ok) {
    return c.json({ error: validation.error, code: validation.code }, 400);
  }
  const { instrument, alertType, threshold, notificationEmail, direction } = validation;

  const userId = c.get('userId');
  const armed = await computeArmed(c.env.DB, instrument.ticker, alertType, threshold, direction);

  try {
    // RETURNING can't reference joined tables, and a separate sequential
    // SELECT after INSERT would leave a non-atomic window (write succeeds,
    // re-select fails). batch() runs both as one atomic unit; both
    // statements bind values already known from the request, so neither
    // depends on the other's result.
    const [, selectResult] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email, direction, armed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, instrument.ticker, alertType, threshold, notificationEmail, direction, armed),
      c.env.DB.prepare(
        `${ALERT_SELECT} WHERE a.user_id = ? AND a.ticker = ? AND a.alert_type = ? AND a.threshold = ? AND a.direction = ?`,
      ).bind(userId, instrument.ticker, alertType, threshold, direction),
    ]);

    return c.json(toAlertResponse(selectResult.results[0] as Record<string, unknown>), 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert', code: 'duplicate_alert' }, 409);
    }
    throw err;
  }
});

alertsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(`${ALERT_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`)
    .bind(userId)
    .all();

  return c.json(
    results.map((row) => toAlertResponse(row as Record<string, unknown>)),
    200,
  );
});

function parseAlertId(idParam: string): number | null {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

alertsRoutes.put('/:id', async (c) => {
  const id = parseAlertId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid alert id', code: 'invalid_alert_id' }, 400);
  }

  const body = await parseAlertBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body', code: 'invalid_body' }, 400);
  }

  const validation = await validateAlertInput(c.env.DB, body);
  if (!validation.ok) {
    return c.json({ error: validation.error, code: validation.code }, 400);
  }
  const { instrument, alertType, threshold, notificationEmail, direction } = validation;

  const userId = c.get('userId');
  const armed = await computeArmed(c.env.DB, instrument.ticker, alertType, threshold, direction);

  try {
    // Same batch()-based atomicity as POST above. A non-matching id/user_id
    // pair yields zero rows from both statements, so checking the select
    // result covers "doesn't exist" and "belongs to another user" alike,
    // identical to the old RETURNING-based null check. direction/armed are
    // always recomputed on every edit — not just when threshold/ticker
    // changed — keeping the create and edit code paths identical.
    const [, selectResult] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE alerts SET ticker = ?, alert_type = ?, threshold = ?, notification_email = ?, direction = ?, armed = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?`,
      ).bind(instrument.ticker, alertType, threshold, notificationEmail, direction, armed, id, userId),
      c.env.DB.prepare(`${ALERT_SELECT} WHERE a.id = ? AND a.user_id = ?`).bind(id, userId),
    ]);

    const updated = selectResult.results[0];
    if (!updated) {
      return c.json({ error: 'alert not found', code: 'alert_not_found' }, 404);
    }

    return c.json(toAlertResponse(updated as Record<string, unknown>), 200);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'duplicate alert', code: 'duplicate_alert' }, 409);
    }
    throw err;
  }
});

alertsRoutes.delete('/:id', async (c) => {
  const id = parseAlertId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid alert id', code: 'invalid_alert_id' }, 400);
  }

  const userId = c.get('userId');

  const deleted = await c.env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ? RETURNING id')
    .bind(id, userId)
    .first();

  if (!deleted) {
    return c.json({ error: 'alert not found', code: 'alert_not_found' }, 404);
  }

  return c.body(null, 204);
});

export default alertsRoutes;
