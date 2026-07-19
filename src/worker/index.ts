import { Hono } from 'hono';
import alertsRoutes from './routes/alerts';
import authRoutes from './routes/auth';

export interface Env {
  DB: D1Database;
  PASSWORD_PEPPER: string;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

app.route('/api', authRoutes);
app.route('/api/alerts', alertsRoutes);
app.get('/api/health', (c) => c.json({ ok: true }));

// Anything that isn't an API route is a client-side (Angular Router) path.
// Delegate to the ASSETS binding so its `not_found_handling =
// "single-page-application"` config serves index.html for these instead of
// falling through to Hono's own 404 - without this, direct navigation or a
// refresh on a route like `/login` 404s in the same-origin production build.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default { fetch: app.fetch };
