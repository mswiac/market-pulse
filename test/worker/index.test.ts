import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'https://example.com';

describe('GET /api/health', () => {
  it('returns 200 with { ok: true }', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
