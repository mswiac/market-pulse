import type { Env } from '../index';
import { sendAlertEmail } from './resend';

const PRICE_RE_ARM_MARGIN_FRACTION = 0.1;
const RSI_RE_ARM_MARGIN_POINTS = 10;

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

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: 'Próg cenowy',
  RSI: 'Próg RSI',
};

function formatValue(value: number, alertType: 'PRICE' | 'RSI', currency: string): string {
  const formatted = value.toFixed(2);
  return alertType === 'PRICE' ? `${formatted} ${currency}` : formatted;
}

function buildEmail(alert: AlertEvalRow, value: number): { subject: string; text: string } {
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

export async function evaluateAlerts(env: Env): Promise<void> {
  let alerts: AlertEvalRow[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.user_id, a.ticker, a.alert_type, a.threshold, a.direction, a.armed, a.notification_email,
              i.name AS instrumentName, i.currency, m.price, m.rsi, m.high, m.low
       FROM alerts a
       JOIN instruments i ON i.ticker = a.ticker
       JOIN market_data m ON m.ticker = a.ticker`,
    ).all<AlertEvalRow>();
    alerts = results;
  } catch (err) {
    console.error('alert-notifications: failed to load alerts for evaluation', err);
    return;
  }

  for (const alert of alerts) {
    try {
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
        const sendResult = await sendAlertEmail(env, { to: alert.notification_email, subject, text });

        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO trigger_events
               (user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, high_at_trigger, low_at_trigger, notification_email, email_status, email_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
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
            sendResult.ok ? 'sent' : 'failed',
            sendResult.ok ? null : sendResult.error,
          ),
          env.DB.prepare('UPDATE alerts SET armed = 0 WHERE id = ?').bind(alert.id),
        ]);
      } else {
        if (hasRetreatedPastMargin(alert.direction, value, alert.threshold, margin)) {
          await env.DB.prepare('UPDATE alerts SET armed = 1 WHERE id = ?').bind(alert.id).run();
        }
      }
    } catch (err) {
      console.error(`alert-notifications: failed to evaluate alert ${alert.id}`, err);
    }
  }
}
