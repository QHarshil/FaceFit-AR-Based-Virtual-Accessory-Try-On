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
  const { modelPath, type = 'glasses' } = props;
  const [model, setModel] = useState(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10));
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameId = useRef(null);

  // Precise positioning utility functions
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
  
    // More precise landmarks for glasses positioning
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const noseTip = landmarks[168];
    const nose = {
      x: (leftEyeInner.x + rightEyeInner.x) / 2,
      y: (leftEyeInner.y + rightEyeInner.y) / 2,
      z: (leftEyeInner.z + rightEyeInner.z) / 2
    };
  
    // Calculate precise face width and proportions
    const eyeDistance = calculateDistance(leftEyeOuter, rightEyeOuter);
    const desiredWidth = eyeDistance * 3.5; // Adjusted multiplier for better proportions
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    // More nuanced scaling
    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.9,
      widthScaleFactor * 1.9,  // Slight vertical compression
      widthScaleFactor * 1.5
    );
  
    // Advanced positioning calculation
    model.position.set(
      (nose.x - 0.55) * 3,           // Horizontal centering
      -(noseTip.y - 0.45) * 3,        // Vertical positioning
      -noseTip.z * 3 - eyeDistance   // Depth positioning
    );
  
    // Sophisticated rotation calculation
    const eyeAxis = {
      x: rightEyeOuter.x - leftEyeOuter.x,
      y: rightEyeOuter.y - leftEyeOuter.y,
      z: rightEyeOuter.z - leftEyeOuter.z
    };
  
    // Fine-tuned rotation for natural placement
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
  
    // More precise landmarks for hat positioning
    const foreheadCenter = landmarks[10];
    const leftCheek = landmarks[93];
    const rightCheek = landmarks[323];
    const noseTip = landmarks[168];
    const leftTemple = landmarks[227];
    const rightTemple = landmarks[447];
  
    // Calculate head width with more precision
    const headWidth = calculateDistance(leftTemple, rightTemple);
    const desiredWidth = headWidth * 4; // Adjusted multiplier
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.3, 
      widthScaleFactor * 1, // Slight vertical compression
      widthScaleFactor
    );
  
    // More precise positioning
    model.position.set(
      (foreheadCenter.x - 0.55) * 3,     // Horizontal centering
      -(foreheadCenter.y - 0.58) * 3,   // Vertical positioning
      -(foreheadCenter.z)* 3 - headWidth // Depth positioning
    );
  
    // Advanced head orientation calculation
    const headAxis = {
      x: rightTemple.x - leftTemple.x,
      y: rightTemple.y - leftTemple.y,
      z: rightTemple.z - leftTemple.z
    };
  
    // Fine-tuned rotation for natural hat placement
    model.rotation.y = Math.atan2(headAxis.z, headAxis.x) * 0.8;
    model.rotation.x = (
      Math.atan2(
        -headAxis.y, 
        Math.sqrt(headAxis.x * headAxis.x + headAxis.z * headAxis.z)
      ) * 0.6
    ) + 0.1;  // Slight upward tilt
    model.rotation.z = Math.atan2(headAxis.y, headAxis.x) * 0.5;
  
    model.updateWorldMatrix();
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new THREE.WebGLRenderer({ 
      alpha: true,
      antialias: true
    });
    rendererRef.current = renderer;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    
    // Set fixed renderer size to match window
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Absolute positioning to prevent movement
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.zIndex = '2';
    renderer.domElement.style.pointerEvents = 'none';
    
    containerRef.current.appendChild(renderer.domElement);

    const handleResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera aspect ratio without changing its size
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    // Maintain renderer size
    renderer.setSize(width, height);
  };


    window.addEventListener('resize', handleResize);

    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const loadedModel = gltf.scene;
        const boundingBox = new THREE.Box3().setFromObject(loadedModel);
        loadedModel.userData.originalWidth = boundingBox.max.x - boundingBox.min.x;
        loadedModel.visible = false;
        
        boundingBox.getCenter(loadedModel.position);
        loadedModel.position.multiplyScalar(-1);
        
        scene.add(loadedModel);
        setModel(loadedModel);
      },
      (progress) => {
        if (progress.total > 0) {
          const percentage = (progress.loaded / progress.total) * 100;
          console.log(`Loading model: ${percentage.toFixed(2)}%`);
        }
      },
      (error) => console.error('Model loading error:', error)
    );

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    camera.position.z = 2;

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Initial resizing call
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, [modelPath]);


  useEffect(() => {
    if (model) {
      sceneRef.current.remove(model);
      model.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      setModel(null);
    }
  }, [modelPath]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }} 
    />
  );
});

export default ARTryOn;