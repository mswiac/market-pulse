import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'https://example.com';
const PASSWORD = 'correct horse battery staple';

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a Set-Cookie header');
  return setCookie.split(';')[0];
}

async function register(email: string, password = PASSWORD): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function login(email: string, password = PASSWORD): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('auth endpoints', () => {
  it('registers, auto-logs-in, reads /me, then logs out', async () => {
    const email = 'register-flow@example.com';

    const registerResponse = await register(email);
    expect(registerResponse.status).toBe(201);
    const cookie = sessionCookieFrom(registerResponse);

    const meResponse = await exports.default.fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: cookie },
    });
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({ email });

    const logoutResponse = await exports.default.fetch(`${BASE_URL}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logoutResponse.status).toBe(204);

    const meAfterLogout = await exports.default.fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: cookie },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects registering the same email twice with 409', async () => {
    const email = 'duplicate@example.com';

    await register(email);
    const second = await register(email);

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'email already registered' });
  });

  it('rejects registration with a malformed email address', async () => {
    const response = await register('not-an-email');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('rejects registration with a password shorter than 8 characters', async () => {
    const response = await register('short-password@example.com', 'short12');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('rejects registration with a password longer than 128 characters', async () => {
    const response = await register('long-password@example.com', 'a'.repeat(129));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('accepts registration with a password of exactly 8 characters (lower boundary)', async () => {
    const response = await register('min-length-password@example.com', 'a'.repeat(8));

    expect(response.status).toBe(201);
  });

  it('accepts registration with a password of exactly 128 characters (upper boundary)', async () => {
    const response = await register('max-length-password@example.com', 'a'.repeat(128));

    expect(response.status).toBe(201);
  });

  it('logs in with correct credentials', async () => {
    const email = 'login-flow@example.com';
    await register(email);

    const loginResponse = await login(email);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('set-cookie')).toBeTruthy();
    await expect(loginResponse.json()).resolves.toMatchObject({ email, isAdmin: false });
  });

  it('rejects login with a password longer than 128 characters using the generic message', async () => {
    const email = 'login-long-password@example.com';
    await register(email);

    const response = await login(email, 'a'.repeat(129));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('logs in with a password of exactly 128 characters (upper boundary)', async () => {
    const email = 'login-max-length-password@example.com';
    const password = 'a'.repeat(128);
    await register(email, password);

    const response = await login(email, password);

    expect(response.status).toBe(200);
  });

  it('rejects login with a wrong password using the generic message', async () => {
    const email = 'wrong-password@example.com';
    await register(email);

    const response = await login(email, 'not the right password');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('rejects login for an unknown email using the same generic message', async () => {
    const response = await login('nobody-registered@example.com');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid email or password' });
  });

  it('rejects /me without a session', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/me`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('does not mark the cleared cookie Secure when the request is not made over https', async () => {
    const response = await exports.default.fetch('http://example.com/api/logout', { method: 'POST' });

    const cleared = response.headers.get('set-cookie');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toContain('Secure');
  });

  it('rejects /me with an unknown session id and clears the stale cookie', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: 'session_id=not-a-real-session' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    const cleared = response.headers.get('set-cookie');
    expect(cleared).toContain('session_id=;');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    expect(cleared).toContain('Secure');
  });

  it('re-issues the session cookie with a fresh 7-day Max-Age on an authenticated request', async () => {
    const registerResponse = await register('cookie-refresh@example.com');
    const cookie = sessionCookieFrom(registerResponse);

    const meResponse = await exports.default.fetch(`${BASE_URL}/api/me`, { headers: { Cookie: cookie } });

    const refreshed = meResponse.headers.get('set-cookie');
    expect(refreshed).toContain(cookie);
    expect(refreshed).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
    expect(refreshed).toContain('HttpOnly');
  });

  it.each([
    ['a malformed JSON body', 'not json'],
    ['a missing password', JSON.stringify({ email: 'bad-login@example.com' })],
    ['a non-string password', JSON.stringify({ email: 'bad-login@example.com', password: 12345678 })],
    ['a missing email', JSON.stringify({ password: PASSWORD })],
  ])('rejects login with %s using the generic message', async (_label, body) => {
    const response = await exports.default.fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid email or password' });
  });

  it.each([
    ['a malformed JSON body', 'not json'],
    ['a non-string password', JSON.stringify({ email: 'bad-register@example.com', password: 12345678 })],
  ])('rejects registration with %s using the generic message', async (_label, body) => {
    const response = await exports.default.fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid email or password' });
  });

  it('logout is idempotent even without an existing session', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/logout`, { method: 'POST' });
    expect(response.status).toBe(204);
  });

  it('sets a secure, httpOnly, path=/ session cookie with a 7-day Max-Age over https', async () => {
    const response = await register('cookie-attrs-https@example.com');

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
  });

  it('omits the Secure attribute when the request is not made over https', async () => {
    const response = await exports.default.fetch('http://example.com/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-attrs-http@example.com', password: PASSWORD }),
    });

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).not.toContain('Secure');
  });

  it('clears the session cookie on logout', async () => {
    const email = 'logout-clears-cookie@example.com';
    const registerResponse = await register(email);
    const cookie = sessionCookieFrom(registerResponse);

    const logoutResponse = await exports.default.fetch(`${BASE_URL}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const clearedCookie = logoutResponse.headers.get('set-cookie');
    expect(clearedCookie).toContain('Max-Age=0');
    expect(clearedCookie).toContain('Path=/');
    expect(clearedCookie).toContain('HttpOnly');
    expect(clearedCookie).toContain('SameSite=Lax');
    expect(clearedCookie).toContain('Secure');
  });
});
