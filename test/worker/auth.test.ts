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

  it('logs in with correct credentials', async () => {
    const email = 'login-flow@example.com';
    await register(email);

    const loginResponse = await login(email);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('set-cookie')).toBeTruthy();
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
  });

  it('logout is idempotent even without an existing session', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/logout`, { method: 'POST' });
    expect(response.status).toBe(204);
  });
});
