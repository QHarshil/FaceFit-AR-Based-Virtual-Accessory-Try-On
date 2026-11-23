import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const LEGACY_MEDIAPIPE =
  /node_modules[\\/]@mediapipe[\\/](face_mesh|camera_utils)[\\/][a-z_]+\.js$/;

// The legacy MediaPipe scripts end in `.call(this)` and register their classes on
// that object. Bundled as a module, `this` is not the window, so the classes would
// never reach the global scope that src/tracking/mediapipeGlobals.ts reads.
const mediapipeGlobalScope = (): Plugin => ({
  name: 'mediapipe-global-scope',
  enforce: 'pre',
  transform(code, id) {
    if (!LEGACY_MEDIAPIPE.test(id)) return null;
    return {
      code: code.replace(/\}\)\.call\(this\);\s*$/, '}).call(globalThis);'),
      map: null,
      // Both packages declare `sideEffects: []`, which would drop the import.
      moduleSideEffects: true,
    };
  },
});

export default defineConfig({
  plugins: [mediapipeGlobalScope(), react()],
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
