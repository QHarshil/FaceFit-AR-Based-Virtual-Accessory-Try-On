import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

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

const toVector3 = (landmark) => new THREE.Vector3(landmark.x, landmark.y, landmark.z);

const averageLandmarks = (landmarks, indices) => {
  const sum = indices.reduce((acc, index) => {
    const point = landmarks[index];
    return acc.add(new THREE.Vector3(point.x, point.y, point.z));
  }, new THREE.Vector3());

  return sum.divideScalar(indices.length);
};

const ARTryOn = forwardRef((props, ref) => {
  const { modelPath, type = 'glasses' } = props;
  const [model, setModel] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameId = useRef(null);
  const prevPoseRef = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    initialized: false
  });

  const applySmoothedPose = useCallback((targetPosition, targetQuaternion) => {
    if (!model) return;

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
  }, [model]);

  const updateGlasses = useCallback((landmarks) => {
    if (!model) return;

    const leftEye = averageLandmarks(landmarks, LEFT_EYE_INDICES);
    const rightEye = averageLandmarks(landmarks, RIGHT_EYE_INDICES);
    const eyeMidpoint = leftEye.clone().add(rightEye).multiplyScalar(0.5);
    const leftTemple = toVector3(landmarks[LEFT_TEMPLE_INDEX]);
    const rightTemple = toVector3(landmarks[RIGHT_TEMPLE_INDEX]);
    const noseBridge = toVector3(landmarks[NOSE_BRIDGE_INDEX]);
    const browPoint = toVector3(landmarks[FOREHEAD_INDEX]);
    const faceAnchorTop = landmarks[1]?.y ?? browPoint.y;
    const anchor = eyeMidpoint.clone().lerp(noseBridge, 0.18);

    const faceWidth = leftTemple.distanceTo(rightTemple);
    if (!Number.isFinite(faceWidth) || faceWidth < EPSILON) {
      model.visible = false;
      prevPoseRef.current.initialized = false;
      return;
    }

    const desiredWidth = faceWidth * 10;
    const originalWidth = model.userData.originalWidth || 1;
    const widthScaleFactor = desiredWidth / Math.max(originalWidth, EPSILON);
    const clampedScale = Math.min(Math.max(widthScaleFactor, 0.75), 2.8);

    model.scale.set(
      clampedScale,
      clampedScale * 0.82,
      clampedScale * 1.3
    );

    const depthCompensation = Math.max(0, (clampedScale - 1) * 0.18);
    const verticalCompensation = (clampedScale - 1) * 0.06;
    const anchorY = anchor.y * 0.7 + faceAnchorTop * 0.3;

    const targetPosition = new THREE.Vector3(
      (anchor.x - 0.5) * VIEW_SCALE,
      -(anchorY - 0.5) * VIEW_SCALE - 0.04 - verticalCompensation,
      (-noseBridge.z * DEPTH_MULTIPLIER) + DEPTH_BASE - depthCompensation
    );

    const eyeVector = rightEye.clone().sub(leftEye);
    const horizontalMagnitude = Math.sqrt(
      eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z
    ) || EPSILON;

    const yaw = Math.atan2(eyeVector.z, eyeVector.x) * 0.8;
    const pitch =
      Math.atan2(-eyeVector.y, horizontalMagnitude) * 0.75 + 0.08;
    const verticalReference = browPoint.clone().sub(eyeMidpoint);
    const roll =
      Math.atan2(eyeVector.y, eyeVector.x) * 0.55 +
      verticalReference.y * 0.3;

    const targetQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitch, yaw, roll, 'XYZ')
    );

    applySmoothedPose(targetPosition, targetQuaternion);
  }, [model, applySmoothedPose]);

  const updateHat = useCallback((landmarks) => {
    if (!model) return;

    const forehead = toVector3(landmarks[FOREHEAD_INDEX]);
    const leftTemple = toVector3(landmarks[LEFT_TEMPLE_INDEX]);
    const rightTemple = toVector3(landmarks[RIGHT_TEMPLE_INDEX]);
    const noseBridge = toVector3(landmarks[NOSE_BRIDGE_INDEX]);

    const headWidth = leftTemple.distanceTo(rightTemple);
    if (!Number.isFinite(headWidth) || headWidth < EPSILON) {
      model.visible = false;
      prevPoseRef.current.initialized = false;
      return;
    }

    const desiredWidth = headWidth * 12;
    const originalWidth = model.userData.originalWidth || 1;
    const widthScaleFactor = desiredWidth / Math.max(originalWidth, EPSILON);
    const clampedScale = Math.min(Math.max(widthScaleFactor, 0.9), 3.5);

    model.scale.setScalar(clampedScale);

    const targetPosition = new THREE.Vector3(
      (forehead.x - 0.5) * VIEW_SCALE,
      -(forehead.y - 0.5) * VIEW_SCALE + 0.5,
      DEPTH_BASE - forehead.z * DEPTH_MULTIPLIER
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

    applySmoothedPose(targetPosition, targetQuaternion);
  }, [model, applySmoothedPose]);

  useImperativeHandle(ref, () => ({
    updateModel: (landmarks) => {
      if (!landmarks) {
        if (model) {
          model.visible = false;
        }
        prevPoseRef.current.initialized = false;
        return;
      }

      if (type === 'glasses') {
        updateGlasses(landmarks);
      } else if (type === 'hat') {
        updateHat(landmarks);
      }
    }
  }), [type, updateGlasses, updateHat]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rendererRef.current = renderer;

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

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    camera.position.z = 2;

    let currentModel = null;

    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
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
          if (child.isMesh) {
            child.material.transparent = true;
            child.material.side = THREE.DoubleSide;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        pivot.add(loadedModel);
        scene.add(pivot);
        currentModel = pivot;

        setModel(pivot);
        prevPoseRef.current.initialized = false;
        setIsLoading(false);
        console.log('3D model loaded successfully');
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`Loading: ${percent}%`);
        }
      },
      (error) => {
        console.error('Error loading model:', error);
        setIsLoading(false);
      }
    );

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      if (renderer) {
        renderer.dispose();
      }
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (currentModel) {
        scene.remove(currentModel);
      }
      setModel(null);
      setIsLoading(true);
      prevPoseRef.current.initialized = false;
    };
  }, [modelPath]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          background: 'rgba(0,0,0,0.7)',
          padding: '20px',
          borderRadius: '10px',
          zIndex: 10
        }}>
          Loading 3D Model...
        </div>
      )}
    </div>
  );
});

export default ARTryOn;
