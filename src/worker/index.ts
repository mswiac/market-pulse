import { Hono } from 'hono';
import authRoutes from './routes/auth';

export interface Env {
  DB: D1Database;
  PASSWORD_PEPPER: string;
}

const app = new Hono<{ Bindings: Env }>();

app.route('/api', authRoutes);
app.get('/api/health', (c) => c.json({ ok: true }));

export default { fetch: app.fetch };
