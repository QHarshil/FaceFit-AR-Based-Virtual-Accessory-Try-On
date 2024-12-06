import React, { 
  useRef, 
  useEffect, 
  useState, 
  forwardRef, 
  useImperativeHandle 
} from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const ARTryOn = forwardRef((props, ref) => {
  const { modelPath, type } = props;
  const [model, setModel] = useState(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10));
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameId = useRef(null);

  const calculateDistance = (point1, point2) => {
    return Math.sqrt(
      Math.pow(point2.x - point1.x, 2) +
      Math.pow(point2.y - point1.y, 2) +
      Math.pow(point2.z - point1.z, 2)
    );
  };

  useImperativeHandle(ref, () => ({
    updateModel: (landmarks) => {
      if (!model || !landmarks) return;
      if (type === 'glasses') {
        updateGlasses(landmarks);
      } else if (type === 'hat') {
        updateHat(landmarks);
      }
    }
  }), [model, type]);

  const updateGlasses = (landmarks) => {
    if (!model) return;
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const noseTip = landmarks[168];

    const eyeDistance = calculateDistance(leftEyeOuter, rightEyeOuter);
    const desiredWidth = eyeDistance * 3.5; 
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;

    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.9,
      widthScaleFactor * 1.9,
      widthScaleFactor * 1.5
    );

    model.position.set(
      (noseTip.x - 0.55) * 3,
      -(noseTip.y - 0.45) * 3,
      -noseTip.z * 3 - eyeDistance
    );

    const eyeAxis = {
      x: rightEyeOuter.x - leftEyeOuter.x,
      y: rightEyeOuter.y - leftEyeOuter.y,
      z: rightEyeOuter.z - leftEyeOuter.z
    };

    model.rotation.y = Math.atan2(eyeAxis.z, eyeAxis.x) * 0.7;
    model.rotation.x = Math.atan2(
      -eyeAxis.y,
      Math.sqrt(eyeAxis.x * eyeAxis.x + eyeAxis.z * eyeAxis.z)
    ) * 0.5;
    model.rotation.z = Math.atan2(eyeAxis.y, eyeAxis.x) * 0.3;

    model.updateWorldMatrix();
  };

  const updateHat = (landmarks) => {
    if (!model) return;
    const foreheadCenter = landmarks[10];
    const leftTemple = landmarks[227];
    const rightTemple = landmarks[447];

    const headWidth = calculateDistance(leftTemple, rightTemple);
    const desiredWidth = headWidth * 4;
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;

    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.3,
      widthScaleFactor * 1,
      widthScaleFactor
    );

    model.position.set(
      (foreheadCenter.x - 0.55) * 3,
      -(foreheadCenter.y - 0.58) * 3,
      -foreheadCenter.z * 3 - headWidth
    );

    const headAxis = {
      x: rightTemple.x - leftTemple.x,
      y: rightTemple.y - leftTemple.y,
      z: rightTemple.z - leftTemple.z
    };

    model.rotation.y = Math.atan2(headAxis.z, headAxis.x) * 0.8;
    model.rotation.x = Math.atan2(
      -headAxis.y,
      Math.sqrt(headAxis.x * headAxis.x + headAxis.z * headAxis.z)
    ) * 0.6 + 0.1;
    model.rotation.z = Math.atan2(headAxis.y, headAxis.x) * 0.5;

    model.updateWorldMatrix();
  };

  useEffect(() => {
    // Initialization logic
  }, [modelPath]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />;
});

export default ARTryOn;
