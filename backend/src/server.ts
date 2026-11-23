import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env['PORT'] ?? 5055);
serve({ fetch: createApp().fetch, port });
