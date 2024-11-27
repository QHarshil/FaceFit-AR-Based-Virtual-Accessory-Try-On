import React, { useRef, useEffect } from 'react';
import Webcam from "react-webcam";
import { FaceMesh } from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import ARTryOn from './ARTryOn';

function FaceMeshComponent() {
  const webcamRef = useRef(null);
  const arRef = useRef(null);
  const cameraRef = useRef(null);

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
  }

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
        modelPath="/models/glasses2.glb"
        type="glasses"
      />
    </div>
  );
}

export default FaceMeshComponent;