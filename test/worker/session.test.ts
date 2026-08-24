import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession, validateSession } from '../../src/worker/lib/session';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const RENEWAL_THRESHOLD_SECONDS = 60 * 60;

async function insertUser(email: string): Promise<number> {
  const row = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id')
    .bind(email, 'unused-hash')
    .first<{ id: number }>();
  return row!.id;
}

describe('validateSession', () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM users WHERE email LIKE 'session-test-%'").run();
  });

  it('rejects an already-expired session', async () => {
    const userId = await insertUser('session-test-expired@example.com');
    const session = await createSession(env.DB, userId);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now - 1, session.id).run();

    await expect(validateSession(env.DB, session.id)).resolves.toBeNull();
  });

  it('rejects a session expiring in the same second as the check (inclusive boundary)', async () => {
    const userId = await insertUser('session-test-boundary@example.com');
    const session = await createSession(env.DB, userId);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now, session.id).run();

    await expect(validateSession(env.DB, session.id)).resolves.toBeNull();
  });

  it('does not rewrite expires_at for a session comfortably inside the renewal threshold', async () => {
    const userId = await insertUser('session-test-fresh@example.com');
    const session = await createSession(env.DB, userId);
    const now = Math.floor(Date.now() / 1000);
    // 1 second into the TTL: elapsedSinceIssue = 1, well below the 1-hour renewal threshold
    const justIssued = now + SESSION_TTL_SECONDS - 1;
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(justIssued, session.id).run();

    await expect(validateSession(env.DB, session.id)).resolves.toEqual({ userId });

    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ?')
      .bind(session.id)
      .first<{ expires_at: number }>();
    expect(row!.expires_at).toBe(justIssued);
  });

  it('renews expires_at once the renewal threshold has elapsed since issue', async () => {
    const userId = await insertUser('session-test-renew@example.com');
    const session = await createSession(env.DB, userId);
    const now = Math.floor(Date.now() / 1000);
    // 1 second past the renewal threshold, still short of expiry
    const almostDue = now + SESSION_TTL_SECONDS - RENEWAL_THRESHOLD_SECONDS - 1;
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(almostDue, session.id).run();

    await expect(validateSession(env.DB, session.id)).resolves.toEqual({ userId });

    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ?')
      .bind(session.id)
      .first<{ expires_at: number }>();
    expect(row!.expires_at).toBeGreaterThan(almostDue);
  });
});
