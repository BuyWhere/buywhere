import styles from './LowCoverageState.module.css';

interface LowCoverageStateProps {
  retailerCount: number;
  productName?: string;
  maxRetailers?: number;
}

const TRUST_INDICATORS = [
  {
    id: 'authentic',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
    label: 'Verified Authentic',
  },
  {
    id: 'secure',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    label: 'Secure Checkout',
  },
  {
    id: 'returns',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    ),
    label: 'Easy Returns',
  },
];

export default function LowCoverageState({
  retailerCount,
  productName = 'this product',
  maxRetailers = 3,
}: LowCoverageStateProps) {
  const coveragePercent = Math.round((retailerCount / maxRetailers) * 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.iconWrapper} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className={styles.headerText}>
          <h2 className={styles.title}>Limited Price Comparison</h2>
          <p className={styles.subtitle}>
            We currently have prices from <strong>{retailerCount} retailer{retailerCount !== 1 ? 's' : ''}</strong> for {productName}.
            Our coverage is {coveragePercent}% of the market.
          </p>
        </div>
      </div>

      <div className={styles.coverageMeter} role="progressbar" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100} aria-label="Market coverage">
        <div className={styles.coverageBar}>
          <div className={styles.coverageFill} style={{ width: `${coveragePercent}%` }} />
        </div>
        <div className={styles.coverageLabels}>
          <span>Low coverage</span>
          <span>{coveragePercent}%</span>
          <span>Full market</span>
        </div>
      </div>

      <div className={styles.trustSection}>
        <h3 className={styles.trustTitle}>Why shop with these retailers?</h3>
        <div className={styles.trustGrid}>
          {TRUST_INDICATORS.map((indicator) => (
            <div key={indicator.id} className={styles.trustItem}>
              <div className={styles.trustIcon}>{indicator.icon}</div>
              <span className={styles.trustLabel}>{indicator.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <p className={styles.actionText}>
          We&apos;re actively expanding our retailer network. Want to suggest a retailer?
        </p>
        <a href="/suggest-retailer" className={styles.suggestButton}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Suggest a Retailer
        </a>
      </div>

      <div className={styles.mobileCards}>
        <div className={styles.mobileCard}>
          <div className={styles.mobileCardBadge}>Only {retailerCount} retailer{retailerCount !== 1 ? 's' : ''} available</div>
          <p className={styles.mobileCardText}>
            Our coverage is limited for this product. We&apos;re working on adding more retailers.
          </p>
        </div>
      </div>
    </div>
  );
}