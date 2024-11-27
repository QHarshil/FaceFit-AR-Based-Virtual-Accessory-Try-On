import React, { useRef, useEffect, useState } from 'react';
import Webcam from "react-webcam";
import { FaceMesh } from '@mediapipe/face_mesh';
import * as Facemesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
function FaceMeshComponent() {
 const webcamRef = useRef(null);
 const containerRef = useRef(null);
 const animationFrameId = useRef(null);  
 const [scene] = useState(new THREE.Scene());
 const [camera] = useState(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
 const [renderer] = useState(new THREE.WebGLRenderer({ alpha: true }));
 const [glasses, setGlasses] = useState(null);
 const cameraRef = useRef(null);
  // Initialize Three.js scene
 useEffect(() => {
   if (!containerRef.current) return;
   console.log('Setting up Three.js scene');
    // Set up Three.js renderer
   renderer.setSize(window.innerWidth, window.innerHeight);
   renderer.setClearColor(0x000000, 0);
   renderer.domElement.style.position = 'absolute';
   renderer.domElement.style.top = '0';
   renderer.domElement.style.left = '0';
   renderer.domElement.style.zIndex = '2';
   containerRef.current.appendChild(renderer.domElement);
   
   // Load 3D glasses model
   const loader = new GLTFLoader();
   loader.load(
     '/models/glasses2.glb',
     (gltf) => {
       console.log('Model loaded successfully', {
        scene: gltf.scene,
        animations: gltf.animations,
      });
       const model = gltf.scene;
      //  model.scale.set(0.4, 0.4, 0.4);
      //  model.position.set(0, 0, -2);

      // Calculate the original width of the glasses model
      const boundingBox = new THREE.Box3().setFromObject(model);
      const glassesWidth = boundingBox.max.x - boundingBox.min.x;
      model.userData.originalWidth = glassesWidth; // Store for reference
      model.visible = false;

       scene.add(model);
       setGlasses(model);
       // Initial render after model is loaded
       renderer.render(scene, camera);
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
    console.log('Cleaning up Three.js scene');
    window.removeEventListener('resize', handleResize);
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    if (containerRef.current?.contains(renderer.domElement)) {
      containerRef.current.removeChild(renderer.domElement);
    }
    // Dispose of Three.js resources
    scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (object.material.length) {
          for (const material of object.material) {
            material.dispose();
          }
        } else {
          object.material.dispose();
        }
      }
    });
    renderer.dispose();
  };
 }, []);
  // Initialize FaceMesh
 useEffect(() => {
   if (!webcamRef.current?.video) return;
    const faceMesh = new FaceMesh({
     locateFile: (file) => {
       return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
     }
   });
    faceMesh.setOptions({
     maxNumFaces: 1,
     refineLandmarks: true,
     minDetectionConfidence: 0.5,
     minTrackingConfidence: 0.5,
   });
    faceMesh.onResults(onResults);
    if (webcamRef.current && webcamRef.current.video) {
     cameraRef.current = new cam.Camera(webcamRef.current.video, {
       onFrame: async () => {
         if (webcamRef.current?.video) {
           await faceMesh.send({ image: webcamRef.current.video });
         }
       },
       width: 1280,
       height: 720
     });
     cameraRef.current.start();
   }
    // Cleanup
   return () => {
     if (cameraRef.current) {
       cameraRef.current.stop();
     }
   };
 }, [webcamRef.current?.video]);
  function onResults(results) {
    if (!results.multiFaceLandmarks || !glasses) {
      console.log('Waiting for face landmarks or glasses model');
      return;
    }
    const landmarks = results.multiFaceLandmarks[0];
    if (!landmarks) {
      glasses.visible = false;
      return;
    }
    glasses.visible = true;
   const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const nose = landmarks[168];  // Center point

    const leftTemple = landmarks[234];  // Left temple
    const rightTemple = landmarks[454];  // Right temple
    const topHead = landmarks[10];      // Top of head
    const bottomHead = landmarks[152];  // Bottom of head

    // Calculate face width and height
    const faceWidth = Math.sqrt(
      Math.pow(rightTemple.x - leftTemple.x, 2) +
      Math.pow(rightTemple.y - leftTemple.y, 2) +
      Math.pow(rightTemple.z - leftTemple.z, 2)
    );
  
    const faceHeight = Math.sqrt(
      Math.pow(topHead.x - bottomHead.x, 2) +
      Math.pow(topHead.y - bottomHead.y, 2) +
      Math.pow(topHead.z - bottomHead.z, 2)
    );
  
    // Calculate ideal glasses size
  const desiredGlassesWidth = faceWidth * 10; // Adjust multiplier as needed
  const originalGlassesWidth = glasses.userData.originalWidth;
  const widthScaleFactor = desiredGlassesWidth / originalGlassesWidth;

      // Apply different scale factors for each dimension
  glasses.scale.set(
    widthScaleFactor,
    widthScaleFactor * 0.8,  // Slightly smaller vertical scale
    widthScaleFactor * 1.35  // Deeper scale for better fit
  );

  
  // Calculate base position using nose and depth offset
  const basePosition = {
    x: (nose.x - 0.5) * 3,
    y: -(landmarks[1].y - 0.5) * 3,  // Using upper face point for Y
    z: -nose.z * 3 - 1.6  // Added depth offset
  };
  

  // Adjust position based on face size
  glasses.position.set(
    basePosition.x,
    basePosition.y + (faceHeight * 0.1),  // Slight vertical adjustment
    basePosition.z
  );

  // Calculate rotation based on eye positions
  const eyeVector = {
    x: rightEye.x - leftEye.x,
    y: rightEye.y - leftEye.y,
    z: rightEye.z - leftEye.z
  };

  // Apply rotations with dampening factors
  glasses.rotation.y = Math.atan2(eyeVector.z, eyeVector.x) * 0.75;
  glasses.rotation.x = (Math.atan2(-eyeVector.y, Math.sqrt(eyeVector.x * eyeVector.x + eyeVector.z * eyeVector.z)) * 0.75) + 0.1;
  glasses.rotation.z = Math.atan2(eyeVector.y, eyeVector.x) * 0.5;

  // Update world matrix
  glasses.updateWorldMatrix();
  //   const nose = landmarks[6];
  //  const leftEye = landmarks[33];
  //  const rightEye = landmarks[263];
  //  const eyeMidpoint = {
  //   x: (leftEye.x + rightEye.x) / 2,
  //   y: (leftEye.y + rightEye.y) / 2,
  //   z: (leftEye.z + rightEye.z) / 2
  // };
  //   if (glasses) {
  //   //  glasses.position.set(
  //   //    (nose.x - 0.5) * 3,
  //   //    -(nose.y - 0.5) * 3,
  //   //    -nose.z * 3
  //   //  );
  //    glasses.position.set(
  //     (eyeMidpoint.x - 0.5) * 3,
  //     -(eyeMidpoint.y - 0.5) * 3,
  //     -eyeMidpoint.z * 3
  //   );
  //     const eyeDistance = Math.sqrt(
  //      Math.pow(rightEye.x - leftEye.x, 2) +
  //      Math.pow(rightEye.y - leftEye.y, 2) +
  //      Math.pow(rightEye.z - leftEye.z, 2)
  //    );
  //     glasses.rotation.y = Math.asin((rightEye.z - leftEye.z) / eyeDistance);
  //    glasses.rotation.x = Math.asin((rightEye.y - leftEye.y) / eyeDistance);
  //    glasses.rotation.z = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  //  }
 }
  return (
   <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100vh' }}>
     <Webcam
       ref={webcamRef}
       videoConstraints={{
         width: 1280,
         height: 720,
         facingMode: "user"
       }}
       style={{
         position: "absolute",
         marginLeft: "auto",
         marginRight: "auto",
         left: 0,
         right: 0,
         textAlign: "center",
         zIndex: 1,
         width: "100%",
         height: "100%",
         objectFit: "cover"
       }}
     />
   </div>
 );
}
export default FaceMeshComponent;