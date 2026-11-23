import { Hono } from 'hono';

export const createApp = (): Hono => {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  return app;
};
