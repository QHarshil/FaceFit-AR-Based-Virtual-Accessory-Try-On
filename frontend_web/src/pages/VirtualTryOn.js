import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const VirtualTryOn = () => {
  const { productId } = useParams();
  const canvasRef = useRef(null);
  
  useEffect(() => {
    let camera, scene, renderer;
    const init = async () => {
      // Three.js initialization
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current });
      
      // Load product model
      const loader = new GLTFLoader();
      const product = await fetch(`/api/products/${productId}`).then(res => res.json());
      
      loader.load(product.modelUrl, (gltf) => {
        scene.add(gltf.scene);
      });

      // Basic lighting
      const light = new THREE.AmbientLight(0xffffff, 1);
      scene.add(light);

      camera.position.z = 5;
      
      // Animation loop
      const animate = () => {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      
      animate();
    };

    init();
  }, [productId]);

  return (
    <div className="relative">
      <canvas 
        ref={canvasRef} 
        className="w-full h-[600px]"
      />
      <div className="absolute top-4 left-4 bg-white p-4 rounded-md shadow-md">
        <h2 className="text-xl font-bold mb-2">Virtual Try-On</h2>
        <p className="text-gray-600">Move your head to adjust the view</p>
      </div>
    </div>
  );
};

export default VirtualTryOn;