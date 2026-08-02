import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';

export function isAdminEmail(adminEmailsEnv: string, email: string): boolean {
  const admins = adminEmailsEnv.split(',').map((e) => e.trim().toLowerCase());
  return admins.includes(email.trim().toLowerCase());
}

type Variables = { userId: number };

// Runs after sessionMiddleware — reads c.get('userId'), so must be chained
// second. Client-side admin flags are UX-only; this re-derives admin status
// from the DB on every request, independent of anything the client claims.
export const adminMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();

  if (!user || !isAdminEmail(c.env.ADMIN_EMAILS, user.email)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  return await next();
};
