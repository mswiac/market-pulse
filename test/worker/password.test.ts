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

describe('verifyPassword against a malformed stored hash', () => {
  it('rejects a stored hash padded with extra trailing bytes beyond the real derived length', async () => {
    // The comparison loop is bounded by the *derived* (32-byte) length, so
    // without the explicit length check, a longer stored value whose first
    // 32 bytes genuinely match would slip through as "equal".
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password, PEPPER, TEST_ITERATIONS);
    const [algorithm, iterations, saltB64, hashB64] = hash.split('$');
    const realBytes = Buffer.from(hashB64, 'base64');
    const paddedHashB64 = Buffer.concat([realBytes, Buffer.from([1, 2, 3, 4])]).toString('base64');
    const padded = `${algorithm}$${iterations}$${saltB64}$${paddedHashB64}`;

    await expect(verifyPassword(password, PEPPER, padded)).resolves.toBe(false);
  });

  it('rejects a stored hash with an unexpected number of $-separated segments, even if the first four are valid', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password, PEPPER, TEST_ITERATIONS);

    await expect(verifyPassword(password, PEPPER, `${hash}$unexpected`)).resolves.toBe(false);
  });

  it('rejects a stored hash whose parts are otherwise valid but labeled with a different algorithm id', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password, PEPPER, TEST_ITERATIONS);
    const relabeled = hash.replace(/^pbkdf2-sha256/, 'pbkdf2-sha1');

    await expect(verifyPassword(password, PEPPER, relabeled)).resolves.toBe(false);
  });

  it('rejects a stored hash with a non-numeric iteration count', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password, PEPPER, TEST_ITERATIONS);
    const malformed = hash.replace(/\$\d+\$/, '$notanumber$');

    await expect(verifyPassword(password, PEPPER, malformed)).resolves.toBe(false);
  });

  it('rejects a stored hash with a zero iteration count', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password, PEPPER, TEST_ITERATIONS);
    const malformed = hash.replace(/\$\d+\$/, '$0$');

    await expect(verifyPassword(password, PEPPER, malformed)).resolves.toBe(false);
  });
});
