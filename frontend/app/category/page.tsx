import { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

interface CategoryPageProps {
  params: Promise<{}>;
  searchParams: Promise<{
    region?: string;
  }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'BuyWhere — Price Comparison Across US Retailers',
    description: 'Compare prices on products from top US retailers including electronics, groceries, home & living, and health & beauty.',
    openGraph: {
      title: 'BuyWhere — Price Comparison',
      description: 'Compare prices on products from top US retailers',
      type: 'website',
      url: `${BASE_URL}/category`,
      siteName: 'BuyWhere',
    },
    alternates: {
      canonical: `${BASE_URL}/category`,
      languages: { 'en-US': `${BASE_URL}/category` },
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const sp = await searchParams;
  const region = sp.region || 'SG';

  let hasError = false;
  let data: Array<{id: string; slug: string; name: string; icon?: string; product_count: number; description?: string}> = [];
  try {
    const res = await fetch(`/api/v1/categories?region=${region}`, {
      next: { revalidate: 300 },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      data = json.items || json.categories || [];
    } else {
      hasError = true;
    }
  } catch {
    hasError = true;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>Shop by Category</h1>
          <p className={styles.description}>
            Browse products across all categories from US retailers
          </p>
        </div>
      </header>

      {hasError ? (
        <div className={styles.error}>
          <p>Failed to load categories. Please try again later.</p>
        </div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>
          <p>No categories available.</p>
        </div>
      ) : (
        <>
          <div className={styles.categoryGrid}>
            {data.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className={styles.categoryCard}
              >
                <div className={styles.categoryIcon}>
                  {/* Category icon would go here */}
                  <span>{category.icon || '📦'}</span>
                </div>
                <div className={styles.categoryInfo}>
                  <h3 className={styles.categoryName}>{category.name}</h3>
                  <p className={styles.categoryCount}>
                    {category.product_count.toLocaleString()} products
                  </p>
                  <p className={styles.categoryDescription}>{category.description}</p>
                </div>
              </Link>
            ))}
          </div>

          {data.length > 0 && (
            <div className={styles.regionFilter}>
              <p>
                <strong>Region:</strong>{' '}
                {['SG', 'US', 'SEA', 'GLOBAL'].map((r) => (
                  <span key={r}>
                    {r === region ? (
                      <span>{r}</span>
                    ) : (
                      <Link href={`/category?region=${r}`}>{r}</Link>
                    )}
                    {' '}
                  </span>
                ))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}