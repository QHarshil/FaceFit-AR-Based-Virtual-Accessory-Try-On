// Same-origin URLs of the pinned MediaPipe runtime and model. The version in
// the path changes whenever the package version does.
//
// The URLs are absolute because the Vite dev server appends `?import` to
// root-relative dynamic imports, then refuses that query for files in public/.
// MediaPipe loads its WASM glue with a dynamic import.
const at = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

export const PERCEPTION_ASSETS = {
  wasmBaseUrl: at(`mediapipe/tasks-vision/${__TASKS_VISION_VERSION__}`),
  modelUrl: at('mediapipe/face_landmarker/float16/1/face_landmarker.task'),
} as const;
