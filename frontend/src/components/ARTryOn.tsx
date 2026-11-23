import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { landmarkPoint, type LandmarkFrame } from '../perception/types';
import type { ARTryOnHandle, ProductType } from '../types';
import { probe, probeEnabled } from '../utils/probe';

const LEFT_EYE_INDICES = [33, 133, 159, 145];
const RIGHT_EYE_INDICES = [362, 263, 386, 374];
const LEFT_TEMPLE_INDEX = 234;
const RIGHT_TEMPLE_INDEX = 454;
const FOREHEAD_INDEX = 10;
const NOSE_BRIDGE_INDEX = 168;
const EPSILON = 1e-6;
const VIEW_SCALE = 3.1;
const DEPTH_BASE = -2.1;
const DEPTH_MULTIPLIER = 2.6;
const SMOOTH_ALPHA = 0.3;
// Landmarks the eval harness needs for jitter, blink and registration metrics.
const PROBE_LANDMARKS = [1, 10, 33, 133, 145, 159, 168, 234, 263, 362, 374, 386, 454];

interface ARTryOnProps {
  modelPath: string;
  type?: ProductType;
  ref?: Ref<ARTryOnHandle>;
}

interface SmoothedPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  initialized: boolean;
}

const toVector3 = (landmarks: LandmarkFrame, index: number): THREE.Vector3 => {
  const landmark = landmarkPoint(landmarks, index);
  return new THREE.Vector3(landmark.x, landmark.y, landmark.z);
};

const averageLandmarks = (landmarks: LandmarkFrame, indices: readonly number[]): THREE.Vector3 => {
  const sum = indices.reduce(
    (acc, index) => acc.add(toVector3(landmarks, index)),
    new THREE.Vector3(),
  );

  return sum.divideScalar(indices.length);
};

// Written once when the model loads; the fallback of 1 matches a model with no width.
const originalWidthOf = (model: THREE.Object3D): number => {
  const width: unknown = model.userData.originalWidth;
  return typeof width === 'number' && width ? width : 1;
};

type TypedMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

// Mesh narrows to Mesh<any, any>; this gives its parts their real types.
const isMesh = (object: THREE.Object3D): object is TypedMesh => object instanceof THREE.Mesh;

const materialsOf = (mesh: TypedMesh): THREE.Material[] =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

const disposeObject = (root: THREE.Object3D) => {
  root.traverse((child) => {
    if (isMesh(child)) {
      child.geometry.dispose();
      materialsOf(child).forEach((material) => {
        material.dispose();
      });
    }
  });
};

