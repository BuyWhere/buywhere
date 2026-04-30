import styles from './OutOfStockState.module.css';

interface OutOfStockStateProps {
  productName?: string;
  retailerCount?: number;
  onNotifyMe?: () => void;
}

export default function OutOfStockState({
  productName = 'this product',
  retailerCount = 0,
  onNotifyMe,
}: OutOfStockStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.iconWrapper} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>

      <h2 className={styles.title}>Out of Stock Everywhere</h2>
      <p className={styles.message}>
        All {retailerCount} retailer{retailerCount !== 1 ? 's' : ''} we track have this product currently out of stock.
        We&apos;ll keep monitoring and alert you when it&apos;s back.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.notifyButton} onClick={onNotifyMe}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Notify Me When Available
        </button>
        <a href="/" className={styles.browseLink}>
          Browse Similar Products
        </a>
      </div>

      <div className={styles.alternatives}>
        <h3 className={styles.alternativesTitle}>While you wait</h3>
        <div className={styles.alternativesGrid}>
          <div className={styles.alternativeCard}>
            <div className={styles.alternativeIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <span className={styles.alternativeLabel}>Price drop alerts</span>
          </div>
          <div className={styles.alternativeCard}>
            <div className={styles.alternativeIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <span className={styles.alternativeLabel}>Search alternatives</span>
          </div>
          <div className={styles.alternativeCard}>
            <div className={styles.alternativeIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
            <span className={styles.alternativeLabel}>Check other retailers</span>
          </div>
        </div>
      </div>

      <div className={styles.mobileCard}>
        <div className={styles.mobileIconWrapper}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3 className={styles.mobileTitle}>Out of Stock</h3>
        <p className={styles.mobileMessage}>
          All retailers have this product out of stock. We&apos;ll notify you when it&apos;s back.
        </p>
        <button type="button" className={styles.mobileNotifyButton} onClick={onNotifyMe}>
          Get Notified
        </button>
      </div>
    </div>
  );
}