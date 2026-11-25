import { useNavigate } from 'react-router-dom';
import type { Product } from '../types';

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
  const theme =
    ILLUSTRATION_THEMES[(product.id - 1) % ILLUSTRATION_THEMES.length] ?? ILLUSTRATION_THEMES[0];
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

interface ProductCardProps {
  product: Product;
}

function ProductCard({ product }: ProductCardProps) {
  const navigate = useNavigate();
  return (
    <article className="product-card">
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
  );
}

export default ProductCard;
