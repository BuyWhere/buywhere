import Link from 'next/link';
import Image from 'next/image';
import { RelatedComparison } from '@/types/compare';
import styles from './RelatedComparisons.module.css';

interface RelatedComparisonsProps {
  comparisons: RelatedComparison[];
}

export default function RelatedComparisons({ comparisons }: RelatedComparisonsProps) {
  if (!comparisons || comparisons.length === 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-label="Related Comparisons">
      <h2 className={styles.title}>Related Comparisons</h2>
      <div className={styles.grid}>
        {comparisons.slice(0, 4).map((comp) => (
          <Link key={comp.slug} href={`/compare/${comp.slug}`} className={styles.card}>
            <div className={styles.imageWrapper}>
              <Image
                src={comp.image_url}
                alt={comp.title}
                width={120}
                height={120}
                className={styles.image}
              />
            </div>
            <div className={styles.content}>
              <span className={styles.brand}>{comp.brand}</span>
              <h3 className={styles.cardTitle}>{comp.title}</h3>
              <div className={styles.meta}>
                <span className={styles.price}>{comp.lowest_price_formatted}</span>
                <span className={styles.retailerCount}>
                  {comp.retailer_count} retailers
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}