import type { Env } from '../index';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export type SendEmailResult = { ok: true } | { ok: false; error: string; transient?: boolean };

const RESEND_FROM_ADDRESS = 'onboarding@resend.dev';

// Resend's sandbox (no verified custom domain) only delivers to the
// account's own verified address — confirmed against Resend's docs. The
// pre-flight check below substitutes for parsing Resend's rejection
// response: it's more explicit, and doesn't depend on the wording of a
// third-party error message.
export async function sendAlertEmail(env: Env, { to, subject, text }: SendEmailInput): Promise<SendEmailResult> {
  if (to.toLowerCase() !== env.RESEND_VERIFIED_EMAIL.toLowerCase()) {
    return { ok: false, error: 'recipient not verified in Resend sandbox' };
  }

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM_ADDRESS, to, subject, text }),
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
    return { ok: false, error: message };
  }

  return { ok: true };
}
