import type { Env } from '../index';
import { chunk } from './market-data';
import { sendAlertEmailBatch, type SendEmailInput } from './resend';

const PRICE_RE_ARM_MARGIN_FRACTION = 0.1;
const RSI_RE_ARM_MARGIN_POINTS = 10;
// Market data older than this is not evaluated. Evaluation runs in its own
// cron invocation with no ordering guarantee against the fetch, so a failed
// or late fetch must not make yesterday's quote fire (or re-arm) an alert.
export const STALE_AFTER_SECONDS = 12 * 60 * 60;
// trigger_events rows bind 12 values each; 8 rows stay under D1's
// 100-parameter statement cap. Id lists bind one value per id.
const TRIGGER_EVENT_ROWS_PER_STATEMENT = 8;
const IDS_PER_UPDATE_STATEMENT = 90;

interface AlertEvalRow {
  id: number;
  user_id: number;
  ticker: string;
  alert_type: 'PRICE' | 'RSI';
  threshold: number;
  direction: 'up' | 'down';
  armed: number;
  notification_email: string;
  instrumentName: string;
  currency: string;
  price: number;
  rsi: number | null;
  high: number | null;
  low: number | null;
}

// updated_at is evaluation-only (freshness check), not part of what buildEmail reads.
interface LoadedAlertRow extends AlertEvalRow {
  updated_at: number;
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: 'Próg cenowy',
  RSI: 'Próg RSI',
};

function formatValue(value: number, alertType: 'PRICE' | 'RSI', currency: string): string {
  const formatted = value.toFixed(2);
  return alertType === 'PRICE' ? `${formatted} ${currency}` : formatted;
}

export function buildEmail(alert: AlertEvalRow, value: number): { subject: string; text: string } {
  const triggeredAt = new Date().toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const subject = `MarketPulse: alert dla ${alert.instrumentName} został wyzwolony`;

  // PRICE alerts can fire on the day's high/low without the close ever
  // crossing the threshold — show all three so the recipient sees why it
  // fired instead of just one (possibly non-crossing) value. RSI has no
  // high/low concept, so it keeps the single-value line.
  const valueLines: string[] =
    alert.alert_type === 'PRICE'
      ? [
          alert.high !== null ? `Maksimum dnia: ${formatValue(alert.high, alert.alert_type, alert.currency)}` : null,
          alert.low !== null ? `Minimum dnia: ${formatValue(alert.low, alert.alert_type, alert.currency)}` : null,
          `Zamknięcie: ${formatValue(alert.price, alert.alert_type, alert.currency)}`,
        ].filter((line): line is string => line !== null)
      : [`Wartość w dniu wyzwolenia: ${formatValue(value, alert.alert_type, alert.currency)}`];

  const text = [
    `Walor: ${alert.instrumentName} (${alert.ticker})`,
    `Typ alertu: ${ALERT_TYPE_LABELS[alert.alert_type]}`,
    `Próg: ${formatValue(alert.threshold, alert.alert_type, alert.currency)}`,
    ...valueLines,
    `Data wyzwolenia: ${triggeredAt}`,
  ].join('\n');

  return { subject, text };
}

function conditionMet(direction: 'up' | 'down', value: number, threshold: number): boolean {
  return direction === 'up' ? value >= threshold : value <= threshold;
}

function hasRetreatedPastMargin(direction: 'up' | 'down', value: number, threshold: number, margin: number): boolean {
  return direction === 'up' ? value <= threshold - margin : value >= threshold + margin;
}

export interface MarketSnapshot {
  price: number;
  rsi: number | null;
  high: number | null;
  low: number | null;
}

// Shared by evaluateAlerts (firing) and alerts.ts's computeArmed (initial
// armed state), so the two can never drift apart on what "the value" means
// for a PRICE alert. PRICE alerts fire on the day's high ("up") or low
// ("down"), falling back to price (close) when high/low aren't available
// yet (see plan.md's null-handling notes) — re-arming intentionally does
// NOT use this function, it stays close-based (see hasRetreatedPastMargin).
export function resolveFiringValue(
  alertType: 'PRICE' | 'RSI',
  direction: 'up' | 'down',
  snapshot: MarketSnapshot,
): number | null {
  if (alertType === 'RSI') return snapshot.rsi;
  const directional = direction === 'up' ? snapshot.high : snapshot.low;
  return directional ?? snapshot.price;
}

export interface AlertEvaluationSummary {
  alertsEvaluated: number;
  emails: Array<{ alertId: number; ticker: string; status: 'sent' | 'failed'; error?: string }>;
  errors: string[];
}

interface PendingSend {
  alert: AlertEvalRow;
  value: number;
  input: SendEmailInput;
}

function updateByIds(db: D1Database, armed: 0 | 1, ids: number[]): D1PreparedStatement[] {
  return chunk(ids, IDS_PER_UPDATE_STATEMENT).map((group) =>
    db.prepare(`UPDATE alerts SET armed = ${armed} WHERE id IN (${group.map(() => '?').join(', ')})`).bind(...group),
  );
}

