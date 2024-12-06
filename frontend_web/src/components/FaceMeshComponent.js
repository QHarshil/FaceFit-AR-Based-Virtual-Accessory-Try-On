import React, { useRef, useEffect, useState } from 'react';
import Webcam from "react-webcam";
import { FaceMesh } from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import ARTryOn from './ARTryOn';

function FaceMeshComponent() {
  const webcamRef = useRef(null);
  const arRef = useRef(null);
  const hatRef = useRef(null);
  const cameraRef = useRef(null);
  const [selectedGlasses, setSelectedGlasses] = useState(null);
  const [selectedHat, setSelectedHat] = useState(null);
  const [glassesImages, setGlassesImages] = useState([]);
  const [hatImages, setHatImages] = useState([]);
  
  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user"
  };

  useEffect(() => {
    // Fetch the model data from the backend
    async function fetchModels() {
      try {
        const response = await fetch('http://localhost:8081/api/products');
        const data = await response.json();
        const glassesData = data.filter(item => item.type === 'glasses');
        const hatData = data.filter(item => item.type === 'hat');

        // Map the data to the format used in the component
        setGlassesImages(glassesData.map(item => ({
          src: item.textureUrls[0],
          model: item.modelUrl
        })));

        setHatImages(hatData.map(item => ({
          src: item.textureUrls[0],
          model: item.modelUrl
        })));
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    }

    fetchModels();
  }, []);

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
        width: videoConstraints.width,
        height: videoConstraints.height
      });
      cameraRef.current.start();
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
    };
  }, [webcamRef.current?.video]);

  function onResults(results) {
    if (arRef.current?.updateModel) {
      arRef.current.updateModel(results.multiFaceLandmarks?.[0]);
    }
    if (hatRef.current?.updateModel) {
      hatRef.current.updateModel(results.multiFaceLandmarks?.[0]);
    }
  }

  const getImageStyle = (isSelected) => ({
    cursor: 'pointer',
    width: '80px',
    height: '80px',
    border: isSelected ? '4px solid orange' : '2px solid white',
    borderRadius: '5px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)', // Add shadow
    transition: 'transform 0.2s', // Add transition for smooth effect
    transform: isSelected ? 'scale(1.1)' : 'scale(1)' // Slightly enlarge selected item
  });

  const handleGlassesClick = (model) => {
    setSelectedGlasses(prevModel => prevModel === model ? null : model);
  };

  const handleHatClick = (model) => {
    setSelectedHat(prevModel => prevModel === model ? null : model);
  };

  return (
    <div 
      style={{ 
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 64px)', // Adjust height to account for Navbar
        overflow: 'hidden'
      }}
    >
      <Webcam
        ref={webcamRef}
        videoConstraints={videoConstraints}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {selectedGlasses && (
        <ARTryOn
          ref={arRef}
          modelPath={selectedGlasses}
          type="glasses"
        />
      )}
      {selectedHat && (
        <ARTryOn
          ref={hatRef}
          modelPath={selectedHat}
          type="hat"
        />
      )}
      <div style={{ position: 'absolute', bottom: '5%', left: '5%', display: 'flex', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {glassesImages.map((glasses, index) => (
            <img
              key={index}
              src={glasses.src}
              alt={`Glasses ${index + 1}`}
              onClick={() => handleGlassesClick(glasses.model)}
              style={getImageStyle(selectedGlasses === glasses.model)}
            />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {hatImages.map((hat, index) => (
            <img
              key={index}
              src={hat.src}
              alt={`Hat ${index + 1}`}
              onClick={() => handleHatClick(hat.model)}
              style={getImageStyle(selectedHat === hat.model)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default FaceMeshComponent;
