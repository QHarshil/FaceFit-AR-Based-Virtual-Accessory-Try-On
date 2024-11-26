import React, { useRef, useEffect } from 'react';
import Webcam from "react-webcam";
import { FaceMesh } from '@mediapipe/face_mesh';
import * as Facemesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';
function FaceMeshComponent() {
 const webcamRef = useRef(null);
 const canvasRef = useRef(null);
 var camera = null;
  function onResults(results) {
   const canvasElement = canvasRef.current;
   const canvasCtx = canvasElement.getContext("2d");
    canvasElement.width = webcamRef.current.video.videoWidth;
   canvasElement.height = webcamRef.current.video.videoHeight;
    canvasCtx.save();
   canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
   canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    if (results.multiFaceLandmarks) {
     for (const landmarks of results.multiFaceLandmarks) {
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 0.5 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_RIGHT_EYE, { color: '#FF3030', lineWidth: 1 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_RIGHT_EYEBROW, { color: '#FF3030', lineWidth: 1 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_LEFT_EYE, { color: '#30FF30', lineWidth: 1 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_LEFT_EYEBROW, { color: '#30FF30', lineWidth: 1 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_FACE_OVAL, { color: '#E0E0E0', lineWidth: 1 });
       drawConnectors(canvasCtx, landmarks, Facemesh.FACEMESH_LIPS, { color: '#E0E0E0', lineWidth: 1 });
     }
   }
   canvasCtx.restore();
 }
  useEffect(() => {
   const faceMesh = new FaceMesh({
     locateFile: (file) => {
       return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
     }
   });
    faceMesh.setOptions({
     maxNumFaces: 1,
     minDetectionConfidence: 0.5,
     minTrackingConfidence: 0.5,
   });
    faceMesh.onResults(onResults);
    if (typeof webcamRef.current !== "undefined" && webcamRef.current !== null) {
     camera = new cam.Camera(webcamRef.current.video, {
       onFrame: async () => {
         await faceMesh.send({ image: webcamRef.current.video });
       },
       width: 1280,
       height: 720
     });
     camera.start();
   }
 }, []);
  return (
   <>
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
         zIndex: 9,
         width: "100%",
         height: "auto",
       }}
     />
     <canvas
       ref={canvasRef}
       style={{
         position: "absolute",
         marginLeft: "auto",
         marginRight: "auto",
         left: 0,
         right: 0,
         textAlign: "center",
         zIndex: 9,
         width: "100%",
         height: "auto",
       }}
     ></canvas>
   </>
 );
}

export default FaceMeshComponent;