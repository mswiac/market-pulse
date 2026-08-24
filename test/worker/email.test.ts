import { describe, expect, it } from 'vitest';
import { EMAIL_PATTERN, normalizeEmail } from '../../src/worker/lib/email';

describe('normalizeEmail', () => {
  it('returns null for non-string input', () => {
    expect(normalizeEmail(123)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it('trims surrounding whitespace and lowercases the result', () => {
    expect(normalizeEmail('  User@EXAMPLE.com  ')).toBe('user@example.com');
  });

  it('returns null for a string that is only whitespace', () => {
    expect(normalizeEmail('   ')).toBeNull();
  });
});

describe('EMAIL_PATTERN', () => {
  it('matches a well-formed address', () => {
    expect(EMAIL_PATTERN.test('user@example.com')).toBe(true);
  });

  it('rejects an address with a leading stray @ (anchored at start)', () => {
    expect(EMAIL_PATTERN.test('@user@example.com')).toBe(false);
  });

  it('rejects an address with trailing garbage after the domain (anchored at end)', () => {
    expect(EMAIL_PATTERN.test('user@example.com@extra')).toBe(false);
  });
});
