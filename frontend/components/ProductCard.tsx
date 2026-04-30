import Image from 'next/image';
import { ProductResponse } from '@/types/category';
import { formatPrice } from '@/lib/categoryApi';
import styles from './ProductCard.module.css';

interface ProductCardProps {
  product: ProductResponse;
  priority?: boolean;
}

export default function ProductCard({ product, priority = false }: ProductCardProps) {
  const price = typeof product.price === 'string' ? parseFloat(product.price) : product.price;
  const formattedPrice = product.price_formatted || formatPrice(price, product.currency);

  const stockLabel = product.is_available
    ? product.in_stock === false ? 'Out of stock' : 'In stock'
    : 'Out of stock';
  const stockClass = product.is_available
    ? product.in_stock === false ? styles.outOfStock : styles.inStock
    : styles.outOfStock;

  return (
    <article className={styles.card}>
      <a
        href={product.affiliate_url || product.buy_url}
        className={styles.imageLink}
        target="_blank"
        rel="noopener sponsored"
        aria-label={`View ${product.name} on ${product.source}`}
      >
        <div className={styles.imageWrapper}>
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              className={styles.image}
              priority={priority}
            />
          ) : (
            <div className={styles.imagePlaceholder}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          )}
          {product.price_trend && (
            <span className={`${styles.trendBadge} ${styles[product.price_trend]}`}>
              {product.price_trend === 'up' ? '↑' : product.price_trend === 'down' ? '↓' : '→'}
            </span>
          )}
        </div>
      </a>

      <div className={styles.content}>
        {product.brand && <span className={styles.brand}>{product.brand}</span>}
        <h3 className={styles.name}>
          <a
            href={product.affiliate_url || product.buy_url}
            target="_blank"
            rel="noopener sponsored"
          >
            {product.name}
          </a>
        </h3>

        {product.rating !== undefined && product.rating !== null && (
          <div className={styles.rating}>
            <span className={styles.ratingStars} aria-label={`${product.rating} out of 5 stars`}>
              {'★'.repeat(Math.round(Number(product.rating)))}
              {'☆'.repeat(5 - Math.round(Number(product.rating)))}
            </span>
            {product.review_count !== undefined && product.review_count !== null && (
              <span className={styles.reviewCount}>({product.review_count})</span>
            )}
          </div>
        )}

        <div className={styles.priceRow}>
          <span className={styles.price}>{formattedPrice}</span>
          <span className={`${styles.stockBadge} ${stockClass}`}>{stockLabel}</span>
        </div>

        <div className={styles.meta}>
          <span className={styles.source}>{product.source.replace(/_/g, ' ')}</span>
        </div>

        <a
          href={product.affiliate_url || product.buy_url}
          className={styles.cta}
          target="_blank"
          rel="noopener sponsored"
          aria-label={`Buy ${product.name} from ${product.source}`}
        >
          View Deal
        </a>
      </div>
    </article>
  );
}