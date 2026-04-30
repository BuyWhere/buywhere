import Image from 'next/image';
import styles from './HeroBlock.module.css';

interface Product {
  id: string;
  title: string;
  brand: string;
  image_url: string;
}

interface HeroBlockProps {
  product: Product;
  lowestPrice: number;
  lowestPriceFormatted: string;
  lowestPriceRetailer: string;
  retailerCount: number;
}

export default function HeroBlock({
  product,
  lowestPriceFormatted,
  lowestPriceRetailer,
  retailerCount,
}: HeroBlockProps) {
  return (
    <section className={styles.hero} aria-label="Product Overview">
      <div className={styles.imageContainer}>
        <Image
          src={product.image_url}
          alt={product.title}
          width={400}
          height={400}
          className={styles.image}
          priority
        />
        <div className={styles.aiBadge} aria-label="AI Analyzed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          AI Analyzed
        </div>
      </div>

      <div className={styles.content}>
        <span className={styles.brand}>{product.brand}</span>
        <h1 className={styles.title}>{product.title}</h1>

        <div className={styles.lowestPrice}>
          <span className={styles.lowestPriceLabel}>Lowest price:</span>
          <span className={styles.lowestPriceValue}>{lowestPriceFormatted}</span>
          <span className={styles.lowestPriceRetailer}>at {lowestPriceRetailer}</span>
        </div>

        <div className={styles.retailerCount}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          <span>
            <strong>{retailerCount}</strong> retailers compared
          </span>
        </div>
      </div>
    </section>
  );
}