import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { CameraIntrinsics, Vec2, Vec3 } from '@facefit/cv';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { coverFit, sourceToBox } from '../geometry/coverFit';
import {
  glassesTransform,
  transformPoint,
  type RigidTransform,
} from '../geometry/glassesPlacement';
import {
  createHeadPoseTracker,
  MAX_RMS_REPROJECTION_MM,
  type HeadPoseEstimate,
} from '../geometry/headPose';
import { hasFace, landmarkPoint, type LandmarkFrame } from '../perception/types';
import {
  applyIntrinsics,
  applyTransform,
  eyeToVideoPixel,
  renderPixelRatio,
} from '../rendering/glassesCamera';
import type { ARTryOnHandle, ProductAnchors } from '../types';
import { probe, probeEnabled } from '../utils/probe';

// Landmarks the eval harness needs for jitter, blink and registration metrics.
const PROBE_LANDMARKS = [1, 10, 33, 133, 145, 159, 168, 234, 263, 362, 374, 386, 454];

interface ARTryOnProps {
  modelPath: string;
  anchors: ProductAnchors;
  ref?: Ref<ARTryOnHandle>;
  /** Called when WebGL cannot start, for example with hardware acceleration off. */
  onError?: (error: unknown) => void;
}

/** What one scene effect run owns; replaced when the model changes. */
interface Stage {
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  container: HTMLElement;
  glasses: THREE.Group | null;
  intrinsics: CameraIntrinsics | null;
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
const resizeRenderer = (stage: Stage) => {
  if (!stage.intrinsics) return;
  const display = { width: stage.container.clientWidth, height: stage.container.clientHeight };
  stage.renderer.setPixelRatio(
    renderPixelRatio(stage.intrinsics, display, window.devicePixelRatio),
  );
  stage.renderer.setSize(stage.intrinsics.width, stage.intrinsics.height, false);
};

/** Gives the camera the video's projection and sizes the canvas to the video. */
const fitToVideo = (stage: Stage, intrinsics: CameraIntrinsics) => {
  if (sameIntrinsics(stage.intrinsics, intrinsics)) return;
  if (!applyIntrinsics(stage.camera, intrinsics)) return;
  stage.intrinsics = intrinsics;
  resizeRenderer(stage);
};

// Screen geometry for eval/harness: page NDC of the unmirrored page, as the
// metrics read it, through the same cover fit the CSS applies.
const probeGlassesPose = (
  stage: Stage,
  frame: LandmarkFrame,
  estimate: HeadPoseEstimate,
  placement: { transform: RigidTransform; glasses: THREE.Group } | null,
  anchors: ProductAnchors,
) => {
  const poseStats = {
    focalPx: estimate.intrinsics?.fx ?? null,
    frameSize: estimate.intrinsics ? [estimate.intrinsics.width, estimate.intrinsics.height] : null,
    gateMaxRmsMm: MAX_RMS_REPROJECTION_MM,
    gated: !estimate.trusted,
    gateReason: estimate.trusted ? null : estimate.reason,
    rmsReprojectionPx: estimate.fit?.rmsReprojectionPx ?? null,
    rmsReprojectionMm: estimate.fit?.rmsReprojectionMm ?? null,
    inliers: estimate.fit?.inlierCount ?? null,
    landmarks: hasFace(frame)
      ? PROBE_LANDMARKS.map((i) => {
          const point = landmarkPoint(frame, i);
          return [point.x, point.y, point.z];
        })
      : null,
  };
  const page = { width: stage.container.clientWidth, height: stage.container.clientHeight };
  const fit = stage.intrinsics && coverFit(stage.intrinsics, page);
  if (!placement || !stage.intrinsics || !fit) {
    probe({ stage: 'glassesPose', t: performance.now(), ...poseStats });
    return;
  }
  const intrinsics = stage.intrinsics;
  const pageNdc = (modelPoint: Vec3): Vec2 => {
    const eye = transformPoint(placement.transform, modelPoint);
    const [x, y] = sourceToBox(fit, eyeToVideoPixel(stage.camera, intrinsics, eye));
    return [(2 * x) / page.width - 1, 1 - (2 * y) / page.height];
  };
  const center = pageNdc(anchors.bridgeCenter);
  const quaternion = placement.glasses.quaternion.toArray();
  const euler = new THREE.Euler().setFromQuaternion(placement.glasses.quaternion, 'XYZ');
  probe({
    stage: 'glassesPose',
    t: performance.now(),
    ...poseStats,
    // Decomposed for reporting only; the pose itself stays a rotation matrix.
    euler: [euler.x, euler.y, euler.z],
    // Without a temporal filter the target and the rendered pose are the same.
    targetNdc: center,
    smoothedNdc: center,
    // Image left first: the wearer's right hinge, as the metrics expect.
    smoothedEndsNdc: [pageNdc(anchors.hingeRight), pageNdc(anchors.hingeLeft)],
    targetQuat: quaternion,
    smoothedQuat: quaternion,
  });
};

function ARTryOn({ modelPath, anchors, ref, onError }: ARTryOnProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tracker] = useState(createHeadPoseTracker);
  // The pose is applied per camera frame, so the scene lives in a ref and the
  // component does not re-render on every landmark update.
  const stageRef = useRef<Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read inside the scene effect, so a new callback does not rebuild the scene.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useImperativeHandle(
    ref,
    (): ARTryOnHandle => ({
      updateModel: (frame: LandmarkFrame) => {
        const estimate = tracker.update(frame);
        const stage = stageRef.current;
        if (!stage) return;
        if (estimate.intrinsics) fitToVideo(stage, estimate.intrinsics);
        const glasses = stage.glasses;
        if (!glasses) return;

        let placement: { transform: RigidTransform; glasses: THREE.Group } | null = null;
        if (estimate.trusted && stage.intrinsics) {
          const transform = glassesTransform(estimate.fit.pose, anchors.bridgeCenter);
          applyTransform(glasses, transform);
          glasses.visible = true;
          placement = { transform, glasses };
        } else {
          glasses.visible = false;
        }
        if (probeEnabled()) probeGlassesPose(stage, frame, estimate, placement, anchors);
      },
    }),
    [tracker, anchors],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Three.js throws when no WebGL context can be created.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (error) {
      onErrorRef.current?.(error);
      return;
    }

    // The scene belongs to this effect run. A scene shared across runs kept the
    // lights of every earlier run, which StrictMode doubles in development.
    const scene = new THREE.Scene();
    // Millimetres, at the origin looking down -z; the projection comes from
    // the video's intrinsics once the first frame arrives.
    const camera = new THREE.Camera();
    const stage: Stage = { renderer, camera, container, glasses: null, intrinsics: null };
    stageRef.current = stage;
    let disposed = false;
    let animationFrameId = 0;

    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'overlay-canvas';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

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
        setIsLoading(false);
      },
      undefined,
      (error) => {
        if (disposed) return;
        console.error('Error loading model:', error);
        setIsLoading(false);
      },
    );

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const renderStart = performance.now();
      renderer.render(scene, camera);
      probe({ stage: 'render', start: renderStart, end: performance.now() });
    };
    animate();

    // The page size changes the pixel ratio the buffer needs.
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resizeRenderer(stage);
          });
    resizeObserver?.observe(container);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      cancelAnimationFrame(animationFrameId);
      disposeObject(scene);
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      if (stageRef.current === stage) stageRef.current = null;
      setIsLoading(true);
    };
  }, [modelPath]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            background: 'rgba(0,0,0,0.7)',
            padding: '20px',
            borderRadius: '10px',
            zIndex: 10,
          }}
        >
          Loading 3D Model...
        </div>
      )}
    </div>
  );
}

export default ARTryOn;
