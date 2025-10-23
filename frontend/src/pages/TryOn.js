import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import ARTryOn from '../components/ARTryOn';
import { getProductById } from '../services/apiClient';
import { sendTelemetry } from '../utils/telemetry';
import '../styles/TryOn.css';

function TryOn() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const arRef = useRef(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState(null);
  const [productLoading, setProductLoading] = useState(true);
  const faceStateRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    setProductLoading(true);
    setError(null);

    const fetchProduct = async () => {
      try {
        const item = await getProductById(id);
        if (!isMounted) return;
        setProduct(item);
        sendTelemetry('product_viewed', { productId: item.id });
      } catch (err) {
        if (!isMounted) return;
        console.error('Product load error:', err);
        setProduct(null);
        setError('Product not found. Please choose another frame.');
        sendTelemetry('product_load_failed', { productId: id, message: err.message });
      } finally {
        if (isMounted) {
          setProductLoading(false);
        }
      }
    };

    fetchProduct();
    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!product || !videoRef.current) {
      return;
    }

    let isActive = true;

    const initCamera = async () => {
      try {
        const faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results) => {
          if (!isActive) return;

          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            setFaceDetected(true);
            const landmarks = results.multiFaceLandmarks[0];
            if (arRef.current) {
              arRef.current.updateModel(landmarks);
            }
          } else {
            setFaceDetected(false);
          }
        });

        faceMeshRef.current = faceMesh;

        if (videoRef.current) {
          const camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && faceMeshRef.current && isActive) {
                await faceMeshRef.current.send({ image: videoRef.current });
              }
            },
            width: 1280,
            height: 720
          });

          await camera.start();
          cameraRef.current = camera;
          setCameraReady(true);
          sendTelemetry('camera_started', { productId: product.id });
        }
      } catch (err) {
        console.error('Camera error:', err);
        setError('Unable to start the camera. Please allow access and refresh the page.');
        sendTelemetry('camera_error', { productId: product.id, message: err.message });
      }
    };

    initCamera();

    return () => {
      isActive = false;
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (faceMeshRef.current?.close) {
        faceMeshRef.current.close();
      }
      faceMeshRef.current = null;
      setCameraReady(false);
    };
  }, [product]);

  useEffect(() => {
    if (!cameraReady) return;
    if (faceStateRef.current === faceDetected) return;
    faceStateRef.current = faceDetected;
    sendTelemetry('tracking_state_changed', {
      productId: product?.id || null,
      faceDetected,
    });
  }, [cameraReady, faceDetected, product]);

  if (error) {
    return (
      <div className="try-on-container">
        <div className="error-message">
          <h2>{error}</h2>
          <button onClick={() => navigate('/')} className="back-button">
            Back to catalogue
          </button>
        </div>
      </div>
    );
  }

  if (!product && !productLoading) {
    return (
      <div className="try-on-container">
        <div className="error-message">
          <h2>Product not found</h2>
          <button onClick={() => navigate('/')} className="back-button">
            Back to catalogue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="try-on-container">
      <video
        ref={videoRef}
        className="video-feed"
        autoPlay
        playsInline
        muted
      />

      {product && (
        <ARTryOn ref={arRef} modelPath={product.modelPath} type={product.type} />
      )}

      <div className="ui-overlay">
        <div className="top-bar">
          <button onClick={() => navigate('/')} className="back-button">
            Back
          </button>
          <div className="product-info">
            {product ? (
              <>
                <h2>{product.name}</h2>
                <p>{product.type}</p>
              </>
            ) : (
              <>
                <h2>Loading selection…</h2>
                <p>Preparing frame</p>
              </>
            )}
          </div>
          <div className="spacer" />
        </div>

        <div className="status-indicator">
          {productLoading && (
            <div className="status-message loading">
              <div className="spinner" />
              <span>Preparing product...</span>
            </div>
          )}

          {!cameraReady && !productLoading && (
            <div className="status-message loading">
              <div className="spinner" />
              <span>Initializing camera...</span>
            </div>
          )}

          {cameraReady && !faceDetected && !error && !productLoading && (
            <div className="status-message warning">
              <span>Align your face with the camera.</span>
            </div>
          )}

          {cameraReady && faceDetected && !productLoading && (
            <div className="status-message success">
              <span>Tracking active.</span>
            </div>
          )}

          {error && (
            <div className="status-message error">
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TryOn;
