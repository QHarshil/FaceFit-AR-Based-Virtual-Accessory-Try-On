// The overlay's Three.js stage: renderer, lights, camera and the loaded
// glasses, sized to the video and given its projection.
import type { CameraIntrinsics, Vec2, Vec3 } from '@facefit/cv';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RenderPose } from '../filtering/overlayPose';
import { coverFit, sourceToBox } from '../geometry/coverFit';
import {
  glassesTransform,
  transformPoint,
  type RigidTransform,
} from '../geometry/glassesPlacement';
import type { ProductAnchors } from '../types';
import {
  applyIntrinsics,
  applyTransform,
  eyeToVideoPixel,
  renderPixelRatio,
} from './glassesCamera';

/** What one overlay mount owns; replaced when the model or the attempt changes. */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  container: HTMLElement;
  glasses: THREE.Group | null;
  intrinsics: CameraIntrinsics | null;
}

export interface StageCallbacks {
  onModelLoaded: () => void;
  onModelFailed: (error: unknown) => void;
  onContextLost: () => void;
  onContextRestored: () => void;
}

type TypedMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

// Mesh narrows to Mesh<any, any>; this gives its parts their real types.
const isMesh = (object: THREE.Object3D): object is TypedMesh => object instanceof THREE.Mesh;

const disposeObject = (root: THREE.Object3D) => {
  root.traverse((child) => {
    if (isMesh(child)) {
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => {
        material.dispose();
      });
    }
  });
};

const sameIntrinsics = (a: CameraIntrinsics | null, b: CameraIntrinsics) =>
  a !== null &&
  a.width === b.width &&
  a.height === b.height &&
  a.fx === b.fx &&
  a.fy === b.fy &&
  a.cx === b.cx &&
  a.cy === b.cy;

/**
 * Sizes the drawing buffer to the video times a pixel ratio that covers the
 * displayed size, so the canvas is not stretched soft on large or high-DPI
 * screens. The canvas keeps the video's `object-fit: cover` and mirror (see
 * TryOn.css), so its pixels land on the video pixels they were rendered for.
 */
export const resizeRenderer = (stage: Stage) => {
  if (!stage.intrinsics) return;
  const display = { width: stage.container.clientWidth, height: stage.container.clientHeight };
  stage.renderer.setPixelRatio(
    renderPixelRatio(stage.intrinsics, display, window.devicePixelRatio),
  );
  stage.renderer.setSize(stage.intrinsics.width, stage.intrinsics.height, false);
};

/** Gives the camera the video's projection and sizes the canvas to the video. */
export const fitToVideo = (stage: Stage, intrinsics: CameraIntrinsics) => {
  if (sameIntrinsics(stage.intrinsics, intrinsics)) return;
  if (!applyIntrinsics(stage.camera, intrinsics)) return;
  stage.intrinsics = intrinsics;
  resizeRenderer(stage);
};

// Screen geometry for eval/harness: page NDC of the unmirrored page, as the
// metrics read it, through the same cover fit the CSS applies.
export const pageProjector = (stage: Stage) => {
  const page = { width: stage.container.clientWidth, height: stage.container.clientHeight };
  const intrinsics = stage.intrinsics;
  const fit = intrinsics && coverFit(intrinsics, page);
  if (!intrinsics || !fit) return null;
  return (transform: RigidTransform, modelPoint: Vec3): Vec2 => {
    const eye = transformPoint(transform, modelPoint);
    const [x, y] = sourceToBox(fit, eyeToVideoPixel(stage.camera, intrinsics, eye));
    return [(2 * x) / page.width - 1, 1 - (2 * y) / page.height];
  };
};

export interface PlacedGlasses {
  transform: RigidTransform;
  timestampMs: number;
}

/**
 * Places the glasses at the pose this render should draw. Returns null when
 * the glasses are hidden or there is no pose, which hides them until the next
 * trusted pose.
 */
export const placeGlasses = (
  stage: Stage,
  overlayPose: { poseForRender(): RenderPose | null },
  anchors: ProductAnchors,
): PlacedGlasses | null => {
  const glasses = stage.glasses;
  if (!glasses?.visible) return null;
  const renderPose = overlayPose.poseForRender();
  if (!renderPose) {
    glasses.visible = false;
    return null;
  }
  const transform = glassesTransform(renderPose.pose, anchors.bridgeCenter);
  applyTransform(glasses, transform);
  return { transform, timestampMs: renderPose.timestampMs };
};

/**
 * Creates the renderer, scene and lights in `container` and starts loading
 * the model. Throws when no WebGL context can be created. The returned
 * function releases everything, including a model that loads after it ran.
 */
export const createStage = (
  container: HTMLElement,
  modelPath: string,
  callbacks: StageCallbacks,
): { stage: Stage; dispose: () => void } => {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  // The scene belongs to this mount. A scene shared across mounts kept the
  // lights of every earlier one, which StrictMode doubles in development.
  const scene = new THREE.Scene();
  // Millimetres, at the origin looking down -z; the projection comes from
  // the video's intrinsics once the first frame arrives.
  const camera = new THREE.Camera();
  const stage: Stage = { renderer, scene, camera, container, glasses: null, intrinsics: null };
  let disposed = false;

  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'overlay-canvas';
  container.appendChild(canvas);

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(0, 1, 1);
  scene.add(directionalLight);

  // Three.js calls preventDefault on a lost context so the browser may
  // restore it, and re-uploads the scene on the next render after it does.
  const onLost = () => {
    callbacks.onContextLost();
  };
  const onRestored = () => {
    stage.intrinsics = null;
    callbacks.onContextRestored();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    modelPath,
    (gltf) => {
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      const glasses = new THREE.Group();
      glasses.visible = false;
      glasses.add(gltf.scene);
      scene.add(glasses);
      stage.glasses = glasses;
      callbacks.onModelLoaded();
    },
    undefined,
    (error) => {
      if (!disposed) callbacks.onModelFailed(error);
    },
  );

  const dispose = () => {
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    disposeObject(scene);
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  return { stage, dispose };
};
