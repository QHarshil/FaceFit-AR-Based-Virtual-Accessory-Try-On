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
  const [selectedGlasses, setSelectedGlasses] = useState("/models/glasses2.glb");
  const [selectedHat, setSelectedHat] = useState("/models/hat2.glb");
  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user"
  };

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
  const glassesImages = [
    { src: "/models/glasses1.png", model: "/models/glasses1.glb" },
    { src: "/models/glasses2.png", model: "/models/glasses2.glb" },
    { src: "/models/glasses3.png", model: "/models/glasses3.glb" }
  ];

  const hatImages = [
    { src: "/models/hat1.png", model: "/models/hat1.glb" },
    { src: "/models/hat2.png", model: "/models/hat2.glb" },
    { src: "/models/hat3.png", model: "/models/hat3.glb" }
  ];

  const getImageStyle = (isSelected) => ({
    cursor: 'pointer',
    width: '100px',
    height: '100px',
    border: isSelected ? '5px solid pink' : '3px solid white',
    borderRadius: '5px'
  });

  return (
    <div 
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
          // transform: "scaleX(-1)" // Mirror the webcam
        }}
      />
      <ARTryOn
        ref={arRef}
        modelPath={selectedGlasses}
        type="glasses"
      />
      <ARTryOn
        ref={hatRef}
        modelPath={selectedHat}  // Make sure to use your hat model path
        type="hat"
      />
      <div style={{ position: 'absolute', bottom: '25%', left: '5%', display: 'flex', gap: '20px' }}>
        {glassesImages.map((glasses, index) => (
          <img
            key={index}
            src={glasses.src}
            alt={`Glasses ${index + 1}`}
            onClick={() => setSelectedGlasses(glasses.model)}
            style={getImageStyle(selectedGlasses === glasses.model)}
          />
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: '5%', left: '5%', display: 'flex', gap: '20px' }}>
        {hatImages.map((hat, index) => (
          <img
            key={index}
            src={hat.src}
            alt={`Hat ${index + 1}`}
            onClick={() => setSelectedHat(hat.model)}
            style={getImageStyle(selectedHat === hat.model)}
          />
        ))}
      </div>
    </div>
  );
}

export default FaceMeshComponent;