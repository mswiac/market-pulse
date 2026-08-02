import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'https://example.com';
const PASSWORD = 'correct horse battery staple';

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a Set-Cookie header');
  return setCookie.split(';')[0];
}

async function registerAndLogIn(email: string): Promise<{ cookie: string; userId: number }> {
  const response = await exports.default.fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = sessionCookieFrom(response);
  const { id } = (await response.json()) as { id: number };
  return { cookie, userId: id };
}

interface TriggerEventOverrides {
  ticker?: string;
  alertType?: string;
  direction?: string;
  threshold?: number;
  valueAtTrigger?: number;
  highAtTrigger?: number | null;
  lowAtTrigger?: number | null;
  emailStatus?: 'sent' | 'failed';
  emailError?: string | null;
}

// `triggeredAt` is a required, explicit unix-seconds value (rather than
// falling back to the column's `unixepoch()` default) so ordering tests can
// control exact sequencing without racing same-second inserts.
async function seedTriggerEvent(userId: number, triggeredAt: number, overrides: TriggerEventOverrides = {}): Promise<void> {
  const {
    ticker = '^VIX',
    alertType = 'PRICE',
    direction = 'up',
    threshold = 20,
    valueAtTrigger = 21,
    highAtTrigger = null,
    lowAtTrigger = null,
    emailStatus = 'sent',
    emailError = null,
  } = overrides;

  await env.DB.prepare(
    `INSERT INTO trigger_events
       (user_id, ticker, alert_type, direction, threshold, value_at_trigger, high_at_trigger, low_at_trigger, notification_email, email_status, email_error, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      ticker,
      alertType,
      direction,
      threshold,
      valueAtTrigger,
      highAtTrigger,
      lowAtTrigger,
      'notify@example.com',
      emailStatus,
      emailError,
      triggeredAt,
    )
    .run();
}

async function getTriggerEvents(cookie?: string, params: { limit?: number; offset?: number } = {}): Promise<Response> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  return exports.default.fetch(`${BASE_URL}/api/trigger-events${qs ? `?${qs}` : ''}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe('trigger events endpoint', () => {
  it('rejects a request without a session cookie', async () => {
    const response = await getTriggerEvents();
    expect(response.status).toBe(401);
  });

  it('returns an empty list with hasMore: false for a user with no trigger events', async () => {
    const { cookie } = await registerAndLogIn('trigger-empty@example.com');

    const response = await getTriggerEvents(cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: unknown[]; hasMore: boolean };
    expect(body.events).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it("only returns the authenticated user's own trigger events", async () => {
    const userA = await registerAndLogIn('trigger-user-a@example.com');
    const userB = await registerAndLogIn('trigger-user-b@example.com');
    await seedTriggerEvent(userA.userId, 1000);
    await seedTriggerEvent(userB.userId, 1000);

    const response = await getTriggerEvents(userA.cookie);
    const body = (await response.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('joins instrument name and currency from the instruments table', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-join@example.com');
    await seedTriggerEvent(userId, 1000, { ticker: '^NDX' });

    const response = await getTriggerEvents(cookie);
    const body = (await response.json()) as { events: { instrumentName: string; currency: string }[] };
    expect(body.events[0].instrumentName).toBe('NASDAQ-100');
    expect(body.events[0].currency).toBe('USD');
  });

  it('falls back to the raw ticker (and null currency) when the instrument no longer exists', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-missing-instrument@example.com');
    await seedTriggerEvent(userId, 1000, { ticker: '^UNKNOWN' });

    const response = await getTriggerEvents(cookie);
    const body = (await response.json()) as { events: { instrumentName: string; currency: string | null }[] };
    expect(body.events[0].instrumentName).toBe('^UNKNOWN');
    expect(body.events[0].currency).toBeNull();
  });

  it('returns events newest-first', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-order@example.com');
    await seedTriggerEvent(userId, 1000);
    await seedTriggerEvent(userId, 3000);
    await seedTriggerEvent(userId, 2000);

    const response = await getTriggerEvents(cookie);
    const body = (await response.json()) as { events: { triggeredAt: number }[] };
    expect(body.events.map((e) => e.triggeredAt)).toEqual([3000, 2000, 1000]);
  });

  it('includes high/low at trigger for a PRICE alert', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-high-low@example.com');
    await seedTriggerEvent(userId, 1000, { highAtTrigger: 22.5, lowAtTrigger: 19.75 });

    const response = await getTriggerEvents(cookie);
    const body = (await response.json()) as { events: { highAtTrigger: number | null; lowAtTrigger: number | null }[] };
    expect(body.events[0].highAtTrigger).toBe(22.5);
    expect(body.events[0].lowAtTrigger).toBe(19.75);
  });

  it('includes the failed email status and error message', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-failed-email@example.com');
    await seedTriggerEvent(userId, 1000, { emailStatus: 'failed', emailError: 'Resend API error: 500' });

    const response = await getTriggerEvents(cookie);
    const body = (await response.json()) as { events: { emailStatus: string; emailError: string | null }[] };
    expect(body.events[0].emailStatus).toBe('failed');
    expect(body.events[0].emailError).toBe('Resend API error: 500');
  });

  it('computes hasMore correctly at the pagination boundary', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-pagination-boundary@example.com');
    await seedTriggerEvent(userId, 1000);
    await seedTriggerEvent(userId, 2000);
    await seedTriggerEvent(userId, 3000);

    const exact = await getTriggerEvents(cookie, { limit: 3 });
    const exactBody = (await exact.json()) as { events: unknown[]; hasMore: boolean };
    expect(exactBody.events).toHaveLength(3);
    expect(exactBody.hasMore).toBe(false);

    const short = await getTriggerEvents(cookie, { limit: 2 });
    const shortBody = (await short.json()) as { events: unknown[]; hasMore: boolean };
    expect(shortBody.events).toHaveLength(2);
    expect(shortBody.hasMore).toBe(true);
  });

  it('applies offset for subsequent pages', async () => {
    const { cookie, userId } = await registerAndLogIn('trigger-offset@example.com');
    await seedTriggerEvent(userId, 1000);
    await seedTriggerEvent(userId, 2000);
    await seedTriggerEvent(userId, 3000);

    const response = await getTriggerEvents(cookie, { limit: 2, offset: 2 });
    const body = (await response.json()) as { events: { triggeredAt: number }[]; hasMore: boolean };
    expect(body.events.map((e) => e.triggeredAt)).toEqual([1000]);
    expect(body.hasMore).toBe(false);
  });
});
