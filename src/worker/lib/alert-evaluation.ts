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
  const text = [
    `Walor: ${alert.instrumentName} (${alert.ticker})`,
    `Typ alertu: ${ALERT_TYPE_LABELS[alert.alert_type]}`,
    `Próg: ${formatValue(alert.threshold, alert.alert_type, alert.currency)}`,
    `Wartość w dniu wyzwolenia: ${formatValue(value, alert.alert_type, alert.currency)}`,
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

export async function evaluateAlerts(env: Env): Promise<void> {
  let alerts: AlertEvalRow[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.user_id, a.ticker, a.alert_type, a.threshold, a.direction, a.armed, a.notification_email,
              i.name AS instrumentName, i.currency, m.price, m.rsi
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
        if (!conditionMet(alert.direction, value, alert.threshold)) continue;

        const { subject, text } = buildEmail(alert, value);
        const sendResult = await sendAlertEmail(env, { to: alert.notification_email, subject, text });

        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO trigger_events
               (user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, notification_email, email_status, email_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            alert.user_id,
            alert.id,
            alert.ticker,
            alert.alert_type,
            alert.direction,
            alert.threshold,
            value,
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
