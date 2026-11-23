import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Part of the self-hosted asset path, so a version change also changes the URL.
const tasksVisionVersion = (
  JSON.parse(
    readFileSync(
      new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url),
      'utf8',
    ),
  ) as { version: string }
).version;

export default defineConfig({
  plugins: [react()],
  define: { __TASKS_VISION_VERSION__: JSON.stringify(tasksVisionVersion) },
  server: { port: 3000 },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
  },
});
