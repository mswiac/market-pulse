import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyCronFailure } from '../../src/worker/lib/cron-failure-notice';

function okResponse(): Response {
  return new Response(JSON.stringify({ data: [{ id: 'x' }] }), { status: 200 });
}

function sentMessage(fetchSpy: ReturnType<typeof vi.fn>) {
  return JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notifyCronFailure', () => {
  it('sends nothing when there are no problems', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await notifyCronFailure(env, 'US fetch', []);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends one email to the verified address with the phase, the date and every problem', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(okResponse()));
    vi.stubGlobal('fetch', fetchSpy);

    await notifyCronFailure(env, 'GPW fetch', ['CDR: 500', 'PKN: timeout']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const message = sentMessage(fetchSpy);
    expect(message.to).toBe('verified@example.com');
    expect(message.subject).toBe(`MarketPulse: GPW fetch had problems (${new Date().toISOString().slice(0, 10)})`);
    expect(message.text).toBe('GPW fetch reported 2 problem(s):\n\nCDR: 500\nPKN: timeout\n');
  });

  it('does not log an error or add a "more" line when the notice is sent and every problem fits', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(okResponse()));
    vi.stubGlobal('fetch', fetchSpy);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyCronFailure(
      env,
      'US fetch',
      Array.from({ length: 20 }, (_, i) => `T${i}: failed`),
    );

    expect(sentMessage(fetchSpy).text).not.toContain('more');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('lists at most 20 problems and counts the rest', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(okResponse()));
    vi.stubGlobal('fetch', fetchSpy);

    await notifyCronFailure(
      env,
      'US fetch',
      Array.from({ length: 25 }, (_, i) => `T${i}: failed`),
    );

    const { text } = sentMessage(fetchSpy);
    expect(text).toContain('T19: failed');
    expect(text).not.toContain('T20: failed');
    expect(text).toContain('... and 5 more');
  });

  it('logs and does not throw when Resend rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'bad key' }), { status: 403 })));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyCronFailure(env, 'US fetch', ['x'])).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad key'));
  });

  it('logs and does not throw when the recipient is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notifyCronFailure({ ...env, RESEND_VERIFIED_EMAIL: undefined } as unknown as typeof env, 'US fetch', ['x']),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs and does not throw when the request itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyCronFailure(env, 'US fetch', ['x'])).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});
