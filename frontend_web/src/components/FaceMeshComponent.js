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
       model.scale.set(0.4, 0.4, 0.4);
       model.position.set(0, 0, -2);
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
   if (!landmarks) return;
    const nose = landmarks[6];
   const leftEye = landmarks[33];
   const rightEye = landmarks[263];
    if (glasses) {
    //   // Log positions for debugging
    //  console.log('Face landmarks:', {
    //   nose: { x: nose.x, y: nose.y, z: nose.z },
    //   leftEye: { x: leftEye.x, y: leftEye.y, z: leftEye.z },
    //   rightEye: { x: rightEye.x, y: rightEye.y, z: rightEye.z }
    // });
     glasses.position.set(
       (nose.x - 0.5) * 3,
       -(nose.y - 0.5) * 3,
       -nose.z * 3
     );
      const eyeDistance = Math.sqrt(
       Math.pow(rightEye.x - leftEye.x, 2) +
       Math.pow(rightEye.y - leftEye.y, 2) +
       Math.pow(rightEye.z - leftEye.z, 2)
     );
      glasses.rotation.y = Math.asin((rightEye.z - leftEye.z) / eyeDistance);
     glasses.rotation.x = Math.asin((rightEye.y - leftEye.y) / eyeDistance);
     glasses.rotation.z = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
      // // Log glasses transform for debugging
      // console.log('Glasses transform:', {
      //   position: glasses.position,
      //   rotation: glasses.rotation
      // });
   }
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