function ARTryOn({ modelPath, type = 'glasses', ref }: ARTryOnProps) {
  // The pose is applied per camera frame, so the model lives in a ref and the
  // component does not re-render on every landmark update.
  const modelRef = useRef<THREE.Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevPoseRef = useRef<SmoothedPose>({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    initialized: false,
  });

  const applySmoothedPose = useCallback(
    (model: THREE.Group, targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion) => {
      const pose = prevPoseRef.current;
      if (!pose.initialized) {
        pose.position.copy(targetPosition);
        pose.quaternion.copy(targetQuaternion);
        pose.initialized = true;
      } else {
        pose.position.lerp(targetPosition, SMOOTH_ALPHA);
        pose.quaternion.slerp(targetQuaternion, SMOOTH_ALPHA);
      }

      model.visible = true;
      model.position.copy(pose.position);
      model.quaternion.copy(pose.quaternion);
      model.updateMatrixWorld(true);
    },
    [],
  );

  const updateGlasses = useCallback(
    (landmarks: LandmarkFrame) => {
      const model = modelRef.current;
      if (!model) return;

      const leftEye = averageLandmarks(landmarks, LEFT_EYE_INDICES);
      const rightEye = averageLandmarks(landmarks, RIGHT_EYE_INDICES);
      const eyeMidpoint = leftEye.clone().add(rightEye).multiplyScalar(0.5);
      const leftTemple = toVector3(landmarks, LEFT_TEMPLE_INDEX);
      const rightTemple = toVector3(landmarks, RIGHT_TEMPLE_INDEX);
      const noseBridge = toVector3(landmarks, NOSE_BRIDGE_INDEX);
      const browPoint = toVector3(landmarks, FOREHEAD_INDEX);
      const faceAnchorTop = landmarkPoint(landmarks, 1).y;
      const anchor = eyeMidpoint.clone().lerp(noseBridge, 0.18);

      const faceWidth = leftTemple.distanceTo(rightTemple);
      if (!Number.isFinite(faceWidth) || faceWidth < EPSILON) {
        model.visible = false;
        prevPoseRef.current.initialized = false;
        return;
      }

      const desiredWidth = faceWidth * 10;
      const originalWidth = originalWidthOf(model);
      const widthScaleFactor = desiredWidth / Math.max(originalWidth, EPSILON);
      const clampedScale = Math.min(Math.max(widthScaleFactor, 0.75), 2.8);

      model.scale.set(clampedScale, clampedScale * 0.82, clampedScale * 1.3);

      const depthCompensation = Math.max(0, (clampedScale - 1) * 0.18);
      const verticalCompensation = (clampedScale - 1) * 0.06;
      const anchorY = anchor.y * 0.7 + faceAnchorTop * 0.3;

      const targetPosition = new THREE.Vector3(
        (anchor.x - 0.5) * VIEW_SCALE,
        -(anchorY - 0.5) * VIEW_SCALE - 0.04 - verticalCompensation,
        -noseBridge.z * DEPTH_MULTIPLIER + DEPTH_BASE - depthCompensation,
      );

      const eyeVector = rightEye.clone().sub(leftEye);
      const horizontalMagnitude =
        Math.sqrt(eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z) || EPSILON;

      const yaw = Math.atan2(eyeVector.z, eyeVector.x) * 0.8;
      const pitch = Math.atan2(-eyeVector.y, horizontalMagnitude) * 0.75 + 0.08;
      const verticalReference = browPoint.clone().sub(eyeMidpoint);
      const roll = Math.atan2(eyeVector.y, eyeVector.x) * 0.55 + verticalReference.y * 0.3;

      const targetQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(pitch, yaw, roll, 'XYZ'),
      );

      applySmoothedPose(model, targetPosition, targetQuaternion);

      const camera = cameraRef.current;
      if (camera && probeEnabled()) {
        const pose = prevPoseRef.current;
        const halfWidth = (originalWidthOf(model) * model.scale.x) / 2;
        const templeEnd = (sign: number) =>
          new THREE.Vector3(sign * halfWidth, 0, 0)
            .applyQuaternion(pose.quaternion)
            .add(pose.position)
            .project(camera)
            .toArray();
        probe({
          stage: 'glassesPose',
          t: performance.now(),
          euler: [pitch, yaw, roll],
          targetNdc: targetPosition.clone().project(camera).toArray(),
          smoothedNdc: pose.position.clone().project(camera).toArray(),
          smoothedEndsNdc: [templeEnd(-1), templeEnd(1)],
          targetQuat: targetQuaternion.toArray(),
          smoothedQuat: pose.quaternion.toArray(),
          landmarks: PROBE_LANDMARKS.map((i) => {
            const point = landmarkPoint(landmarks, i);
            return [point.x, point.y, point.z];
          }),
        });
      }
    },
    [applySmoothedPose],
  );

  const updateHat = useCallback(
    (landmarks: LandmarkFrame) => {
      const model = modelRef.current;
      if (!model) return;

      const forehead = toVector3(landmarks, FOREHEAD_INDEX);
      const leftTemple = toVector3(landmarks, LEFT_TEMPLE_INDEX);
      const rightTemple = toVector3(landmarks, RIGHT_TEMPLE_INDEX);
      const noseBridge = toVector3(landmarks, NOSE_BRIDGE_INDEX);

      const headWidth = leftTemple.distanceTo(rightTemple);
      if (!Number.isFinite(headWidth) || headWidth < EPSILON) {
        model.visible = false;
        prevPoseRef.current.initialized = false;
        return;
      }

      const desiredWidth = headWidth * 12;
      const originalWidth = originalWidthOf(model);
      const widthScaleFactor = desiredWidth / Math.max(originalWidth, EPSILON);
      const clampedScale = Math.min(Math.max(widthScaleFactor, 0.9), 3.5);

      model.scale.setScalar(clampedScale);

      const targetPosition = new THREE.Vector3(
        (forehead.x - 0.5) * VIEW_SCALE,
        -(forehead.y - 0.5) * VIEW_SCALE + 0.5,
        DEPTH_BASE - forehead.z * DEPTH_MULTIPLIER,
      );

      const xAxis = rightTemple.clone().sub(leftTemple).normalize();
      const upReference = forehead.clone().sub(noseBridge).normalize();

      if (xAxis.lengthSq() < EPSILON || upReference.lengthSq() < EPSILON) {
        model.visible = false;
        prevPoseRef.current.initialized = false;
        return;
      }

      const zAxis = new THREE.Vector3().crossVectors(xAxis, upReference).normalize();
      if (zAxis.lengthSq() < EPSILON) {
        model.visible = false;
        prevPoseRef.current.initialized = false;
        return;
      }

      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const rotationMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);

      applySmoothedPose(model, targetPosition, targetQuaternion);
    },
    [applySmoothedPose],
  );

  useImperativeHandle(
    ref,
    (): ARTryOnHandle => ({
      updateModel: (landmarks: LandmarkFrame | null) => {
        if (!landmarks) {
          if (modelRef.current) {
            modelRef.current.visible = false;
          }
          prevPoseRef.current.initialized = false;
          return;
        }

        if (type === 'glasses') {
          updateGlasses(landmarks);
        } else if (type === 'hat') {
          updateHat(landmarks);
        }
      },
    }),
    [type, updateGlasses, updateHat],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const smoothedPose = prevPoseRef.current;
    // The scene belongs to this effect run. A scene shared across runs kept the
    // lights of every earlier run, which StrictMode doubles in development.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    cameraRef.current = camera;
    let disposed = false;
    let animationFrameId = 0;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '2';
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.transform = 'scaleX(-1)';
    renderer.domElement.style.transformOrigin = 'center';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    camera.position.z = 2;

    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const loadedModel = gltf.scene;
        const boundingBox = new THREE.Box3().setFromObject(loadedModel);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);

        const pivot = new THREE.Group();
        pivot.visible = false;
        pivot.userData.originalWidth = size.x || 1;

        loadedModel.position.sub(center);
        loadedModel.traverse((child) => {
          if (isMesh(child)) {
            materialsOf(child).forEach((material) => {
              material.transparent = true;
              material.side = THREE.DoubleSide;
            });
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        pivot.add(loadedModel);
        scene.add(pivot);

        modelRef.current = pivot;
        smoothedPose.initialized = false;
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

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      disposeObject(scene);
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      cameraRef.current = null;
      modelRef.current = null;
      setIsLoading(true);
      smoothedPose.initialized = false;
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