export async function evaluateAlerts(env: Env): Promise<AlertEvaluationSummary> {
  let alerts: LoadedAlertRow[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.user_id, a.ticker, a.alert_type, a.threshold, a.direction, a.armed, a.notification_email,
              i.name AS instrumentName, i.currency, m.price, m.rsi, m.high, m.low, m.updated_at
       FROM alerts a
       JOIN instruments i ON i.ticker = a.ticker
       JOIN market_data m ON m.ticker = a.ticker`,
    ).all<LoadedAlertRow>();
    alerts = results;
  } catch (err) {
    console.error('alert-notifications: failed to load alerts for evaluation', err);
    return { alertsEvaluated: 0, emails: [], errors: [] };
  }

  const emails: AlertEvaluationSummary['emails'] = [];
  const errors: string[] = [];
  const pendingSends: PendingSend[] = [];
  const rearmIds: number[] = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const staleAges = new Map<string, number>();

  for (const alert of alerts) {
    try {
      const ageSeconds = nowSeconds - alert.updated_at;
      if (ageSeconds > STALE_AFTER_SECONDS) {
        staleAges.set(alert.ticker, ageSeconds);
        continue;
      }

      const value = alert.alert_type === 'RSI' ? alert.rsi : alert.price;
      if (value === null) continue;

      // A pure percentage margin shrinks to near-zero for low RSI thresholds
      // (RSI is a bounded 0-100 index, not a monetary value) — RSI uses a
      // fixed point margin instead, matching the scale it's actually read on.
      const margin =
        alert.alert_type === 'RSI' ? RSI_RE_ARM_MARGIN_POINTS : alert.threshold * PRICE_RE_ARM_MARGIN_FRACTION;

      if (alert.armed === 1) {
        const firingValue = resolveFiringValue(alert.alert_type, alert.direction, alert);
        if (firingValue === null || !conditionMet(alert.direction, firingValue, alert.threshold)) continue;

        const { subject, text } = buildEmail(alert, value);
        pendingSends.push({ alert, value, input: { to: alert.notification_email, subject, text } });
      } else if (hasRetreatedPastMargin(alert.direction, value, alert.threshold, margin)) {
        rearmIds.push(alert.id);
      }
    } catch (err) {
      console.error(`alert-notifications: failed to evaluate alert ${alert.id}`, err);
      errors.push(`alert ${alert.id}: ${String(err)}`);
    }
  }

  for (const [ticker, ageSeconds] of staleAges) {
    console.warn(
      `alert-notifications: skipping alerts for ${ticker}: market data is ${Math.round(ageSeconds / 3600)}h old (limit ${STALE_AFTER_SECONDS / 3600}h)`,
    );
  }

  const sendResults = pendingSends.length > 0 ? await sendAlertEmailBatch(env, pendingSends.map((p) => p.input)) : [];

  // A transient send failure (network-level, not a permanent rejection like
  // an unverified recipient) leaves the alert armed so tomorrow's cron run
  // retries the notification naturally, instead of requiring a full
  // re-arm-then-re-cross cycle.
  const disarmIds: number[] = [];
  const eventRows = pendingSends.map(({ alert, value }, i) => {
    const result = sendResults[i];
    if (!(!result.ok && result.transient === true)) disarmIds.push(alert.id);
    return [
      alert.user_id,
      alert.id,
      alert.ticker,
      alert.alert_type,
      alert.direction,
      alert.threshold,
      value,
      alert.alert_type === 'PRICE' ? alert.high : null,
      alert.alert_type === 'PRICE' ? alert.low : null,
      alert.notification_email,
      result.ok ? 'sent' : 'failed',
      result.ok ? null : result.error,
    ];
  });

  const statements: D1PreparedStatement[] = [
    ...chunk(eventRows, TRIGGER_EVENT_ROWS_PER_STATEMENT).map((group) =>
      env.DB.prepare(
        `INSERT INTO trigger_events
           (user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, high_at_trigger, low_at_trigger, notification_email, email_status, email_error)
         VALUES ${group.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      ).bind(...group.flat()),
    ),
    ...updateByIds(env.DB, 0, disarmIds),
    ...updateByIds(env.DB, 1, rearmIds),
  ];

  let writeError: unknown = null;
  if (statements.length > 0) {
    try {
      await env.DB.batch(statements);
    } catch (err) {
      writeError = err;
      console.error('alert-notifications: failed to write alert evaluation results', err);
    }
  }

  pendingSends.forEach(({ alert }, i) => {
    const result = sendResults[i];
    if (writeError !== null) {
      // The mail may already have gone out, but its record and the disarm
      // did not land — report it as failed, as a single failed write always has.
      emails.push({ alertId: alert.id, ticker: alert.ticker, status: 'failed', error: String(writeError) });
    } else if (result.ok) {
      emails.push({ alertId: alert.id, ticker: alert.ticker, status: 'sent' });
    } else {
      emails.push({ alertId: alert.id, ticker: alert.ticker, status: 'failed', error: result.error });
    }
  });
  if (writeError !== null) {
    for (const id of rearmIds) errors.push(`alert ${id}: ${String(writeError)}`);
  }

  return { alertsEvaluated: alerts.length, emails, errors };
}
