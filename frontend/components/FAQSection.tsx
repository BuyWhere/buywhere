import { FAQItem } from '@/types/compare';
import styles from './FAQSection.module.css';

interface FAQSectionProps {
  faq: FAQItem[];
}

export default function FAQSection({ faq }: FAQSectionProps) {
  if (!faq || faq.length === 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-label="Frequently Asked Questions">
      <h2 className={styles.title}>Frequently Asked Questions</h2>
      <dl className={styles.list}>
        {faq.map((item, index) => (
          <div key={index} className={styles.item}>
            <dt className={styles.question}>{item.question}</dt>
            <dd className={styles.answer}>{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}