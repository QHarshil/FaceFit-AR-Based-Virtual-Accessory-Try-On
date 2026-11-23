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

const globals = globalThis as MediapipeGlobals;

if (!globals.Camera || !globals.FaceMesh) {
  throw new Error('MediaPipe scripts did not register their classes');
}

export const Camera: typeof CameraClass = globals.Camera;
export const FaceMesh: typeof FaceMeshClass = globals.FaceMesh;
