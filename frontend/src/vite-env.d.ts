/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Version of @mediapipe/tasks-vision, injected by vite.config.ts. */
declare const __TASKS_VISION_VERSION__: string;
