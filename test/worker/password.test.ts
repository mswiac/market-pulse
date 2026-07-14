import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/worker/lib/password';

const PEPPER = 'test-pepper';
// Low iteration count keeps this suite fast; verifyPassword reads the real
// count back out of the stored string, so this doesn't affect correctness.
const TEST_ITERATIONS = 100;

describe('password hashing', () => {
  it('verifies a matching password', async () => {
    const hash = await hashPassword('correct horse battery staple', PEPPER, TEST_ITERATIONS);
    await expect(verifyPassword('correct horse battery staple', PEPPER, hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple', PEPPER, TEST_ITERATIONS);
    await expect(verifyPassword('a totally different password', PEPPER, hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same password', PEPPER, TEST_ITERATIONS);
    const b = await hashPassword('same password', PEPPER, TEST_ITERATIONS);
    expect(a).not.toBe(b);
  });

  it('rejects verification when the pepper does not match', async () => {
    const hash = await hashPassword('correct horse battery staple', PEPPER, TEST_ITERATIONS);
    await expect(verifyPassword('correct horse battery staple', 'a different pepper', hash)).resolves.toBe(false);
  });
});
