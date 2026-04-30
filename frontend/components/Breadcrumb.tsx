import Link from 'next/link';
import styles from './Breadcrumb.module.css';

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
      <ol className={styles.list}>
        <li className={styles.item}>
          <Link href="/" className={styles.link}>
            Home
          </Link>
        </li>
        <li className={styles.separator} aria-hidden="true">
          ›
        </li>
        <li className={styles.item}>
          <Link href="/compare" className={styles.link}>
            Compare
          </Link>
        </li>
        {items.map((item, index) => (
          <li key={item.url} className={styles.itemWrapper}>
            <span className={styles.separator} aria-hidden="true">
              ›
            </span>
            {index === items.length - 1 ? (
              <span className={styles.current} aria-current="page">
                {item.name}
              </span>
            ) : (
              <Link href={item.url} className={styles.link}>
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}