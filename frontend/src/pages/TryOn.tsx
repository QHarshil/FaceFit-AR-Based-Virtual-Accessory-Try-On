import { parseProductId } from '@facefit/contracts';
import { useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import ARTryOn from '../components/ARTryOn';
import ErrorBoundary from '../components/ErrorBoundary';
import PhotoView from '../components/PhotoView';
import StatusPanel from '../components/StatusPanel';
import { sendTelemetry } from '../telemetry/client';
import { telemetryEvents } from '../telemetry/events';
import { useTryOn } from '../tryon/useTryOn';
import '../styles/TryOn.css';

function TryOnView({ productId }: { productId: number | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { actor, poseStream, status, product, overlayAttempt, source, photo } = useTryOn(
    productId,
    videoRef,
  );

  return (
    <main
      className={
        source === 'photo' ? 'try-on-container try-on-container--photo' : 'try-on-container'
      }
    >
      <video
        ref={videoRef}
        className={source === 'photo' ? 'video-feed video-feed--hidden' : 'video-feed'}
        autoPlay
        playsInline
        muted
        aria-hidden="true"
      />
      {source === 'photo' && photo && <PhotoView photo={photo} />}

      {product && (
        // Keyed by the attempt, so a retry also clears a caught crash.
        <ErrorBoundary
          key={overlayAttempt}
          surface="Overlay"
          fallback={() => null}
          onError={() => actor.send({ type: 'RENDER_CRASHED' })}
        >
          <ARTryOn
            modelPath={product.modelPath}
            anchors={product.anchors}
            poseStream={poseStream}
            onEvent={(event) => actor.send(event)}
          />
        </ErrorBoundary>
      )}

      <div className="ui-overlay">
        <header className="top-bar">
          <Link to="/" className="back-button">
            Back
          </Link>
          <div className="product-info">
            <h1>{product?.name ?? 'Virtual try-on'}</h1>
            <p>{product?.type ?? 'Glasses'}</p>
          </div>
          <div className="spacer" />
        </header>

        <StatusPanel
          status={status}
          onSend={(type) => actor.send({ type })}
          onPhoto={(photo) => actor.send({ type: 'PHOTO_SELECTED', photo })}
        />
      </div>
    </main>
  );
}

function TryOn() {
  const { id } = useParams();
  const productId = parseProductId(id);
  return (
    <ErrorBoundary
      key={id}
      surface="Try-on view"
      onError={() => sendTelemetry(telemetryEvents.renderError(productId, 'render_crash'))}
      fallback={(reset) => (
        <main className="try-on-container">
          <div className="error-message" role="alert">
            <h1>The try-on stopped working</h1>
            <div className="error-actions">
              <button type="button" className="back-button" onClick={reset}>
                Try again
              </button>
              <Link to="/" className="back-button">
                Back to catalogue
              </Link>
            </div>
          </div>
        </main>
      )}
    >
      {/* A new product starts a new statechart, camera and worker. */}
      <TryOnView key={id} productId={productId} />
    </ErrorBoundary>
  );
}

export default TryOn;
