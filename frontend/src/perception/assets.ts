// Same-origin paths of the pinned MediaPipe runtime and model. The version in
// the path changes whenever the package version does.
const base = import.meta.env.BASE_URL.replace(/\/+$/, '');

export const PERCEPTION_ASSETS = {
  wasmBaseUrl: `${base}/mediapipe/tasks-vision/${__TASKS_VISION_VERSION__}`,
  modelUrl: `${base}/mediapipe/face_landmarker/float16/1/face_landmarker.task`,
} as const;
