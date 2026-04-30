import styles from './MerchantTrustBadge.module.css';

export type TrustBadgeType = 'verified' | 'secure' | 'fast_shipping' | 'top_rated' | 'price_match' | 'official';

interface MerchantTrustBadgeProps {
  type: TrustBadgeType;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const BADGE_CONFIG: Record<TrustBadgeType, { icon: JSX.Element; label: string; className: string }> = {
  verified: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
    label: 'Verified',
    className: 'verified',
  },
  secure: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    label: 'Secure',
    className: 'secure',
  },
  fast_shipping: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    label: 'Fast Shipping',
    className: 'fastShipping',
  },
  top_rated: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    label: 'Top Rated',
    className: 'topRated',
  },
  price_match: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    label: 'Price Match',
    className: 'priceMatch',
  },
  official: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    label: 'Official',
    className: 'official',
  },
};

export default function MerchantTrustBadge({
  type,
  size = 'sm',
  showLabel = false,
}: MerchantTrustBadgeProps) {
  const config = BADGE_CONFIG[type];

  return (
    <span
      className={`${styles.badge} ${styles[config.className]} ${styles[size]}`}
      title={config.label}
    >
      <span className={styles.icon}>{config.icon}</span>
      {showLabel && <span className={styles.label}>{config.label}</span>}
    </span>
  );
}

interface MerchantTrustRowProps {
  badges: TrustBadgeType[];
  size?: 'sm' | 'md';
  maxVisible?: number;
}

export function MerchantTrustRow({ badges, size = 'sm', maxVisible = 3 }: MerchantTrustRowProps) {
  const visibleBadges = badges.slice(0, maxVisible);
  const hiddenCount = badges.length - maxVisible;

  return (
    <span className={styles.row}>
      {visibleBadges.map((type) => (
        <MerchantTrustBadge key={type} type={type} size={size} />
      ))}
      {hiddenCount > 0 && (
        <span className={`${styles.badge} ${styles.moreBadge} ${styles[size]}`}>
          +{hiddenCount}
        </span>
      )}
    </span>
  );
}