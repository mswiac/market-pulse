import type { Env } from '../index';
import { chunk } from './market-data';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export type SendEmailResult = { ok: true } | { ok: false; error: string; transient?: boolean };

const RESEND_FROM_ADDRESS = 'onboarding@resend.dev';
// Resend's /emails/batch accepts at most 100 messages per request.
const MAX_MESSAGES_PER_REQUEST = 100;

// Resend's sandbox (no verified custom domain) only delivers to the
// account's own verified address — confirmed against Resend's docs. The
// pre-flight check below substitutes for parsing Resend's rejection
// response: it's more explicit, and doesn't depend on the wording of a
// third-party error message. Rejected inputs are left out of the request so
// they cannot fail the batch for the messages that are deliverable.
//
// Results are index-aligned with `inputs`. A batch request succeeds or fails
// as a whole, so a failed chunk gives every message in it the same failure.
export async function sendAlertEmailBatch(env: Env, inputs: SendEmailInput[]): Promise<SendEmailResult[]> {
  const results: SendEmailResult[] = new Array(inputs.length);
  const sendable: number[] = [];
  inputs.forEach((input, i) => {
    if (input.to.toLowerCase() !== env.RESEND_VERIFIED_EMAIL.toLowerCase()) {
      results[i] = { ok: false, error: 'recipient not verified in Resend sandbox' };
    } else {
      sendable.push(i);
    }
  });

  for (const indexes of chunk(sendable, MAX_MESSAGES_PER_REQUEST)) {
    const outcome = await postBatch(
      env,
      indexes.map((i) => inputs[i]),
    );
    for (const i of indexes) results[i] = outcome;
  }

  return results;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function postBatch(env: Env, inputs: SendEmailInput[]): Promise<SendEmailResult> {
  // Resend validates a batch strictly: one invalid message fails the whole
  // request. Not reachable while the sandbox only accepts the verified
  // address (filtered above); revisit once a custom domain is verified.
  const body = JSON.stringify(inputs.map(({ to, subject, text }) => ({ from: RESEND_FROM_ADDRESS, to, subject, text })));

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // Derived from the payload (which carries the trigger date and
        // values) so re-sending the same batch within Resend's 24h window —
        // after a failed D1 write, or a network error after Resend already
        // accepted it — is deduplicated instead of mailing everyone twice.
        'Idempotency-Key': `alert-batch-${await sha256Hex(body)}`,
      },
      body,
    });
  } catch (err) {
    // A rejecting fetch (network/DNS/timeout) is retry-worthy, unlike a
    // non-ok HTTP response or an unverified recipient — the `transient`
    // flag lets alert-evaluation.ts leave the alert armed instead of
    // disarming on a failure that may resolve itself by tomorrow's cron.
    return { ok: false, error: `network error: ${err instanceof Error ? err.message : String(err)}`, transient: true };
  }

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Resend's error responses are normally JSON; fall back to statusText
      // if this one wasn't (e.g. an upstream gateway error).
    }
    // A 5xx is Resend's own server failing, not a rejection of this
    // specific request — retry-worthy like a network-level throw, unlike a
    // 4xx (bad request/unverified recipient), which won't change on retry.
    // 429 (rate limit) and 408 (timeout) are 4xx but say nothing about the
    // request itself, so they retry too — and a batch loses up to 100 alerts
    // at once if they are wrongly treated as permanent.
    // 409 is Resend's answer to an identical batch (same Idempotency-Key)
    // that is still being processed. The key is a hash of the payload, so the
    // "same key, different payload" variant cannot occur here: the batch is
    // either already going out or can safely be retried.
    const transient =
      response.status >= 500 || response.status === 429 || response.status === 408 || response.status === 409;
    return { ok: false, error: message, transient };
  }

  return { ok: true };
}
