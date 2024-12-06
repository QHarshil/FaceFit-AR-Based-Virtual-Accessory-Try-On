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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user",
  };

  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch('http://localhost:8081/api/products');
        if (!response.ok) throw new Error("Failed to fetch models");
        const data = await response.json();

        setGlassesImages(
          data
            .filter((item) => item.category.toLowerCase() === 'glasses')
            .map((item) => ({
              src: item.textureUrls[0] || '/placeholder-glasses.png',
              model: item.modelUrl,
            }))
        );

        setHatImages(
          data
            .filter((item) => item.category.toLowerCase() === 'hat')
            .map((item) => ({
              src: item.textureUrls[0] || '/placeholder-hat.png',
              model: item.modelUrl,
            }))
        );

        setError(null);
      } catch (err) {
        console.error(err);
        setError("Failed to load models. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    fetchModels();
  }, []);

  useEffect(() => {
    if (!webcamRef.current?.video) return;

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
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
        height: videoConstraints.height,
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
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
    transition: 'transform 0.2s',
    transform: isSelected ? 'scale(1.1)' : 'scale(1)',
  });

  const handleGlassesClick = (model) => {
    setSelectedGlasses((prevModel) => (prevModel === model ? null : model));
  };

  const handleHatClick = (model) => {
    setSelectedHat((prevModel) => (prevModel === model ? null : model));
  };

  if (loading) {
    return <div className="text-center text-lg">Loading models...</div>;
  }

  if (error) {
    return <div className="text-center text-red-600">{error}</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Camera feed */}
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

      {/* AR Try-On Components */}
      {selectedGlasses && <ARTryOn ref={arRef} modelPath={selectedGlasses} type="glasses" />}
      {selectedHat && <ARTryOn ref={hatRef} modelPath={selectedHat} type="hat" />}

      {/* Texture Selectors */}
      <div style={{ position: 'absolute', bottom: '5%', left: '5%', display: 'flex', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
