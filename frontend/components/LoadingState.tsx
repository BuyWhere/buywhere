import styles from './LoadingState.module.css';

interface LoadingStateProps {
  variant?: 'page' | 'table' | 'hero';
}

export default function LoadingState({ variant = 'page' }: LoadingStateProps) {
  if (variant === 'table') {
    return (
      <div className={styles.tableLoading} role="status" aria-label="Loading price comparison">
        <div className={styles.tableHeader}>
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.tableRow}>
            <div className={styles.retailerCell}>
              <div className={`${styles.skeleton} ${styles.skeletonLogo}`} />
              <div className={`${styles.skeleton} ${styles.skeletonName}`} />
            </div>
            <div className={`${styles.skeleton} ${styles.skeletonBadge}`} />
            <div className={`${styles.skeleton} ${styles.skeletonBadge}`} />
            <div className={`${styles.skeleton} ${styles.skeletonPrice}`} />
            <div className={`${styles.skeleton} ${styles.skeletonCta}`} />
          </div>
        ))}
        <span className={styles.srOnly}>Loading...</span>
      </div>
    );
  }

  if (variant === 'hero') {
    return (
      <div className={styles.heroLoading} role="status" aria-label="Loading product details">
        <div className={styles.heroImage}>
          <div className={`${styles.skeleton} ${styles.skeletonImage}`} />
        </div>
        <div className={styles.heroContent}>
          <div className={`${styles.skeleton} ${styles.skeletonBrand}`} />
          <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeleton} ${styles.skeletonPrice}`} />
          <div className={`${styles.skeleton} ${styles.skeletonMeta}`} />
        </div>
        <span className={styles.srOnly}>Loading...</span>
      </div>
    );
  }

  return (
    <div className={styles.pageLoading} role="status" aria-label="Loading comparison page">
      <div className={styles.breadcrumb}>
        <div className={`${styles.skeleton} ${styles.skeletonBreadcrumb}`} />
      </div>
      <div className={styles.heroSection}>
        <div className={styles.heroImage}>
          <div className={`${styles.skeleton} ${styles.skeletonImage}`} />
        </div>
        <div className={styles.heroContent}>
          <div className={`${styles.skeleton} ${styles.skeletonBrand}`} />
          <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeleton} ${styles.skeletonPrice}`} />
          <div className={`${styles.skeleton} ${styles.skeletonMeta}`} />
        </div>
      </div>
      <div className={styles.tableSection}>
        <div className={`${styles.skeleton} ${styles.skeletonSectionHeader}`} />
        <div className={styles.tableHeader}>
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.tableRow}>
            <div className={styles.retailerCell}>
              <div className={`${styles.skeleton} ${styles.skeletonLogo}`} />
              <div className={`${styles.skeleton} ${styles.skeletonName}`} />
            </div>
            <div className={`${styles.skeleton} ${styles.skeletonBadge}`} />
            <div className={`${styles.skeleton} ${styles.skeletonBadge}`} />
            <div className={`${styles.skeleton} ${styles.skeletonPrice}`} />
            <div className={`${styles.skeleton} ${styles.skeletonCta}`} />
          </div>
        ))}
      </div>
      <span className={styles.srOnly}>Loading comparison data...</span>
    </div>
  );
}