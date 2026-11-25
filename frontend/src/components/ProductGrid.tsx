import type { Product } from '../types';
import ProductCard from './ProductCard';

const LOADING_PLACEHOLDERS = Array.from({ length: 4 }, (_, index) => index);

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function ProductGrid({ products, loading, error, onRetry }: ProductGridProps) {
  return (
    <div className="products-grid" aria-busy={loading}>
      <p className="visually-hidden" role="status">
        {loading ? 'Loading frames' : error ? '' : `${products.length} frames`}
      </p>
      {loading &&
        LOADING_PLACEHOLDERS.map((placeholder) => (
          <article
            key={`placeholder-${placeholder}`}
            className="product-card product-card--loading"
            aria-hidden="true"
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
        products.map((product) => <ProductCard key={product.id} product={product} />)}

      {!loading && error && (
        <article className="product-card product-card--error" role="alert">
          <div className="product-info">
            <h3 className="product-name">Catalogue unavailable</h3>
            <p className="product-description">{error}</p>
          </div>
          <button type="button" className="try-on-button" onClick={onRetry}>
            Retry
          </button>
        </article>
      )}
    </div>
  );
}

export default ProductGrid;
