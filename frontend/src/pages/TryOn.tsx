import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ARTryOn from '../components/ARTryOn';
import { getProductById } from '../services/apiClient';
import { startFaceTracking } from '../tracking/faceTracking';
import type { ARTryOnHandle, Product } from '../types';
import { probe } from '../utils/probe';
import { sendTelemetry } from '../utils/telemetry';
import '../styles/TryOn.css';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function TryOn() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const arRef = useRef<ARTryOnHandle | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [productLoading, setProductLoading] = useState(true);
  const faceStateRef = useRef<boolean | null>(null);

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
        sendTelemetry('product_load_failed', { productId: id, message: errorMessage(err) });
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
    const video = videoRef.current;
    if (!product || !video) {
      return;
    }

    let isActive = true;
    const productId = product.id;

    const reportCameraError = (err: unknown) => {
      if (!isActive) return;
      console.error('Camera error:', err);
      setError('Unable to start the camera. Please allow access and refresh the page.');
      sendTelemetry('camera_error', { productId, message: errorMessage(err) });
    };

    let tracking: ReturnType<typeof startFaceTracking>;
    try {
      tracking = startFaceTracking(video, (landmarks) => {
        if (!landmarks) {
          setFaceDetected(false);
          return;
        }
        setFaceDetected(true);
        if (arRef.current) {
          const poseStart = performance.now();
          arRef.current.updateModel(landmarks);
          probe({ stage: 'pose', start: poseStart, end: performance.now() });
        }
      });
    } catch (err) {
      reportCameraError(err);
      return;
    }

    tracking.started.then(() => {
      if (!isActive) return;
      setCameraReady(true);
      sendTelemetry('camera_started', { productId });
    }, reportCameraError);

    return () => {
      isActive = false;
      tracking.stop();
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
