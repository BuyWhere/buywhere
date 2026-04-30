'use client';

import styles from './TrustSignals.module.css';

interface TrustSignalsProps {
  matchScore?: number;
  competitorCount?: number;
  dataFreshness?: string;
  trustScore?: number;
  lastUpdated?: string;
}

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

export default function TrustSignals({
  matchScore,
  competitorCount,
  dataFreshness,
  trustScore,
  lastUpdated,
}: TrustSignalsProps) {
  const freshness = formatFreshness(dataFreshness || lastUpdated);

  return (
    <div className={styles.trustSignals} role="complementary" aria-label="Trust signals">
      <div className={styles.trustItem} title="How confident we are this is the same product">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={styles.icon}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 12 15 22 5" />
        </svg>
        <span className={styles.trustLabel}>Match confidence</span>
        {matchScore !== undefined && (
          <span className={`${styles.trustValue} ${styles.matchScore}`}>
            {Math.round(matchScore * 100)}%
          </span>
        )}
      </div>

      {competitorCount !== undefined && competitorCount > 0 && (
        <div className={styles.trustItem} title="Number of other platforms with this product">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={styles.icon}>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span className={styles.trustLabel}>Also found on</span>
          <span className={styles.trustValue}>{competitorCount} other platforms</span>
        </div>
      )}

      {trustScore !== undefined && (
        <div className={styles.trustItem} title="Overall trust score for this listing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={styles.icon}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span className={styles.trustLabel}>Trust score</span>
          <span className={`${styles.trustValue} ${trustScore >= 90 ? styles.highTrust : trustScore >= 70 ? styles.mediumTrust : styles.lowTrust}`}>
            {trustScore}%
          </span>
        </div>
      )}

      {freshness && (
        <div className={styles.trustItem} title="When we last verified this price">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={styles.icon}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className={styles.trustLabel}>Last verified</span>
          <span className={styles.trustValue}>{freshness}</span>
        </div>
      )}

      <div className={styles.buywhereSeal}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={styles.sealIcon}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>BuyWhere Verified</span>
      </div>
    </div>
  );
}