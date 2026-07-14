import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../index';

export const SESSION_COOKIE_NAME = 'session_id';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
// Only renew (and rewrite `expires_at`) once this much of the TTL has
// already elapsed since the session was last (re)issued — avoids a D1
// write on every authenticated request.
const RENEWAL_THRESHOLD_SECONDS = 60 * 60; // 1 hour

function generateSessionId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function createSession(db: D1Database, userId: number): Promise<{ id: string; expiresAt: number }> {
  const id = generateSessionId();
  const expiresAt = nowSeconds() + SESSION_TTL_SECONDS;
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expiresAt).run();
  return { id, expiresAt };
}

export async function validateSession(db: D1Database, sessionId: string): Promise<{ userId: number } | null> {
  const row = await db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ user_id: number; expires_at: number }>();
  if (!row) return null;

  const now = nowSeconds();
  if (row.expires_at <= now) return null;

  const elapsedSinceIssue = SESSION_TTL_SECONDS - (row.expires_at - now);
  if (elapsedSinceIssue >= RENEWAL_THRESHOLD_SECONDS) {
    await db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .bind(now + SESSION_TTL_SECONDS, sessionId)
      .run();
  }

  return { userId: row.user_id };
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export function setSessionCookie(c: Context, sessionId: string): void {
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  const secure = new URL(c.req.url).protocol === 'https:';
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', secure, httpOnly: true, sameSite: 'Lax' });
}

type SessionVariables = { userId: number };

export const sessionMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: SessionVariables }> = async (
  c,
  next,
) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const session = await validateSession(c.env.DB, sessionId);
  if (!session) {
    clearSessionCookie(c);
    return c.json({ error: 'unauthorized' }, 401);
  }

  c.set('userId', session.userId);
  // Refresh the cookie's own lifetime on every request (cheap - no D1
  // write); the D1 row itself is only rewritten past the threshold above.
  setSessionCookie(c, sessionId);
  return await next();
};
