import { describe, expect, it } from 'vitest';
import { isAdminEmail } from '../../src/worker/lib/admin';

describe('isAdminEmail', () => {
  it('matches an email against a comma-separated admin list', () => {
    expect(isAdminEmail('admin@example.com,admin2@example.com', 'admin2@example.com')).toBe(true);
    expect(isAdminEmail('admin@example.com,admin2@example.com', 'nobody@example.com')).toBe(false);
  });

  it('trims whitespace around each entry in the admin list', () => {
    expect(isAdminEmail('admin@example.com, admin2@example.com', 'admin2@example.com')).toBe(true);
  });

  it('trims whitespace on the email being checked', () => {
    expect(isAdminEmail('admin@example.com', '  admin@example.com  ')).toBe(true);
  });
});
