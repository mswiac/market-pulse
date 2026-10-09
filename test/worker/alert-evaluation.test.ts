import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmail, evaluateAlerts } from '../../src/worker/lib/alert-evaluation';

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

async function seedMarketData(
  ticker: string,
  price: number,
  rsi: number | null = null,
  high: number | null = null,
  low: number | null = null,
  ageSeconds = 0,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO market_data (ticker, price, rsi, high, low, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch() - ?)
     ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, high = excluded.high, low = excluded.low, updated_at = excluded.updated_at`,
  )
    .bind(ticker, price, rsi, high, low, ageSeconds)
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
  high_at_trigger: number | null;
  low_at_trigger: number | null;
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

  it('does not re-arm a PRICE alert until the value retreats past the 10%-of-threshold margin', async () => {
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

  it('uses a fixed 10-point margin for RSI alerts instead of 10% of threshold', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-fixed-margin@example.com');
    // A 10%-of-threshold margin here would be 0.7 (threshold 7) — a fixed
    // 10-point margin means re-arm requires rsi <= threshold - 10 = -3, i.e.
    // never, for this low a threshold. 5 isn't nearly enough to re-arm.
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 7, direction: 'up', armed: 1 });
    await seedMarketData('^NDX', 4500, 10);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    await seedMarketData('^NDX', 4500, 5);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0); // 5 > 7 - 10 = -3, not retreated far enough
  });

  it('re-arms an RSI alert once it retreats past the fixed 10-point margin', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-margin-rearm@example.com');
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 70, direction: 'up', armed: 1 });
    await seedMarketData('^NDX', 4500, 75);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // Margin is a fixed 10 points, so re-arm requires rsi <= 60. 65 isn't enough.
    await seedMarketData('^NDX', 4500, 65);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // 60 clears the fixed margin — re-arms.
    await seedMarketData('^NDX', 4500, 60);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(1);
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

  it('records failed trigger events without disarming when the batch send throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('simulated network failure')));
    const userIdA = await seedUser('throwing-alert-a@example.com');
    const userIdB = await seedUser('throwing-alert-b@example.com');
    const alertA = await seedAlert(userIdA, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    const alertB = await seedAlert(userIdB, { ticker: '^NDX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 25);

    await evaluateAlerts(env);

    // A network-level failure is transient (resend.ts): "failed" events are
    // recorded but both alerts stay armed, so tomorrow's cron retries.
    for (const alertId of [alertA, alertB]) {
      expect((await getAlert(alertId)).armed).toBe(1);
      const events = await triggerEventsFor(alertId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ email_status: 'failed', email_error: expect.stringContaining('network error') });
    }
  });

  it('sends every firing alert in a single Resend request and writes the results in a single D1 batch', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const userId = await seedUser('single-request@example.com');
    const alertIds = [
      await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 }),
      await seedAlert(userId, { ticker: '^VIX', threshold: 21, direction: 'up', armed: 1 }),
      await seedAlert(userId, { ticker: '^NDX', threshold: 20, direction: 'up', armed: 1 }),
    ];
    const rearmId = await seedAlert(userId, { ticker: '^NDX', threshold: 90, direction: 'up', armed: 0 });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 25);
    const batchSpy = vi.spyOn(env.DB, 'batch');

    try {
      const summary = await evaluateAlerts(env);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toHaveLength(3);
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(summary.emails.map((e) => e.status)).toEqual(['sent', 'sent', 'sent']);
      for (const id of alertIds) expect((await getAlert(id)).armed).toBe(0);
      expect((await getAlert(rearmId)).armed).toBe(1);
    } finally {
      batchSpy.mockRestore();
    }
  });

  it('does not let an unverified recipient block the emails of the others in the same run', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const userId = await seedUser('mixed-recipients@example.com');
    const unverified = await seedAlert(userId, {
      ticker: '^VIX',
      threshold: 20,
      direction: 'up',
      armed: 1,
      notificationEmail: 'someone-else@example.com',
    });
    const verified = await seedAlert(userId, { ticker: '^NDX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 25);

    const summary = await evaluateAlerts(env);

    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toHaveLength(1);
    expect(summary.emails).toEqual(
      expect.arrayContaining([
        { alertId: unverified, ticker: '^VIX', status: 'failed', error: 'recipient not verified in Resend sandbox' },
        { alertId: verified, ticker: '^NDX', status: 'sent' },
      ]),
    );
    expect((await getAlert(unverified)).armed).toBe(0);
    expect((await getAlert(verified)).armed).toBe(0);
  });

  it('keeps every alert of the batch armed when Resend answers with a 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { message: 'resend down' })));
    const userId = await seedUser('batch-5xx@example.com');
    const alertA = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    const alertB = await seedAlert(userId, { ticker: '^NDX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 25);

    await evaluateAlerts(env);

    for (const alertId of [alertA, alertB]) {
      expect((await getAlert(alertId)).armed).toBe(1);
      expect((await triggerEventsFor(alertId))[0]).toMatchObject({ email_status: 'failed', email_error: 'resend down' });
    }
  });

  it('chunks more than 100 firing alerts into several Resend requests', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const userId = await seedUser('many-alerts@example.com');
    const alertIds: number[] = [];
    for (let threshold = 1; threshold <= 101; threshold++) {
      alertIds.push(await seedAlert(userId, { ticker: '^VIX', threshold, direction: 'up', armed: 1 }));
    }
    await seedMarketData('^VIX', 500);

    const summary = await evaluateAlerts(env);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(summary.emails).toHaveLength(101);
    expect(summary.emails.every((e) => e.status === 'sent')).toBe(true);
    const events = await env.DB.prepare('SELECT COUNT(*) as count FROM trigger_events').first<{ count: number }>();
    expect(events?.count).toBe(101);
    expect((await getAlert(alertIds[100])).armed).toBe(0);
  });

  it('skips alerts whose market data is older than 12 hours: no email, no state change', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const userId = await seedUser('stale-data@example.com');
    const firing = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    const rearming = await seedAlert(userId, { ticker: '^VIX', threshold: 30, direction: 'up', armed: 0 });
    await seedMarketData('^VIX', 25, null, null, null, 13 * 60 * 60);
    // On fresh data the first alert would fire (25 >= 20) and the second would re-arm (25 <= 30 - 3); stale data does neither.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const summary = await evaluateAlerts(env);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(summary.emails).toEqual([]);
      expect((await getAlert(firing)).armed).toBe(1);
      expect((await getAlert(rearming)).armed).toBe(0);
      expect(await triggerEventsFor(firing)).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('^VIX'));
      expect(summary.errors).toEqual(['^VIX: market data is 13h old (limit 12h)']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('treats data exactly 12 hours old as fresh (the staleness limit is exclusive)', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('stale-boundary@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    const nowMs = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    await env.DB.prepare('INSERT INTO market_data (ticker, price, updated_at) VALUES (?, ?, ?)')
      .bind('^VIX', 25, Math.floor(nowMs / 1000) - 12 * 60 * 60)
      .run();

    try {
      const summary = await evaluateAlerts(env);

      expect(summary.errors).toEqual([]);
      expect(summary.emails).toEqual([{ alertId, ticker: '^VIX', status: 'sent' }]);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('still evaluates data that is only slightly old (within 12 hours)', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('fresh-enough@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25, null, null, null, 11 * 60 * 60);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
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

  it('fires an armed "up" PRICE alert when the day\'s high crosses the threshold while price (close) stays below it', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('fires-on-high@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    // Close (18) never crosses 20 — only the intraday high (22) does.
    await seedMarketData('^VIX', 18, null, 22, 16);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value_at_trigger: 18, high_at_trigger: 22, low_at_trigger: 16 });
  });

  it('fires an armed "down" PRICE alert when the day\'s low crosses the threshold while price (close) stays above it', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('fires-on-low@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'down', armed: 1 });
    // Close (22) never crosses 20 — only the intraday low (18) does.
    await seedMarketData('^VIX', 22, null, 24, 18);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value_at_trigger: 22, high_at_trigger: 24, low_at_trigger: 18 });
  });

  it('does not re-arm purely because high/low retreated — re-arm still requires price (close) to retreat past the margin', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rearm-needs-close@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25, null, 26, 24);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // High/low retreat well below the margin (<= 18), but close (25) hasn't
    // moved at all — re-arm must still look at close, so it stays disarmed.
    await seedMarketData('^VIX', 25, null, 10, 8);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);
  });

  it('falls back to comparing against price (close) when high/low are null', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('fallback-to-close@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    // No high/low seeded (defaults to null) — firing must fall back to price.
    await seedMarketData('^VIX', 25);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value_at_trigger: 25, high_at_trigger: null, low_at_trigger: null });
  });

  it('does not record high_at_trigger/low_at_trigger for a fired RSI alert', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-no-high-low@example.com');
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 70, direction: 'up', armed: 1 });
    await seedMarketData('^NDX', 4500, 75, 4550, 4450);

    await evaluateAlerts(env);

    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value_at_trigger: 75, high_at_trigger: null, low_at_trigger: null });
  });

  it('does not fire an armed "down" alert whose condition is not yet met', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('down-not-armed-yet@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'down', armed: 1 });
    await seedMarketData('^VIX', 25);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(1);
    expect(await triggerEventsFor(alertId)).toHaveLength(0);
  });

  it('fires an armed "up" alert when the value equals the threshold exactly (inclusive boundary)', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('up-boundary@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 20);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    expect(await triggerEventsFor(alertId)).toHaveLength(1);
  });

  it('fires an armed "down" alert when the value equals the threshold exactly (inclusive boundary)', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('down-boundary@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'down', armed: 1 });
    await seedMarketData('^VIX', 20);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    expect(await triggerEventsFor(alertId)).toHaveLength(1);
  });

  it('does not re-arm a "down" PRICE alert until the value rises back past the margin', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('down-margin-not-enough@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'down', armed: 1 });
    await seedMarketData('^VIX', 15);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // Margin is 10% of 20 = 2, so re-arm requires value >= 22. 21 isn't enough.
    await seedMarketData('^VIX', 21);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(0);

    // 22 clears the margin — re-arms.
    await seedMarketData('^VIX', 22);
    await evaluateAlerts(env);
    expect((await getAlert(alertId)).armed).toBe(1);
  });

  it('fires an RSI alert using the actual RSI value, not the coincidental raw price, when they would disagree', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-not-price-fallback@example.com');
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 70, direction: 'up', armed: 1 });
    // RSI (75) crosses the threshold (70), but the raw index price (50) does
    // not — if resolveFiringValue ever silently fell back to price instead
    // of rsi here, this would incorrectly stay unfired.
    await seedMarketData('^NDX', 50, 75);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    const events = await triggerEventsFor(alertId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value_at_trigger: 75 });
  });

  it('does not touch an unarmed RSI alert\'s armed state while rsi is still null', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('rsi-null-unarmed@example.com');
    const alertId = await seedAlert(userId, { ticker: '^NDX', alertType: 'RSI', threshold: 70, direction: 'up', armed: 0 });
    await seedMarketData('^NDX', 4500, null);

    await evaluateAlerts(env);

    expect((await getAlert(alertId)).armed).toBe(0);
    expect(await triggerEventsFor(alertId)).toHaveLength(0);
  });
});

describe('evaluateAlerts summary', () => {
  it('counts alertsEvaluated for every loaded alert; only a fired alert appears in emails', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('summary-counts@example.com');
    const firingId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedAlert(userId, { ticker: '^NDX', alertType: 'PRICE', threshold: 5000, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    await seedMarketData('^NDX', 4500);

    const summary = await evaluateAlerts(env);

    expect(summary.alertsEvaluated).toBe(2);
    expect(summary.emails).toEqual([{ alertId: firingId, ticker: '^VIX', status: 'sent' }]);
    expect(summary.errors).toEqual([]);
  });

  it('records a failed email in the summary (not errors) for an unverified recipient', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const userId = await seedUser('summary-unverified@example.com');
    const alertId = await seedAlert(userId, {
      ticker: '^VIX',
      threshold: 20,
      direction: 'up',
      armed: 1,
      notificationEmail: 'someone-else@example.com',
    });
    await seedMarketData('^VIX', 25);

    const summary = await evaluateAlerts(env);

    expect(summary.emails).toEqual([
      { alertId, ticker: '^VIX', status: 'failed', error: 'recipient not verified in Resend sandbox' },
    ]);
    expect(summary.errors).toEqual([]);
  });

  it('records a failed email (not errors) when the trigger_events write throws after a send attempt', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('summary-batch-throws@example.com');
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 1 });
    await seedMarketData('^VIX', 25);
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('batch boom'));

    try {
      const summary = await evaluateAlerts(env);
      expect(summary.emails).toEqual([
        { alertId, ticker: '^VIX', status: 'failed', error: expect.stringContaining('batch boom') },
      ]);
      expect(summary.errors).toEqual([]);
    } finally {
      batchSpy.mockRestore();
    }
  });

  it('reports a failed alert load in errors instead of returning a clean summary', async () => {
    const prepareSpy = vi.spyOn(env.DB, 'prepare').mockImplementationOnce(() => {
      throw new Error('d1 unavailable');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const summary = await evaluateAlerts(env);
      expect(summary).toEqual({
        alertsEvaluated: 0,
        emails: [],
        errors: [expect.stringContaining('failed to load alerts: Error: d1 unavailable')],
      });
    } finally {
      prepareSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('reports each stale ticker once, however many alerts it has', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const userId = await seedUser('stale-once@example.com');
    await seedAlert(userId, { ticker: '^VIX', threshold: 20 });
    await seedAlert(userId, { ticker: '^VIX', threshold: 30 });
    await seedMarketData('^VIX', 25, null, null, null, 14 * 60 * 60);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const summary = await evaluateAlerts(env);
      expect(summary.errors).toEqual(['^VIX: market data is 14h old (limit 12h)']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('records the exception in errors, not emails, when the re-arm write throws', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('summary-rearm-throws@example.com');
    // Not armed, value already retreated past the margin — takes the re-arm
    // branch, which never sends an email at all.
    const alertId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'up', armed: 0 });
    await seedMarketData('^VIX', 10);
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('re-arm write failed'));

    try {
      const summary = await evaluateAlerts(env);
      expect(summary.emails).toEqual([]);
      expect(summary.errors).toEqual([expect.stringContaining(`alert ${alertId}`)]);
    } finally {
      batchSpy.mockRestore();
    }
  });

  // SQLite is dynamically typed: a non-numeric `high` stored in a REAL column
  // comes back as text, so buildEmail throws on `.toFixed` for that one alert.
  async function seedBrokenHigh(ticker: string): Promise<void> {
    await env.DB.prepare('INSERT INTO market_data (ticker, price, high, low, updated_at) VALUES (?, ?, ?, ?, unixepoch())')
      .bind(ticker, 25, 'not-a-number', 5)
      .run();
  }

  it('records the throwing alert in errors and still evaluates the others', async () => {
    stubFetchAlwaysSucceeds();
    const userId = await seedUser('per-alert-throws@example.com');
    const brokenId = await seedAlert(userId, { ticker: '^VIX', threshold: 20, direction: 'down', armed: 1 });
    const healthyId = await seedAlert(userId, { ticker: '^NDX', threshold: 20, direction: 'up', armed: 1 });
    await seedBrokenHigh('^VIX');
    await seedMarketData('^NDX', 25);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const summary = await evaluateAlerts(env);

      expect(summary.alertsEvaluated).toBe(2);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0]).toMatch(new RegExp(`^alert ${brokenId}: TypeError`));
      expect(summary.emails).toEqual([{ alertId: healthyId, ticker: '^NDX', status: 'sent' }]);
      expect((await getAlert(brokenId)).armed).toBe(1);
      expect((await getAlert(healthyId)).armed).toBe(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('buildEmail', () => {
  const basePriceAlert = {
    id: 1,
    user_id: 1,
    ticker: '^VIX',
    alert_type: 'PRICE' as const,
    threshold: 20,
    direction: 'up' as const,
    armed: 1,
    notification_email: VERIFIED_EMAIL,
    instrumentName: 'VIX',
    currency: 'USD',
    price: 25,
    rsi: null,
    high: null,
    low: null,
  };

  it('includes both high and low lines when both are present', () => {
    const { text } = buildEmail({ ...basePriceAlert, high: 26, low: 24 }, 25);
    expect(text).toContain('Maksimum dnia:');
    expect(text).toContain('Minimum dnia:');
    expect(text).toContain('Zamknięcie:');
  });

  it('omits the low line when only high is present', () => {
    const { text } = buildEmail({ ...basePriceAlert, high: 26, low: null }, 25);
    expect(text).toContain('Maksimum dnia:');
    expect(text).not.toContain('Minimum dnia:');
    expect(text).toContain('Zamknięcie:');
  });

  it('omits the high line when only low is present', () => {
    const { text } = buildEmail({ ...basePriceAlert, high: null, low: 24 }, 25);
    expect(text).not.toContain('Maksimum dnia:');
    expect(text).toContain('Minimum dnia:');
    expect(text).toContain('Zamknięcie:');
  });

  it('omits both high and low lines when neither is present', () => {
    const { text } = buildEmail({ ...basePriceAlert, high: null, low: null }, 25);
    expect(text).not.toContain('Maksimum dnia:');
    expect(text).not.toContain('Minimum dnia:');
    expect(text).toContain('Zamknięcie:');
  });

  it('uses the single-value line for an RSI alert, with no high/low/close lines', () => {
    const rsiAlert = { ...basePriceAlert, alert_type: 'RSI' as const, rsi: 75, high: null, low: null };
    const { text } = buildEmail(rsiAlert, 75);
    expect(text).toContain('Wartość w dniu wyzwolenia:');
    expect(text).not.toContain('Maksimum dnia:');
    expect(text).not.toContain('Minimum dnia:');
    expect(text).not.toContain('Zamknięcie:');
  });

  it('formats a deterministic, exact PRICE alert email with high and low both present', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
      const alert = { ...basePriceAlert, high: 26, low: 24 };
      const { subject, text } = buildEmail(alert, 25);

      expect(subject).toBe('MarketPulse: alert dla VIX został wyzwolony');
      expect(text).toBe(
        [
          'Walor: VIX (^VIX)',
          'Typ alertu: Próg cenowy',
          'Próg: 20.00 USD',
          'Maksimum dnia: 26.00 USD',
          'Minimum dnia: 24.00 USD',
          'Zamknięcie: 25.00 USD',
          'Data wyzwolenia: 05.01.2026',
        ].join('\n'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats a deterministic, exact PRICE alert email with only the close line when high/low are unavailable', () => {
    // With high/low both null, the array-building/filter step must drop
    // both entries entirely — not leave blank lines in their place.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
      const { text } = buildEmail(basePriceAlert, 25);

      expect(text).toBe(
        [
          'Walor: VIX (^VIX)',
          'Typ alertu: Próg cenowy',
          'Próg: 20.00 USD',
          'Zamknięcie: 25.00 USD',
          'Data wyzwolenia: 05.01.2026',
        ].join('\n'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats a deterministic, exact RSI alert email', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
      const alert = {
        ...basePriceAlert,
        alert_type: 'RSI' as const,
        ticker: '^NDX',
        instrumentName: 'NASDAQ-100',
        threshold: 70,
        rsi: 75,
        high: null,
        low: null,
      };
      const { subject, text } = buildEmail(alert, 75);

      expect(subject).toBe('MarketPulse: alert dla NASDAQ-100 został wyzwolony');
      expect(text).toBe(
        [
          'Walor: NASDAQ-100 (^NDX)',
          'Typ alertu: Próg RSI',
          'Próg: 70.00',
          'Wartość w dniu wyzwolenia: 75.00',
          'Data wyzwolenia: 05.01.2026',
        ].join('\n'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
