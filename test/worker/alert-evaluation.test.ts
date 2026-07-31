import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateAlerts } from '../../src/worker/lib/alert-evaluation';

const VERIFIED_EMAIL = 'verified@example.com'; // matches vitest.config.mts RESEND_VERIFIED_EMAIL

interface AlertSeed {
  ticker?: string;
  alertType?: 'PRICE' | 'RSI';
  threshold?: number;
  direction?: 'up' | 'down';
  armed?: number;
  notificationEmail?: string;
}

async function seedUser(email: string): Promise<number> {
  const result = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .bind(email, 'irrelevant-hash')
    .run();
  return result.meta.last_row_id as number;
}

async function seedAlert(userId: number, overrides: AlertSeed = {}): Promise<number> {
  const {
    ticker = '^VIX',
    alertType = 'PRICE',
    threshold = 20,
    direction = 'up',
    armed = 1,
    notificationEmail = VERIFIED_EMAIL,
  } = overrides;

  const result = await env.DB.prepare(
    'INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email, direction, armed) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(userId, ticker, alertType, threshold, notificationEmail, direction, armed)
    .run();
  return result.meta.last_row_id as number;
}

async function seedMarketData(ticker: string, price: number, rsi: number | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, updated_at = excluded.updated_at`,
  )
    .bind(ticker, price, rsi)
    .run();
}

async function getAlert(id: number): Promise<{ armed: number }> {
  const row = await env.DB.prepare('SELECT armed FROM alerts WHERE id = ?').bind(id).first<{ armed: number }>();
  if (!row) throw new Error(`alert ${id} not found`);
  return row;
}

interface TriggerEventRow {
  alert_id: number;
  email_status: string;
  email_error: string | null;
  value_at_trigger: number;
}

async function triggerEventsFor(alertId: number): Promise<TriggerEventRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM trigger_events WHERE alert_id = ?')
    .bind(alertId)
    .all<TriggerEventRow>();
  return results;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

// Fails only for a request whose body mentions the marker ticker — everything
// else succeeds. Used to simulate one alert's send blowing up without
// affecting the others in the same run. Matches on the email body (not the
// "to" address) so both the failing and healthy alert can share the same
// Resend-verified recipient and actually reach the fetch call.
function stubFetchThrowingFor(markerTicker: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (typeof body.text === 'string' && body.text.includes(markerTicker)) {
        throw new Error('simulated network failure');
      }
      return jsonResponse(200, { id: 'fake-resend-id' });
    }),
  );
}

function stubFetchAlwaysSucceeds(): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(200, { id: 'fake-resend-id' })));
}

beforeEach(async () => {
  // D1's test binding isn't isolated per test — clear everything this suite
  // touches (same rationale as scheduled.test.ts / rsi-eligibility-triggers.test.ts).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM trigger_events'),
    env.DB.prepare('DELETE FROM alerts'),
    env.DB.prepare('DELETE FROM market_data'),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('evaluateAlerts', () => {
  it('fires an armed "up" alert once its direction condition is met, disarming it', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('fires-up@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ email_status: 'sent', value_at_trigger: 25 });
  });

  it('does not fire an armed alert whose condition is not yet met', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('not-armed-yet@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 15);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(1);
    expect(await triggerEventsFor(alertId)).toHaveLength(0);
  });

  it('does not fire again on a later run while the value has not retreated', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('no-refire@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);

    await evaluateAlerts(env);
    expect(await triggerEventsFor(alertId)).toHaveLength(1);

    await evaluateAlerts(env);
    expect(await triggerEventsFor(alertId)).toHaveLength(1); // still just the one
    expect((await getAlert(alertId)).armed).toBe(0);
  });

  it('does not re-arm until the value retreats past the 10% margin', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('margin-not-enough@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // Margin is 10% of 20 = 2, so re-arm requires value <= 18. 19 isn't enough.
    await seedMarketData('^VIX', 19);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);
  });

  it('re-arms and fires again once the value retreats past the margin and re-crosses', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rearm-and-refire@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // Retreats past the margin (<= 18) — re-arms, but doesn't fire on this run.
    await seedMarketData('^VIX', 17);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(1);
    expect(await triggerEventsFor(alertId)).toHaveLength(1);

    // Crosses again — fires a second time.
    await seedMarketData('^VIX', 22);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);
    expect(await triggerEventsFor(alertId)).toHaveLength(2);
  });

  it('records email_status "failed" with a reason for a non-verified recipient, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const userId = await seedUser('unverified-recipient@example.com');
    const alertId = await seedAlert(userId, {
      ticker: '^VIX',
      threshold: 20,
      direction: 'up',
      armed: 1,
      notificationEmail: 'someone-else@example.com',
    });
    await seedMarketData('^VIX', 25);

    await evaluateAlerts(env);

    expect(fetchSpy).not.toHaveBeenCalled();
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ email_status: 'failed', email_error: 'recipient not verified in Resend sandbox' });
    expect((await getAlert(alertId)).armed).toBe(0); // still disarms — the crossing itself is real
  });

  it('keeps evaluating other alerts when one alert throws mid-run', async () => {
    // Both alerts target the Resend-verified recipient (so both actually
    // reach the fetch call, past the pre-flight check) but differ by ticker,
    // which the stub uses to fail only one of them.
    stubFetchThrowingFor('^VIX');
    const userIdA = await seedUser('throwing-alert@example.com');
    const userIdB = await seedUser('healthy-alert@example.com');
    const brokenId = await seedAlert(userIdA, {
      ticker: '^VIX',
      threshold: 20,
      direction: 'up',
      armed: 1,
      notificationEmail: VERIFIED_EMAIL,
    });
    const healthyId = await seedAlert(userIdB, {
      ticker: '^NDX',
      alertType: 'PRICE',
      threshold: 20,
      direction: 'up',
      armed: 1,
      notificationEmail: VERIFIED_EMAIL,
    });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 25);

    await evaluateAlerts(env);

    // The broken alert's send threw before its trigger_events/armed write —
    // it stays armed and unrecorded, but the healthy one still fired.
    expect((await getAlert(brokenId)).armed).toBe(1);
    expect(await triggerEventsFor(brokenId)).toHaveLength(0);
    expect((await getAlert(healthyId)).armed).toBe(0);
    expect(await triggerEventsFor(healthyId)).toHaveLength(1);
  });

  it('skips an RSI alert when rsi is not yet available', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-not-ready@example.com');
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 70, direction: 'up', armed: 1 });
    await seedMarketData('^NDX', 4500, null);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(1);
    expect(await triggerEventsFor(alertId)).toHaveLength(0);
  });
});
