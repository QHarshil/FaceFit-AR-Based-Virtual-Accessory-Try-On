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
  // Adjust camera FOV and clipping planes for better depth perception
  const cameraRef = useRef(new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10));
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameId = useRef(null);

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
  
    const leftTemple = landmarks[234];
    const rightTemple = landmarks[454];
    const nose = landmarks[168];
  
    // Increase face width calculation
    const faceWidth = Math.sqrt(
      Math.pow(rightTemple.x - leftTemple.x, 2) +
      Math.pow(rightTemple.y - leftTemple.y, 2)
    );
  
    // Significantly increase the scaling factor
    const desiredWidth = faceWidth * 8;  // Increased from 0.95 to 8
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    model.visible = true;
    model.scale.set(
      widthScaleFactor,
      widthScaleFactor * 0.85,  // Maintain aspect ratio
      widthScaleFactor
    );
  
    // Adjust position for the larger scale
    const centerX = (rightTemple.x + leftTemple.x) / 2;
    model.position.set(
      (centerX - 0.5) * 3,    // Increased multiplier
      -(nose.y - 0.48) * 3,   // Increased Y position multiplier
      -nose.z * 3 - 0.8       // Adjusted depth for larger model
    );
  
    // Keep rotation calculations
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const eyeVector = {
      x: rightEye.x - leftEye.x,
      y: rightEye.y - leftEye.y,
      z: rightEye.z - leftEye.z
    };
  
    model.rotation.y = Math.atan2(eyeVector.z, eyeVector.x) * 0.6;
    model.rotation.x = (Math.atan2(-eyeVector.y, 
      Math.sqrt(eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z)) * 0.6);
    model.rotation.z = Math.atan2(eyeVector.y, eyeVector.x) * 0.4;
  
    model.updateWorldMatrix();
  };
  
  const updateHat = (landmarks) => {
    if (!model) return;
  
    const foreheadCenter = landmarks[10];
    const leftTemple = landmarks[234];
    const rightTemple = landmarks[454];
  
    const headWidth = Math.sqrt(
      Math.pow(rightTemple.x - leftTemple.x, 2) +
      Math.pow(rightTemple.y - leftTemple.y, 2)
    );
  
    // Increase hat scaling significantly
    const desiredWidth = headWidth * 10;  // Increased from 1.0 to 10
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    model.visible = true;
    model.scale.set(widthScaleFactor, widthScaleFactor, widthScaleFactor);
  
    // Adjust position for larger hat
    model.position.set(
      (foreheadCenter.x - 0.5) * 3,    // Increased X multiplier
      -(foreheadCenter.y - 0.62) * 3,  // Adjusted Y position for larger hat
      -foreheadCenter.z * 3 - 0.6      // Adjusted depth
    );
  
    // Keep rotation calculations with slight adjustments
    const leftEar = landmarks[234];
    const rightEar = landmarks[454];
    const headVector = {
      x: rightEar.x - leftEar.x,
      y: rightEar.y - leftEar.y,
      z: rightEar.z - leftEar.z
    };
  
    model.rotation.y = Math.atan2(headVector.z, headVector.x) * 0.7;
    model.rotation.x = (Math.atan2(-headVector.y, 
      Math.sqrt(headVector.x * headVector.x + headVector.z * headVector.z)) * 0.7) + 0.1;
    model.rotation.z = Math.atan2(headVector.y, headVector.x) * 0.4;
  
    model.updateWorldMatrix();
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new THREE.WebGLRenderer({ 
      alpha: true,
      antialias: true  // Enable antialiasing for smoother edges
    });
    rendererRef.current = renderer;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    
    // Enhanced renderer setup
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio); // Improve rendering quality
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '2';
    containerRef.current.appendChild(renderer.domElement);

    // Load 3D model with improved error handling
    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const loadedModel = gltf.scene;
        // Calculate original model dimensions
        const boundingBox = new THREE.Box3().setFromObject(loadedModel);
        loadedModel.userData.originalWidth = boundingBox.max.x - boundingBox.min.x;
        loadedModel.visible = false;
        
        // Center model pivot point
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

    // Enhanced lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    // Position camera
    camera.position.z = 2;

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Improved resize handler with debouncing
    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }, 100);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      // Cleanup resources
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