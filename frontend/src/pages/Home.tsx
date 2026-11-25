import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import ProductGrid from '../components/ProductGrid';
import '../styles/Home.css';
import { apiFailureOf, getProducts } from '../services/apiClient';
import { sendTelemetry } from '../telemetry/client';
import { telemetryEvents } from '../telemetry/events';
import type { Product } from '../types';

const CAPABILITIES = [
  {
    title: 'Landmarks in a worker',
    description:
      'MediaPipe FaceLandmarker returns 478 landmarks per frame, irises included. It runs in a Web Worker on the GPU from self-hosted files, so the page stays responsive.',
  },
  {
    title: 'Head pose from geometry',
    description:
      'EPnP and Levenberg-Marquardt fit a canonical face model to weighted rigid landmarks. Outliers are rejected by residual, and the frame hides when the fit is poor.',
  },
  {
    title: 'Private by design',
    description:
      'Video, landmarks and measurements stay in the browser. A Content Security Policy blocks connections to other hosts, and the measurement harness fails a run that makes one.',
  },
];

function Home() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadProducts = async () => {
      setLoading(true);
      setError(null);
      try {
        const catalogue = await getProducts();
        if (!isMounted) return;
        setProducts(catalogue);
        sendTelemetry(telemetryEvents.catalogueLoaded(catalogue.length));
      } catch (err) {
        if (!isMounted) return;
        console.error('Failed to load products:', err);
        setError('We could not reach the product catalogue. Please retry in a moment.');
        sendTelemetry(telemetryEvents.catalogueFailed(apiFailureOf(err)));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadProducts();
    return () => {
      isMounted = false;
    };
  }, [attempt]);

  const [primaryProductId, secondaryProductId] = useMemo((): [
    number | undefined,
    number | undefined,
  ] => {
    if (products.length === 0) {
      return [undefined, undefined];
    }
    return [products[0]?.id, products[1]?.id ?? products[0]?.id];
  }, [products]);

  const handleNavigate = (productId: number | undefined) => {
    if (!productId) return;
    void navigate(`/try-on/${productId}`);
  };

  return (
    <div className="home-container">
      <header className="hero">
        <div className="hero-context">On-device AR try-on</div>
        <h1 className="hero-title">FaceFit AR</h1>
        <p className="hero-subtitle">
          Try on eyewear in the browser. A head-pose solver recovers where your face is in 3D, and
          Three.js draws each frame with the camera&apos;s own projection. Video never leaves your
          device.
        </p>
        <div className="hero-cta">
          <button
            className="primary-action"
            onClick={() => handleNavigate(primaryProductId)}
            disabled={loading || !primaryProductId}
          >
            Launch Try-On
          </button>
          <button
            className="secondary-action"
            onClick={() => handleNavigate(secondaryProductId)}
            disabled={loading || !secondaryProductId}
          >
            Explore Catalogue
          </button>
        </div>
      </header>

      <section className="products-section">
        <h2 className="section-title">Select a Frame</h2>
        <p className="section-subtitle">
          Each frame is a normalized model with nominal dimensions in millimetres, seated on the
          nose bridge by its anchor points.
        </p>
        <ErrorBoundary
          surface="Catalogue"
          fallback={(reset) => (
            <div className="products-grid">
              <article className="product-card product-card--error">
                <div className="product-info">
                  <h3 className="product-name">The catalogue could not be shown</h3>
                </div>
                <button className="try-on-button" onClick={reset}>
                  Try again
                </button>
              </article>
            </div>
          )}
        >
          <ProductGrid
            products={products}
            loading={loading}
            error={error}
            onRetry={() => setAttempt((count) => count + 1)}
          />
        </ErrorBoundary>
      </section>

      <section className="capabilities-section">
        <h2 className="section-title">System Capabilities</h2>
        <div className="capabilities-grid">
          {CAPABILITIES.map((item) => (
            <div key={item.title} className="capability-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Home;
