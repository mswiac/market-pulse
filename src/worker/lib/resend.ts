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

async function postBatch(env: Env, inputs: SendEmailInput[]): Promise<SendEmailResult> {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inputs.map(({ to, subject, text }) => ({ from: RESEND_FROM_ADDRESS, to, subject, text }))),
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
    return { ok: false, error: message, transient: response.status >= 500 };
  }

  return { ok: true };
}
