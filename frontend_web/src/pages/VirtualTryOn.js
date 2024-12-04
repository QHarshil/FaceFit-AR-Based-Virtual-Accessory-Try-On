import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as mediapipe from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';

const VirtualTryOn = () => {
  const { productId } = useParams();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [camera, setCamera] = useState(null);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const faceMesh = new mediapipe.FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      refineLandmarks: true,
    });

    // 处理人脸检测结果
    faceMesh.onResults((results) => {
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;
      
      // 设置画布尺寸
      canvasRef.current.width = videoWidth;
      canvasRef.current.height = videoHeight;
      
      const canvasCtx = canvasRef.current.getContext('2d');
      
      // 清除画布
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // 绘制摄像头画面
      canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);

      // 如果检测到人脸
      if (results.multiFaceLandmarks) {
        for (const landmarks of results.multiFaceLandmarks) {
          // 绘制人脸网格
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_TESSELATION, 
            { color: '#C0C0C070', lineWidth: 1 });
            
          // 绘制眼睛
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_RIGHT_EYE, 
            { color: '#FF3030', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LEFT_EYE, 
            { color: '#30FF30', lineWidth: 1 });
            
          // 绘制眉毛和嘴唇
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_RIGHT_EYEBROW, 
            { color: '#FF3030', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LEFT_EYEBROW, 
            { color: '#30FF30', lineWidth: 1 });
          drawConnectors(canvasCtx, landmarks, mediapipe.FACEMESH_LIPS, 
            { color: '#E0E0E0', lineWidth: 1 });
        }
      }
    });

    // 启动摄像头
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

    return () => {
      if (camera) {
        camera.stop();
      }
      faceMesh.close();
    };
  }, [camera]);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Virtual Try-On</h1>
      <div className="relative w-full max-w-2xl mx-auto">
        {/* 视频元素 - 用于获取摄像头画面但不显示 */}
        <video
          ref={videoRef}
          className="hidden"
          playsInline
        />
        {/* 画布元素 - 用于显示处理后的画面 */}
        <canvas
          ref={canvasRef}
          className="w-full h-auto"
        />
        
        {/* 控制面板 */}
        <div className="mt-4 p-4 bg-white rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Controls</h2>
          <div className="space-y-2">
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => {
                // 添加控制功能
              }}
            >
              Reset Position
            </button>
            {/* 添加更多控制按钮 */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VirtualTryOn;