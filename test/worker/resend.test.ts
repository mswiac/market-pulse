import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAlertEmailBatch } from '../../src/worker/lib/resend';

const VERIFIED_EMAIL = 'verified@example.com'; // matches vitest.config.mts RESEND_VERIFIED_EMAIL
const INPUT = { to: VERIFIED_EMAIL, subject: 'Test subject', text: 'Test body' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function sendOne(input = INPUT) {
  const [result] = await sendAlertEmailBatch(env, [input]);
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendAlertEmailBatch', () => {
  it('posts the messages to the Resend batch endpoint with the configured API key', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'fake-resend-id' }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendOne();

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails/batch');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${env.RESEND_API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual([{ from: 'onboarding@resend.dev', to: VERIFIED_EMAIL, subject: INPUT.subject, text: INPUT.text }]);
  });

  it('rejects a recipient that is not the Resend-verified address, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendOne({ ...INPUT, to: 'someone-else@example.com' });

    expect(result).toEqual({ ok: false, error: 'recipient not verified in Resend sandbox' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves an unverified recipient out of the request so it cannot fail the deliverable messages', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'a' }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const results = await sendAlertEmailBatch(env, [
      { ...INPUT, to: 'someone-else@example.com', subject: 'rejected' },
      { ...INPUT, subject: 'delivered' },
    ]);

    expect(results[0]).toEqual({ ok: false, error: 'recipient not verified in Resend sandbox' });
    expect(results[1]).toEqual({ ok: true });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toHaveLength(1);
    expect(body[0].subject).toBe('delivered');
  });

  it('splits more than 100 messages into several requests of at most 100', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { data: [] })));
    vi.stubGlobal('fetch', fetchSpy);

    const results = await sendAlertEmailBatch(
      env,
      Array.from({ length: 101 }, (_, i) => ({ ...INPUT, subject: `message ${i}` })),
    );

    expect(results).toHaveLength(101);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const sizes = fetchSpy.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).length);
    expect(sizes).toEqual([100, 1]);
  });

  it('gives every message in a failed chunk the same failure, leaving other chunks unaffected', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(422, { message: 'invalid from address' }));
    vi.stubGlobal('fetch', fetchSpy);

    const results = await sendAlertEmailBatch(
      env,
      Array.from({ length: 101 }, (_, i) => ({ ...INPUT, subject: `message ${i}` })),
    );

    expect(results.slice(0, 100).every((r) => r.ok)).toBe(true);
    expect(results[100]).toEqual({ ok: false, error: 'invalid from address', transient: false });
  });

  it('returns the Resend error message for a non-ok JSON response, not marked transient (4xx)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, { message: 'invalid from address' })));

    expect(await sendOne()).toEqual({ ok: false, error: 'invalid from address', transient: false });
  });

  it('falls back to statusText when the JSON error body has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 422, statusText: 'Unprocessable Entity' })));

    expect(await sendOne()).toEqual({ ok: false, error: 'Unprocessable Entity', transient: false });
  });

  it('marks exactly a 500 status as transient (inclusive boundary)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 })));

    expect(await sendOne()).toMatchObject({ transient: true });
  });

  it('falls back to statusText for a non-ok response with a non-JSON body, marked transient (5xx)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway error', { status: 502, statusText: 'Bad Gateway' })),
    );

    expect(await sendOne()).toEqual({ ok: false, error: 'Bad Gateway', transient: true });
  });

  it('catches a throwing fetch and reports it as a transient failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('simulated network failure')));

    const result = await sendOne();

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ transient: true });
    if (!result.ok) expect(result.error).toContain('simulated network failure');
  });
});
