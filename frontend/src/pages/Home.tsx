import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Home.css';
import { getProducts } from '../services/apiClient';
import type { Product } from '../types';
import { sendTelemetry } from '../utils/telemetry';

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

const LOADING_PLACEHOLDERS = Array.from({ length: 4 }, (_, index) => index);
interface IllustrationTheme {
  frame: string;
  lens: string;
  accent: string;
  background: string;
}

const ILLUSTRATION_THEMES: [IllustrationTheme, ...IllustrationTheme[]] = [
  { frame: '#1d4ed8', lens: '#bfdbfe', accent: '#2563eb', background: '#eff6ff' },
  { frame: '#047857', lens: '#bbf7d0', accent: '#0f766e', background: '#ecfdf5' },
  { frame: '#7c3aed', lens: '#ddd6fe', accent: '#6d28d9', background: '#f5f3ff' },
  { frame: '#dc2626', lens: '#fecaca', accent: '#b91c1c', background: '#fef2f2' },
];

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  const theme =
    ILLUSTRATION_THEMES[(product.id - 1) % ILLUSTRATION_THEMES.length] ?? ILLUSTRATION_THEMES[0];
  const hasValidImage = Boolean(product.image) && !failed;

  if (!hasValidImage) {
    return (
      <div className="product-illustration" style={{ backgroundColor: theme.background }}>
        <span
          className="product-illustration__temple product-illustration__temple--left"
          style={{ backgroundColor: theme.frame }}
        />
        <span
          className="product-illustration__lens product-illustration__lens--left"
          style={{ borderColor: theme.frame, backgroundColor: theme.lens }}
        />
        <span className="product-illustration__bridge" style={{ backgroundColor: theme.accent }} />
        <span
          className="product-illustration__lens product-illustration__lens--right"
          style={{ borderColor: theme.frame, backgroundColor: theme.lens }}
        />
        <span
          className="product-illustration__temple product-illustration__temple--right"
          style={{ backgroundColor: theme.frame }}
        />
      </div>
    );
  }

  return (
    <img
      src={product.image}
      alt={product.name}
      className="product-image"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function Home() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProducts = async () => {
      setLoading(true);
      setError(null);
      try {
        const catalogue = await getProducts();
        if (!isMounted) return;
        setProducts(catalogue);
        void sendTelemetry('catalogue_loaded', { count: catalogue.length });
      } catch (err) {
        if (!isMounted) return;
        console.error('Failed to load products:', err);
        setError('We could not reach the product catalogue. Please retry in a moment.');
        void sendTelemetry('catalogue_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
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
  }, []);

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
        <div className="products-grid">
          {loading &&
            LOADING_PLACEHOLDERS.map((placeholder) => (
              <article
                key={`placeholder-${placeholder}`}
                className="product-card product-card--loading"
              >
                <div className="product-image-container">
                  <div className="loading-skeleton image-skeleton" />
                </div>
                <div className="product-info">
                  <div className="loading-skeleton text-skeleton large" />
                  <div className="loading-skeleton text-skeleton small" />
                  <div className="loading-skeleton text-skeleton" />
                </div>
                <div className="loading-skeleton button-skeleton" />
              </article>
            ))}

          {!loading &&
            !error &&
            products.map((product) => (
              <article key={product.id} className="product-card">
                <div className="product-image-container">
                  <ProductImage product={product} />
                </div>
                <div className="product-info">
                  <h3 className="product-name">{product.name}</h3>
                  <p className="product-category">{product.category}</p>
                  <p className="product-description">{product.description}</p>
                </div>
                <button
                  className="try-on-button"
                  onClick={() => {
                    void navigate(`/try-on/${product.id}`);
                  }}
                >
                  Open Try-On
                </button>
              </article>
            ))}

          {!loading && error && (
            <article className="product-card product-card--error">
              <div className="product-info">
                <h3 className="product-name">Catalogue unavailable</h3>
                <p className="product-description">{error}</p>
              </div>
              <button className="try-on-button" onClick={() => window.location.reload()}>
                Retry
              </button>
            </article>
          )}
        </div>
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
