import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import {
  quaternionFromMatrix,
  type CameraIntrinsics,
  type HeadPose,
  type Mat3,
  type Vec2,
  type Vec3,
} from '@facefit/cv';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createOverlayPose, type OverlayPose } from '../filtering/overlayPose';
import { coverFit, sourceToBox } from '../geometry/coverFit';
import {
  glassesPointInFaceModel,
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
const pageProjector = (stage: Stage) => {
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

/** Three.js order, x y z w. */
const quaternionArray = (rotation: Mat3) => {
  const q = quaternionFromMatrix(rotation);
  return [q.x, q.y, q.z, q.w];
};

const probeGlassesPose = (
  stage: Stage,
  frame: LandmarkFrame,
  estimate: HeadPoseEstimate,
  filtered: HeadPose | null,
  anchors: ProductAnchors,
  filterSetting: string,
) => {
  const intrinsics = estimate.intrinsics;
  const rawPose = estimate.fit?.pose ?? null;
  const poseStats = {
    frameTimestampMs: frame.timestampMs,
    faceCount: frame.faceCount,
    poseFilter: filterSetting,
    focalPx: intrinsics?.fx ?? null,
    principalPx: intrinsics ? [intrinsics.cx, intrinsics.cy] : null,
    frameSize: intrinsics ? [intrinsics.width, intrinsics.height] : null,
    gateMaxRmsMm: MAX_RMS_REPROJECTION_MM,
    gated: !estimate.trusted,
    gateReason: estimate.trusted ? null : estimate.reason,
    rmsReprojectionPx: estimate.fit?.rmsReprojectionPx ?? null,
    rmsReprojectionMm: estimate.fit?.rmsReprojectionMm ?? null,
    inliers: estimate.fit?.inlierCount ?? null,
    // The solved pose before filtering, so the harness can replay any filter offline.
    headPose: rawPose
      ? {
          quaternion: quaternionArray(rawPose.rotation),
          translationMm: rawPose.translationMm,
        }
      : null,
    // Bridge and hinge anchors (wearer's right first) in the face model frame.
    anchorsFaceMm: [anchors.bridgeCenter, anchors.hingeRight, anchors.hingeLeft].map((anchor) =>
      glassesPointInFaceModel(anchor, anchors.bridgeCenter),
    ),
    landmarks: hasFace(frame)
      ? PROBE_LANDMARKS.map((i) => {
          const point = landmarkPoint(frame, i);
          return [point.x, point.y, point.z];
        })
      : null,
  };
  const pageNdc = pageProjector(stage);
  if (!estimate.trusted || !filtered || !rawPose || !pageNdc) {
    probe({ stage: 'glassesPose', t: performance.now(), ...poseStats });
    return;
  }
  const target = glassesTransform(rawPose, anchors.bridgeCenter);
  const smoothed = glassesTransform(filtered, anchors.bridgeCenter);
  const smoothedQuat = quaternionArray(smoothed.rotation);
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...smoothedQuat), 'XYZ');
  probe({
    stage: 'glassesPose',
    t: performance.now(),
    ...poseStats,
    // Decomposed for reporting only; the pose itself stays a rotation matrix.
    euler: [euler.x, euler.y, euler.z],
    // Target is the solved pose; smoothed is the filtered pose at the frame's
    // capture time, which renders see before prediction.
    targetNdc: pageNdc(target, anchors.bridgeCenter),
    smoothedNdc: pageNdc(smoothed, anchors.bridgeCenter),
    // Image left first: the wearer's right hinge, as the metrics expect.
    smoothedEndsNdc: [pageNdc(smoothed, anchors.hingeRight), pageNdc(smoothed, anchors.hingeLeft)],
    targetQuat: quaternionArray(target.rotation),
    smoothedQuat,
  });
};

/** The pose each render drew, at the render's start, and the capture time it was predicted to. */
const probeRenderedPose = (
  stage: Stage,
  placed: PlacedGlasses,
  renderStart: number,
  anchors: ProductAnchors,
) => {
  const pageNdc = pageProjector(stage);
  if (!pageNdc) return;
  const { transform } = placed;
  probe({
    stage: 'renderedPose',
    t: renderStart,
    targetTimestampMs: placed.timestampMs,
    quat: quaternionArray(transform.rotation),
    centerNdc: pageNdc(transform, anchors.bridgeCenter),
    endsNdc: [pageNdc(transform, anchors.hingeRight), pageNdc(transform, anchors.hingeLeft)],
  });
};

interface PlacedGlasses {
  transform: RigidTransform;
  timestampMs: number;
}

/**
 * Places the glasses at the pose this render should draw. Returns null when
 * the glasses are hidden or there is no pose, which hides them until the next
 * trusted pose.
 */
const placeGlasses = (
  stage: Stage,
  overlayPose: OverlayPose,
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

function ARTryOn({ modelPath, anchors, ref, onError }: ARTryOnProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tracker] = useState(createHeadPoseTracker);
  const [overlayPose] = useState(() => createOverlayPose());
  const trackIdRef = useRef<number | null>(null);
  // The pose is applied on every render, so the scene lives in a ref and the
  // component does not re-render on every landmark update.
  const stageRef = useRef<Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read inside the scene effect, so a new callback does not rebuild the scene.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  // Read by the render loop, so a new product's anchors do not rebuild the scene.
  const anchorsRef = useRef(anchors);
  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  useImperativeHandle(
    ref,
    (): ARTryOnHandle => ({
      updateModel: (frame: LandmarkFrame) => {
        // Filter state carried to another face would swing the overlay across
        // from the last one.
        if (frame.trackId !== trackIdRef.current) {
          trackIdRef.current = frame.trackId;
          overlayPose.lose();
        }
        const estimate = tracker.update(frame);
        // A gated frame keeps the filter: a short gap continues the track and
        // a long one restarts it on the next pose. A lost face ends it.
        let filtered: HeadPose | null = null;
        if (estimate.trusted) filtered = overlayPose.update(estimate.fit.pose, frame.timestampMs);
        else if (estimate.reason === 'no-face') overlayPose.lose();
        const stage = stageRef.current;
        if (!stage) return;
        if (estimate.intrinsics) fitToVideo(stage, estimate.intrinsics);
        const glasses = stage.glasses;
        if (!glasses) return;
        glasses.visible = estimate.trusted && stage.intrinsics !== null;
        if (probeEnabled()) {
          probeGlassesPose(stage, frame, estimate, filtered, anchors, overlayPose.setting);
        }
      },
      presentFrame: (timestampMs: number) => {
        overlayPose.present(timestampMs);
      },
    }),
    [tracker, overlayPose, anchors],
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
      const placed = placeGlasses(stage, overlayPose, anchorsRef.current);
      renderer.render(scene, camera);
      probe({ stage: 'render', start: renderStart, end: performance.now() });
      if (placed && probeEnabled()) {
        probeRenderedPose(stage, placed, renderStart, anchorsRef.current);
      }
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
  }, [modelPath, overlayPose]);

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
