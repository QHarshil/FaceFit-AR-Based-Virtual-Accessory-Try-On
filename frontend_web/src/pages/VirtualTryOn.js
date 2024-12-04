import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as mediapipe from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';

const VirtualTryOn = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [camera, setCamera] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showMesh, setShowMesh] = useState(true);
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [isMirrored, setIsMirrored] = useState(true);
  const [screenshot, setScreenshot] = useState(null);

  // Handle camera initialization and permissions
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 640,
            height: 480,
            facingMode: 'user'
          }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setLoading(false);
          };
        }
      } catch (err) {
        setError('Camera access denied. Please ensure camera permissions are granted.');
        setLoading(false);
        console.error('Camera initialization error:', err);
      }
    };

    initCamera();

    // Cleanup: stop camera stream when component unmounts
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Face detection and rendering setup
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !isCameraActive) return;

    const faceMesh = new mediapipe.FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });

    // Configure FaceMesh settings
    faceMesh.setOptions({
      maxNumFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      refineLandmarks: true,
    });

    // Process face detection results
    faceMesh.onResults((results) => {
      if (!canvasRef.current || !results.image) return;

      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;
      
      // Set canvas dimensions
      canvasRef.current.width = videoWidth;
      canvasRef.current.height = videoHeight;
      
      const canvasCtx = canvasRef.current.getContext('2d');
      
      // Mirror the canvas if enabled
      if (isMirrored) {
        canvasCtx.save();
        canvasCtx.scale(-1, 1);
        canvasCtx.translate(-videoWidth, 0);
      }
      
      // Clear canvas and draw video frame
      canvasCtx.clearRect(0, 0, videoWidth, videoHeight);
      canvasCtx.drawImage(results.image, 0, 0, videoWidth, videoHeight);

      // Draw face mesh if enabled and face is detected
      if (showMesh && results.multiFaceLandmarks) {
        for (const landmarks of results.multiFaceLandmarks) {
          // Draw face mesh
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_TESSELATION, 
            { color: '#C0C0C070', lineWidth: 1 });
          
          // Draw eyes
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_RIGHT_EYE, 
            { color: '#FF3030', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LEFT_EYE, 
            { color: '#30FF30', lineWidth: 1 });
          
          // Draw eyebrows and lips
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_RIGHT_EYEBROW, 
            { color: '#FF3030', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LEFT_EYEBROW, 
            { color: '#30FF30', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LIPS, 
            { color: '#E0E0E0', lineWidth: 1 });
        }
      }

      if (isMirrored) {
        canvasCtx.restore();
      }
    });

    // Initialize and start camera
    if (videoRef.current && !camera) {
      const newCamera = new cam.Camera(videoRef.current, {
        onFrame: async () => {
          await faceMesh.send({ image: videoRef.current });
        },
        width: 640,
        height: 480
      });
      newCamera.start();
      setCamera(newCamera);
    }

    // Cleanup function
    return () => {
      if (camera) {
        camera.stop();
      }
      faceMesh.close();
    };
  }, [camera, isCameraActive, isMirrored, showMesh]);

  // Handle screenshot capture
  const captureScreenshot = () => {
    if (canvasRef.current) {
      const screenshot = canvasRef.current.toDataURL('image/png');
      setScreenshot(screenshot);
      
      // Create download link
      const link = document.createElement('a');
      link.href = screenshot;
      link.download = 'virtual-try-on.png';
      link.click();
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-600 p-4">
        {error}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Virtual Try-On</h1>
      <div className="relative w-full max-w-2xl mx-auto">
        {/* Video element - hidden but used for camera input */}
        <video
          ref={videoRef}
          className="hidden"
          playsInline
        />
        {/* Canvas element - displays processed video frame */}
        <canvas
          ref={canvasRef}
          className="w-full h-auto rounded-lg shadow-lg"
        />
        
        {/* Control panel */}
        <div className="mt-4 p-4 bg-white rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Controls</h2>
          <div className="space-y-2">
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => setShowMesh(!showMesh)}
            >
              {showMesh ? 'Hide' : 'Show'} Face Mesh
            </button>
            <button 
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 ml-2"
              onClick={() => setIsMirrored(!isMirrored)}
            >
              Toggle Mirror Mode
            </button>
            <button 
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 ml-2"
              onClick={captureScreenshot}
            >
              Take Photo
            </button>
            <button 
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 ml-2"
              onClick={() => setIsCameraActive(!isCameraActive)}
            >
              {isCameraActive ? 'Pause' : 'Resume'} Camera
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VirtualTryOn;