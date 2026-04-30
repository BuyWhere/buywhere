import { ProductSpec } from '@/types/compare';
import styles from './SpecsSection.module.css';

interface SpecsSectionProps {
  specs: ProductSpec[];
}

export default function SpecsSection({ specs }: SpecsSectionProps) {
  if (!specs || specs.length === 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-label="Product Specifications">
      <h2 className={styles.title}>Key Specifications</h2>
      <dl className={styles.grid}>
        {specs.slice(0, 6).map((spec, index) => (
          <div key={index} className={styles.item}>
            <dt className={styles.label}>{spec.label}</dt>
            <dd className={styles.value}>{spec.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}