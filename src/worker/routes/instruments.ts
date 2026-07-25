import { Hono } from 'hono';
import type { Env } from '../index';
import { sessionMiddleware } from '../lib/session';

type Variables = { userId: number };

const instrumentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

instrumentsRoutes.use('*', sessionMiddleware);

instrumentsRoutes.get('/', async (c) => {
  const type = c.req.query('type');

  const { results } = type
    ? await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible FROM instruments WHERE type = ?')
        .bind(type)
        .all()
    : await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible FROM instruments').all();

  return c.json(results, 200);
});

export default instrumentsRoutes;
