import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ARTryOn from '../components/ARTryOn';
import { PerceptionError } from '../perception/errors';
import { hasFace } from '../perception/types';
import { getProductById } from '../services/apiClient';
import {
  RENDER_ERROR_MESSAGE,
  trackingErrorEvent,
  trackingErrorMessage,
} from '../tracking/errorMessages';
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

  // Reset while rendering when the route id changes, so the effect below only
  // starts the request.
  const [requestedId, setRequestedId] = useState(id);
  if (id !== requestedId) {
    setRequestedId(id);
    setProductLoading(true);
    setError(null);
  }

  useEffect(() => {
    let isMounted = true;

    const fetchProduct = async () => {
      try {
        const item = await getProductById(id);
        if (!isMounted) return;
        setProduct(item);
        void sendTelemetry('product_viewed', { productId: item.id });
      } catch (err) {
        if (!isMounted) return;
        console.error('Product load error:', err);
        setProduct(null);
        setError('Product not found. Please choose another frame.');
        void sendTelemetry('product_load_failed', { productId: id, message: errorMessage(err) });
      } finally {
        if (isMounted) {
          setProductLoading(false);
        }
      }
    };

    void fetchProduct();
    return () => {
      isMounted = false;
    };
  }, [id]);

  // Depends on `error` so the camera and worker stop once the error screen,
  // which has no video element, replaces the try-on.
  useEffect(() => {
    const video = videoRef.current;
    if (!product || !video || error) {
      return;
    }

    let isActive = true;
    const productId = product.id;

    const reportTrackingError = (err: unknown) => {
      if (!isActive) return;
      console.error('Tracking error:', err);
      setError(trackingErrorMessage(err));
      void sendTelemetry(trackingErrorEvent(err), {
        productId,
        ...(err instanceof PerceptionError ? { code: err.code } : { message: errorMessage(err) }),
      });
    };

    let tracking: ReturnType<typeof startFaceTracking>;
    try {
      tracking = startFaceTracking(video, {
        onLandmarks: (frame) => {
          setFaceDetected(hasFace(frame));
          // Frames without a face go to the overlay too, so it hides.
          if (arRef.current) {
            const poseStart = performance.now();
            arRef.current.updateModel(frame);
            probe({ stage: 'pose', start: poseStart, end: performance.now() });
          }
        },
        onError: reportTrackingError,
      });
    } catch (err) {
      reportTrackingError(err);
      return;
    }

    tracking.started.then(() => {
      if (!isActive) return;
      setCameraReady(true);
      void sendTelemetry('camera_started', { productId });
    }, reportTrackingError);

    return () => {
      isActive = false;
      tracking.stop();
      setCameraReady(false);
    };
  }, [product, error]);

  const reportRenderError = useCallback(
    (err: unknown) => {
      console.error('Render error:', err);
      setError(RENDER_ERROR_MESSAGE);
      void sendTelemetry('render_error', { productId: product?.id ?? null });
    },
    [product],
  );

  useEffect(() => {
    if (!cameraReady) return;
    if (faceStateRef.current === faceDetected) return;
    faceStateRef.current = faceDetected;
    void sendTelemetry('tracking_state_changed', {
      productId: product?.id || null,
      faceDetected,
    });
  }, [cameraReady, faceDetected, product]);

  if (error) {
    return (
      <div className="try-on-container">
        <div className="error-message">
          <h2>{error}</h2>
          <button
            onClick={() => {
              void navigate('/');
            }}
            className="back-button"
          >
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
          <button
            onClick={() => {
              void navigate('/');
            }}
            className="back-button"
          >
            Back to catalogue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="try-on-container">
      <video ref={videoRef} className="video-feed" autoPlay playsInline muted />

      {product && (
        <ARTryOn
          ref={arRef}
          modelPath={product.modelPath}
          anchors={product.anchors}
          onError={reportRenderError}
        />
      )}

      <div className="ui-overlay">
        <div className="top-bar">
          <button
            onClick={() => {
              void navigate('/');
            }}
            className="back-button"
          >
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
