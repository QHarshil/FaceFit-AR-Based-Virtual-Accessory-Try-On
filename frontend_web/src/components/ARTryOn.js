import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

const ARTryOn = forwardRef((props, ref) => {
  const { modelPath, textureUrls = [], type } = props; // Added textureUrls
  const [model, setModel] = useState(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(
    new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10)
  );
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameId = useRef(null);

  // Expose `updateModel` to parent component
  useImperativeHandle(ref, () => ({
    updateModel: (landmarks) => {
      if (!model || !landmarks) return;
      if (type === "glasses") {
        updateGlasses(landmarks);
      } else if (type === "hat") {
        updateHat(landmarks);
      }
    },
  }));

  // Calculate distance between two 3D points
  const calculateDistance = (point1, point2) => {
    return Math.sqrt(
      Math.pow(point2.x - point1.x, 2) +
        Math.pow(point2.y - point1.y, 2) +
        Math.pow(point2.z - point1.z, 2)
    );
  };

  // Initialize scene and camera
  const initializeScene = () => {
    cameraRef.current.position.set(0, 0, 2);

    // Ambient light for general illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    sceneRef.current.add(ambientLight);

    // Directional light for shadows and highlights
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, 1, 1).normalize();
    sceneRef.current.add(directionalLight);

    // Setup renderer
    rendererRef.current = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    rendererRef.current.setPixelRatio(window.devicePixelRatio);
    rendererRef.current.outputColorSpace = THREE.SRGBColorSpace;

    // Append renderer to the container
    if (containerRef.current) {
      containerRef.current.appendChild(rendererRef.current.domElement);
    }
  };

  // Load 3D model and apply textures
  const loadModel = () => {
    const loader = new GLTFLoader();

    loader.load(
      modelPath,
      (gltf) => {
        const loadedModel = gltf.scene;

        // Apply textures if provided
        if (textureUrls.length > 0) {
          const textureLoader = new THREE.TextureLoader();
          textureUrls.forEach((textureUrl, index) => {
            textureLoader.load(
              textureUrl,
              (texture) => {
                loadedModel.traverse((node) => {
                  if (node.isMesh) {
                    node.material.map = texture; // Apply texture
                    node.material.needsUpdate = true;
                  }
                });
              },
              undefined,
              (error) => console.error(`Failed to load texture: ${textureUrl}`, error)
            );
          });
        }

        // Save original bounding box width for scaling
        loadedModel.userData.originalWidth = calculateBoundingBoxWidth(loadedModel);
        loadedModel.visible = false; // Hide initially
        sceneRef.current.add(loadedModel);
        setModel(loadedModel);
      },
      undefined,
      (error) => {
        console.error("Error loading model:", error);
      }
    );
  };

  // Calculate bounding box width for scaling
  const calculateBoundingBoxWidth = (model) => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    return size.x;
  };

  // Update glasses position, scale, and rotation
  const updateGlasses = (landmarks) => {
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const noseTip = landmarks[168];
    const eyeDistance = calculateDistance(leftEyeOuter, rightEyeOuter);
    const widthScaleFactor = eyeDistance / model.userData.originalWidth;

    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.9,
      widthScaleFactor * 1.9,
      widthScaleFactor * 1.5
    );
    model.position.set(
      (noseTip.x - 0.5) * 3,
      -(noseTip.y - 0.5) * 3,
      -noseTip.z * 3 - eyeDistance
    );
    model.rotation.y = Math.atan2(rightEyeOuter.z - leftEyeOuter.z, rightEyeOuter.x - leftEyeOuter.x);
  };

  // Update hat position, scale, and rotation
  const updateHat = (landmarks) => {
    const forehead = landmarks[10];
    const leftTemple = landmarks[227];
    const rightTemple = landmarks[447];
    const headWidth = calculateDistance(leftTemple, rightTemple);
    const widthScaleFactor = headWidth / model.userData.originalWidth;

    model.visible = true;
    model.scale.set(
      widthScaleFactor * 1.5,
      widthScaleFactor * 1.2,
      widthScaleFactor
    );
    model.position.set(
      (forehead.x - 0.5) * 3,
      -(forehead.y - 0.6) * 3,
      -forehead.z * 3 - headWidth
    );
    model.rotation.y = Math.atan2(rightTemple.z - leftTemple.z, rightTemple.x - leftTemple.x);
  };

  // Animation loop
  const animate = () => {
    animationFrameId.current = requestAnimationFrame(animate);
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  };

  // Initialize and load the scene
  useEffect(() => {
    if (!modelPath) return;

    initializeScene();
    loadModel();
    animate();

    // Cleanup resources on unmount
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [modelPath]);

  return <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />;
});

export default ARTryOn;
