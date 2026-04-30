import Image from 'next/image';
import { RetailerPrice, AvailabilityStatus } from '@/types/compare';
import styles from './ProductCardCompare.module.css';

interface ProductInfo {
  image_url: string;
  title: string;
  specs?: Array<{ label: string; value: string }>;
}

interface ProductCardProps {
  product: ProductInfo;
  retailer: RetailerPrice;
  isLowestPrice?: boolean;
  isBestRated?: boolean;
  isFastestShipping?: boolean;
  priority?: boolean;
  matchScore?: number;
  dataFreshness?: string;
}

const AVAILABILITY_CONFIG: Record<AvailabilityStatus, { label: string; className: string }> = {
  in_stock: { label: 'In stock', className: 'inStock' },
  low_stock: { label: 'Low stock', className: 'lowStock' },
  out_of_stock: { label: 'Out of stock', className: 'outOfStock' },
  refresh_pending: { label: 'Refresh pending', className: 'refreshPending' },
};

function formatFreshness(dateStr?: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

function getBadgeType(
  isLowestPrice?: boolean,
  isBestRated?: boolean,
  isFastestShipping?: boolean
): { label: string; className: string; icon: 'trophy' | 'star' | 'lightning' } | null {
  if (isLowestPrice) return { label: 'CHEAPEST', className: 'cheapest', icon: 'trophy' };
  if (isBestRated) return { label: 'BEST RATED', className: 'bestRated', icon: 'star' };
  if (isFastestShipping) return { label: 'FASTEST SHIP', className: 'fastest', icon: 'lightning' };
  return null;
}

export default function ProductCard({
  product,
  retailer,
  isLowestPrice = false,
  isBestRated = false,
  isFastestShipping = false,
  priority = false,
  matchScore,
  dataFreshness,
}: ProductCardProps) {
  const availabilityConfig = AVAILABILITY_CONFIG[retailer.availability];
  const badgeType = getBadgeType(isLowestPrice, isBestRated, isFastestShipping);
  const freshness = formatFreshness(dataFreshness);

  return (
    <article className={`${styles.card} ${isLowestPrice ? styles.bestPrice : ''}`}>
      {badgeType && (
        <div className={`${styles.rankingBadge} ${styles[badgeType.className]}`}>
          {badgeType.icon === 'trophy' && (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          )}
          {badgeType.icon === 'star' && (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
          {badgeType.icon === 'lightning' && (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}
          {badgeType.label}
        </div>
      )}

      <div className={styles.imageWrapper}>
        <Image
          src={product.image_url}
          alt={product.title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className={styles.image}
          priority={priority}
        />
      </div>

      <div className={styles.content}>
        <div className={styles.retailerRow}>
          <Image
            src={retailer.retailer_logo_url}
            alt={retailer.retailer_name}
            width={60}
            height={24}
            className={styles.retailerLogo}
          />
          <span className={`${styles.availabilityBadge} ${styles[availabilityConfig.className]}`}>
            {availabilityConfig.label}
          </span>
        </div>

        <h3 className={styles.title}>{product.title}</h3>

        {product.specs && product.specs.length > 0 && (
          <ul className={styles.specList}>
            {product.specs.slice(0, 3).map((spec, idx) => (
              <li key={idx} className={styles.specItem}>
                <span className={styles.specLabel}>{spec.label}:</span>
                <span className={styles.specValue}>{spec.value}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.priceBlock}>
          <span className={styles.price}>{retailer.price_formatted}</span>
          {retailer.original_price && retailer.original_price > retailer.price && (
            <span className={styles.originalPrice}>{retailer.original_price_formatted}</span>
          )}
        </div>

        <div className={styles.metaRow}>
          {retailer.shipping_note && (
            <span className={styles.shippingNote}>{retailer.shipping_note}</span>
          )}
        </div>

        <div className={styles.trustRow}>
          {matchScore !== undefined && (
            <span className={styles.trustScore} title="Match confidence">
              {Math.round(matchScore * 100)}% match
            </span>
          )}
          {freshness && (
            <span className={styles.freshness}>Updated {freshness}</span>
          )}
        </div>

        <a
          href={retailer.affiliate_url || retailer.url}
          className={`${styles.cta} ${isLowestPrice ? styles.ctaPrimary : ''}`}
          target="_blank"
          rel="noopener sponsored"
          aria-label={`Buy ${product.title} from ${retailer.retailer_name}`}
        >
          {isLowestPrice ? 'Get Best Price' : 'View Deal'}
        </a>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <article className={styles.card} aria-hidden="true">
      <div className={`${styles.imageWrapper} ${styles.skeletonImage}`} />
      <div className={styles.content}>
        <div className={styles.skeletonRow}>
          <div className={`${styles.skeletonLogo} ${styles.skeleton}`} />
          <div className={`${styles.skeletonBadge} ${styles.skeleton}`} />
        </div>
        <div className={`${styles.skeletonTitle} ${styles.skeleton}`} />
        <div className={`${styles.skeletonTitleShort} ${styles.skeleton}`} />
        <div className={`${styles.skeletonPrice} ${styles.skeleton}`} />
        <div className={`${styles.skeletonCta} ${styles.skeleton}`} />
      </div>
    </article>
  );
}