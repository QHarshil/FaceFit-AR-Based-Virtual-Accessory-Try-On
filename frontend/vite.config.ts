import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { apiOriginOf, contentSecurityPolicy } from './csp';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Same fallback as src/services/apiClient.ts.
const DEFAULT_API_URL = 'http://localhost:5055';

// Part of the self-hosted asset path, so a version change also changes the URL.
const tasksVisionVersion = (
  JSON.parse(
    readFileSync(
      new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url),
      'utf8',
    ),
  ) as { version: string }
).version;

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ROOT, 'VITE_');
  const apiOrigin = apiOriginOf(env.VITE_API_URL || DEFAULT_API_URL);
  // A fresh nonce per dev server start; the production policy has none.
  const devNonce = randomBytes(16).toString('base64');

  return {
    plugins: [react()],
    define: { __TASKS_VISION_VERSION__: JSON.stringify(tasksVisionVersion) },
    html: command === 'serve' ? { cspNonce: devNonce } : {},
    server: {
      port: 3000,
      headers: {
        'Content-Security-Policy': contentSecurityPolicy({ apiOrigin, nonce: devNonce }),
      },
    },
    preview: {
      headers: { 'Content-Security-Policy': contentSecurityPolicy({ apiOrigin }) },
    },
    build: { outDir: 'dist', sourcemap: false },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
      css: false,
    },
  };
});
