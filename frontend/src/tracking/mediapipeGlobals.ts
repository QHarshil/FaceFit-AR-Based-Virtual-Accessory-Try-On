// The legacy MediaPipe bundles are Closure scripts with no ES exports: they attach
// FaceMesh and Camera to the global object when evaluated. Importing them for
// their side effect keeps them in the Vite bundle, then the classes are read back.
import '@mediapipe/camera_utils';
import '@mediapipe/face_mesh';
import type { Camera as CameraClass } from '@mediapipe/camera_utils';
import type { FaceMesh as FaceMeshClass } from '@mediapipe/face_mesh';

interface MediapipeGlobals {
  Camera?: typeof CameraClass | undefined;
  FaceMesh?: typeof FaceMeshClass | undefined;
}

export interface MediapipeClasses {
  Camera: typeof CameraClass;
  FaceMesh: typeof FaceMeshClass;
}

// Checked when tracking starts, not at import, so a missing global shows the
// camera error screen and does not take down every page that imports TryOn.
export const getMediapipe = (): MediapipeClasses => {
  const { Camera, FaceMesh } = globalThis as MediapipeGlobals;
  if (!Camera || !FaceMesh) {
    throw new Error('MediaPipe scripts did not register their classes');
  }
  return { Camera, FaceMesh };
};
