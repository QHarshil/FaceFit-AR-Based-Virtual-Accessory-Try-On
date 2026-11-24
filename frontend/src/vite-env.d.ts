/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Faces FaceLandmarker tracks; 1 when unset. */
  readonly VITE_NUM_FACES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Version of @mediapipe/tasks-vision, injected by vite.config.ts. */
declare const __TASKS_VISION_VERSION__: string;
