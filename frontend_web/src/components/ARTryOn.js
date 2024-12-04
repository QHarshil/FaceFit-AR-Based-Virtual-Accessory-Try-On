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
  
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];
    const nose = landmarks[168];
  
    // 使用眼睛实际宽度作为基准
    const eyeWidth = Math.sqrt(
      Math.pow(rightEye.x - leftEye.x, 2) +
      Math.pow(rightEye.y - leftEye.y, 2)
    );
  
    // 调整缩放基准
    const desiredWidth = eyeWidth * 6.2;
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    model.visible = true;
    model.scale.set(
      widthScaleFactor,
      widthScaleFactor,
      widthScaleFactor
    );
  
    // 使用眼睛中心点定位
    const eyeCenterX = (rightEye.x + leftEye.x) / 2;
    const eyeCenterY = (rightEye.y + leftEye.y) / 2;
    const eyeDepth = (rightEye.z + leftEye.z) / 2;
  
    // 应用更精确的位置偏移
    model.position.set(
      (eyeCenterX - 0.5) * 2.4,           // 减小水平偏移
      -(eyeCenterY - 0.45) * 2.4,         // 调整垂直位置
      -nose.z * 2.4 - 0.15                // 优化深度位置
    );
  
    // 计算更准确的旋转角度
    const eyeVector = {
      x: rightEye.x - leftEye.x,
      y: rightEye.y - leftEye.y,
      z: rightEye.z - leftEye.z
    };
  
    // 限制旋转范围
    const clampRotation = (value, min = -0.3, max = 0.3) => {
      return Math.min(Math.max(value, min), max);
    };
  
    // 应用有限的旋转
    model.rotation.y = clampRotation(Math.atan2(eyeVector.z, eyeVector.x) * 0.3);
    model.rotation.x = clampRotation(Math.atan2(-eyeVector.y, 
      Math.sqrt(eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z)) * 0.3);
    model.rotation.z = clampRotation(Math.atan2(eyeVector.y, eyeVector.x) * 0.15);
  
    model.updateWorldMatrix();
  };
  
  const updateHat = (landmarks) => {
    if (!model) return;
  
    const topHead = landmarks[10];    // 头顶
    const foreheadCenter = landmarks[151];  // 使用更低的前额点
    const leftTemple = landmarks[234];
    const rightTemple = landmarks[454];
  
    // 计算头部宽度
    const headWidth = Math.sqrt(
      Math.pow(rightTemple.x - leftTemple.x, 2) +
      Math.pow(rightTemple.y - leftTemple.y, 2)
    );
  
    // 调整缩放
    const desiredWidth = headWidth * 5.8;
    const widthScaleFactor = desiredWidth / model.userData.originalWidth;
  
    model.visible = true;
    model.scale.set(widthScaleFactor, widthScaleFactor, widthScaleFactor);
  
    // 固定帽子在头顶位置
    const yOffset = 0.62; // 微调垂直位置
    model.position.set(
      (topHead.x - 0.5) * 2.4,
      -(topHead.y - yOffset) * 2.4,
      -topHead.z * 2.4 - 0.1
    );
  
    // 计算头部方向
    const headVector = {
      x: rightTemple.x - leftTemple.x,
      y: rightTemple.y - leftTemple.y,
      z: rightTemple.z - leftTemple.z
    };
  
    // 限制旋转范围的函数
    const clampRotation = (value, min = -0.2, max = 0.2) => {
      return Math.min(Math.max(value, min), max);
    };
  
    // 计算基础旋转角度
    let rotationY = Math.atan2(headVector.z, headVector.x);
    let rotationX = Math.atan2(headVector.y, Math.sqrt(headVector.x * headVector.x + headVector.z * headVector.z));
  
    // 应用受限的旋转，移除额外的旋转补偿
    model.rotation.y = clampRotation(rotationY * 0.3);
    model.rotation.x = clampRotation(rotationX * 0.3);
    model.rotation.z = clampRotation(Math.atan2(headVector.y, headVector.x) * 0.15);
  
    model.updateWorldMatrix();
  };

  const removeCurrentModel = () => {
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
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '2';
    containerRef.current.appendChild(renderer.domElement);

    removeCurrentModel(); // Remove the current model before loading a new one

    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const loadedModel = gltf.scene;
        const boundingBox = new THREE.Box3().setFromObject(loadedModel);
        loadedModel.userData.originalWidth = boundingBox.max.x - boundingBox.min.x;
        loadedModel.visible = false;
        
        // Reset position, scale, and rotation
        loadedModel.position.set(0, 0, 0);
        loadedModel.scale.set(1, 1, 1);
        loadedModel.rotation.set(0, 0, 0);
        
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