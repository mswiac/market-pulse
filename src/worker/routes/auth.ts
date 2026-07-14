import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../index';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSession,
  destroySession,
  sessionMiddleware,
  setSessionCookie,
} from '../lib/session';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const INVALID_CREDENTIALS_MESSAGE = 'invalid email or password';

// Not a real user's hash — pays the same PBKDF2 cost as a real verify so an
// unknown email can't be distinguished from a wrong password by timing.
const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$10000$MQ2O9oI268zIzUTxSOGIYQ==$5jcrAH7LuEJ6FWlCqbsy1ebXxreQtxiWS21GxW5ald4=';

type Variables = { userId: number };

const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseCredentialsBody(c: { req: { json: () => Promise<unknown> } }): Promise<{
  email?: unknown;
  password?: unknown;
} | null> {
  try {
    return (await c.req.json()) as { email?: unknown; password?: unknown };
  } catch {
    return null;
  }
}

authRoutes.post('/register', async (c) => {
  const body = await parseCredentialsBody(c);
  const email = body ? normalizeEmail(body.email) : null;
  const password = body && typeof body.password === 'string' ? body.password : null;

  if (
    !email ||
    !EMAIL_PATTERN.test(email) ||
    !password ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return c.json({ error: INVALID_CREDENTIALS_MESSAGE }, 400);
  }

  const passwordHash = await hashPassword(password, c.env.PASSWORD_PEPPER);

  let userId: number;
  try {
    const inserted = await c.env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id')
      .bind(email, passwordHash)
      .first<{ id: number }>();
    userId = inserted!.id;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'email already registered' }, 409);
    }
    throw err;
  }

  const session = await createSession(c.env.DB, userId);
  setSessionCookie(c, session.id);

  return c.json({ id: userId, email }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await parseCredentialsBody(c);
  const email = body ? normalizeEmail(body.email) : null;
  const password = body && typeof body.password === 'string' ? body.password : null;

  if (!email || !password || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: INVALID_CREDENTIALS_MESSAGE }, 401);
  }

  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string }>();

  const passwordValid = await verifyPassword(password, c.env.PASSWORD_PEPPER, user?.password_hash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordValid) {
    return c.json({ error: INVALID_CREDENTIALS_MESSAGE }, 401);
  }

  const session = await createSession(c.env.DB, user.id);
  setSessionCookie(c, session.id);

  return c.json({ id: user.id, email }, 200);
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await destroySession(c.env.DB, sessionId);
  }
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.get('/me', sessionMiddleware, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: number; email: string }>();

  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  return c.json(user, 200);
});

export default authRoutes;
