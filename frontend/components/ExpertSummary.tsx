import styles from './ExpertSummary.module.css';

interface ExpertSummaryProps {
  summary: string;
}

export default function ExpertSummary({ summary }: ExpertSummaryProps) {
  return (
    <section className={styles.section} aria-label="Expert Summary">
      <div className={styles.label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        Expert Summary
      </div>
      <p className={styles.text}>{summary}</p>
      <span className={styles.byline}>BuyWhere editors</span>
    </section>
  );
}