const ALGORITHM_ID = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

// Bounded by the Workers Free plan's ~10ms CPU-per-request budget, not by
// security preference or workerd's own 100,000-iteration hard cap. Do not
// raise this toward OWASP's 600k recommendation without re-measuring actual
// CPU time on this plan (see context/foundation/infrastructure.md risk register).
const DEFAULT_ITERATIONS = 10_000;

async function pepperPassword(password: string, pepper: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
}

async function deriveBits(peppered: ArrayBuffer, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, DERIVED_KEY_BITS);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hashPassword(
  password: string,
  pepper: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const peppered = await pepperPassword(password, pepper);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(peppered, salt, iterations);
  const saltB64 = Buffer.from(salt).toString('base64');
  const hashB64 = Buffer.from(derived).toString('base64');
  return `${ALGORITHM_ID}$${iterations}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password: string, pepper: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM_ID) return false;

  const [, iterationsRaw, saltB64, hashB64] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = new Uint8Array(Buffer.from(saltB64, 'base64'));
  const expected = new Uint8Array(Buffer.from(hashB64, 'base64'));
  const peppered = await pepperPassword(password, pepper);
  const actual = new Uint8Array(await deriveBits(peppered, salt, iterations));

  return constantTimeEqual(actual, expected);
}
