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
    expect(message.text).toContain('2 problem(s)');
    expect(message.text).toContain('CDR: 500');
    expect(message.text).toContain('PKN: timeout');
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

  it('logs and does not throw when the request itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyCronFailure(env, 'US fetch', ['x'])).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});
