import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAlertEmail } from '../../src/worker/lib/resend';

const VERIFIED_EMAIL = 'verified@example.com'; // matches vitest.config.mts RESEND_VERIFIED_EMAIL
const INPUT = { to: VERIFIED_EMAIL, subject: 'Test subject', text: 'Test body' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendAlertEmail', () => {
  it('posts to Resend with the given to/subject/text and the configured API key', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'fake-resend-id' }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendAlertEmail(env, INPUT);

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${env.RESEND_API_KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: VERIFIED_EMAIL, subject: INPUT.subject, text: INPUT.text });
  });

  it('rejects a recipient that is not the Resend-verified address, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendAlertEmail(env, { ...INPUT, to: 'someone-else@example.com' });

    expect(result).toEqual({ ok: false, error: 'recipient not verified in Resend sandbox' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the Resend error message for a non-ok JSON response, not marked transient (4xx)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, { message: 'invalid from address' })));

    const result = await sendAlertEmail(env, INPUT);

    expect(result).toEqual({ ok: false, error: 'invalid from address', transient: false });
  });

  it('falls back to statusText for a non-ok response with a non-JSON body, marked transient (5xx)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway error', { status: 502, statusText: 'Bad Gateway' })),
    );

    const result = await sendAlertEmail(env, INPUT);

    expect(result).toEqual({ ok: false, error: 'Bad Gateway', transient: true });
  });

  it('catches a throwing fetch and reports it as a transient failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('simulated network failure')));

    const result = await sendAlertEmail(env, INPUT);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ transient: true });
    if (!result.ok) expect(result.error).toContain('simulated network failure');
  });
});
