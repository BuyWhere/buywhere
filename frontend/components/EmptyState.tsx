import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title?: string;
  message?: string;
}

export default function EmptyState({
  title = 'No products found',
  message = 'We couldn\'t find any products matching your criteria. Try adjusting your search or browse our categories.',
}: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.iconWrapper}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.message}>{message}</p>
    </div>
  );
}