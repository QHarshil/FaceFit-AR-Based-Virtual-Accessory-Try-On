import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const tasksVisionVersion = (
  JSON.parse(
    readFileSync(
      new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url),
      'utf8',
    ),
  ) as { version: string }
).version;

const LEGACY_MEDIAPIPE =
  /node_modules[\\/]@mediapipe[\\/](face_mesh|camera_utils)[\\/][a-z_]+\.js$/;

// Both legacy packages declare `sideEffects: []`, so the bundler would drop the
// import that makes them register FaceMesh and Camera on the global object.
const mediapipeSideEffects = (): Plugin => ({
  name: 'mediapipe-side-effects',
  enforce: 'pre',
  transform(code, id) {
    if (!LEGACY_MEDIAPIPE.test(id)) return null;
    return { code, map: null, moduleSideEffects: true };
  },
});

export default defineConfig({
  plugins: [mediapipeSideEffects(), react()],
  define: { __TASKS_VISION_VERSION__: JSON.stringify(tasksVisionVersion) },
  optimizeDeps: { exclude: ['@mediapipe/face_mesh', '@mediapipe/camera_utils'] },
  server: { port: 3000 },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
  },
});
