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
    const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
    const rendererRef = useRef(new THREE.WebGLRenderer({ alpha: true }));
    const containerRef = useRef(null);
    const animationFrameId = useRef(null);
  
    useImperativeHandle(ref, () => {
      return {
        updateModel: (landmarks) => {
          if (!model || !landmarks) return;
          
          if (type === 'glasses') {
            updateGlasses(landmarks);
          } else if (type === 'hat') {
            updateHat(landmarks);
          }
        }
      };
    }, [model, type]);
  
    const updateGlasses = (landmarks) => {
      if (!model) return;
  
      const leftTemple = landmarks[234];
      const rightTemple = landmarks[454];
      const nose = landmarks[168];
  
      // Calculate face width
      const faceWidth = Math.sqrt(
        Math.pow(rightTemple.x - leftTemple.x, 2) +
        Math.pow(rightTemple.y - leftTemple.y, 2) +
        Math.pow(rightTemple.z - leftTemple.z, 2)
      );
  
      // Calculate scaling
      const desiredWidth = faceWidth * 10;
      const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
      // Update model
      model.visible = true;
      model.scale.set(widthScaleFactor, widthScaleFactor * 0.8, widthScaleFactor * 1.35);
      model.position.set(
        (nose.x - 0.5) * 3,
        -(landmarks[1].y - 0.5) * 3,
        -nose.z * 3 - 1.6
      );
  
      // Calculate rotation
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const eyeVector = {
        x: rightEye.x - leftEye.x,
        y: rightEye.y - leftEye.y,
        z: rightEye.z - leftEye.z
      };
  
      model.rotation.y = Math.atan2(eyeVector.z, eyeVector.x) * 0.75;
      model.rotation.x = (Math.atan2(-eyeVector.y, Math.sqrt(eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z)) * 0.75) + 0.1;
      model.rotation.z = Math.atan2(eyeVector.y, eyeVector.x) * 0.5;
  
      model.updateWorldMatrix();
    };
  
    useEffect(() => {
      if (!containerRef.current) return;
  
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      
      // Set up renderer
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.top = '0';
      renderer.domElement.style.left = '0';
      renderer.domElement.style.zIndex = '2';
      containerRef.current.appendChild(renderer.domElement);
  
      // Load 3D model
      const loader = new GLTFLoader();
      loader.load(
        modelPath,
        (gltf) => {
          const loadedModel = gltf.scene;
          const boundingBox = new THREE.Box3().setFromObject(loadedModel);
          loadedModel.userData.originalWidth = boundingBox.max.x - boundingBox.min.x;
          loadedModel.visible = false;
          scene.add(loadedModel);
          setModel(loadedModel);
        },
        (progress) => {
          if (progress.total > 0) {
            const percentage = (progress.loaded / progress.total) * 100;
            console.log(`Loading model... ${percentage.toFixed(2)}%`);
          }
        },
        (error) => console.error('Error loading model:', error)
      );
  
      // Add lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 1);
      scene.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(0, 1, 1);
      scene.add(directionalLight);
  
      camera.position.z = 2;
  
      // Animation loop
      const animate = () => {
        animationFrameId.current = requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();
  
      // Handle window resize
      const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener('resize', handleResize);
  
      // Cleanup
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
  
    const updateHat = (landmarks) => {
        if (!model) return;

  // Key landmarks for hat positioning
  const foreheadCenter = landmarks[10];    // Top of forehead
  const leftTemple = landmarks[234];       // Left side of head
  const rightTemple = landmarks[454];      // Right side of head
  const topHead = landmarks[10];           // Top of head

  // Calculate head width for scaling
  const headWidth = Math.sqrt(
    Math.pow(rightTemple.x - leftTemple.x, 2) +
    Math.pow(rightTemple.y - leftTemple.y, 2) +
    Math.pow(rightTemple.z - leftTemple.z, 2)
  );

  // Calculate scaling
  const desiredWidth = headWidth * 12; // Slightly wider than the head
  const widthScaleFactor = desiredWidth / model.userData.originalWidth;

  // Update model visibility and scale
  model.visible = true;
  model.scale.set(widthScaleFactor, widthScaleFactor, widthScaleFactor);

  // Position the hat slightly above the head
  model.position.set(
    (foreheadCenter.x - 0.5) * 3,
    -(topHead.y - 0.65) * 3, // Moved up slightly
    -foreheadCenter.z * 3 - 1
  );

  // Calculate rotation based on head orientation
  const leftEar = landmarks[234];
  const rightEar = landmarks[454];
  const headVector = {
    x: rightEar.x - leftEar.x,
    y: rightEar.y - leftEar.y,
    z: rightEar.z - leftEar.z
  };

  // Apply rotation
  model.rotation.y = Math.atan2(headVector.z, headVector.x);
  model.rotation.x = Math.atan2(-headVector.y, Math.sqrt(headVector.x * headVector.x + headVector.z * headVector.z)) + 0.2;
  model.rotation.z = Math.atan2(headVector.y, headVector.x) * 0.5;

  model.updateWorldMatrix();
    };
  
    return (
        <div 
          ref={containerRef} 
          style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none' // Allow interaction with elements behind
          }} 
        />
      );
  });
  
  export default ARTryOn;