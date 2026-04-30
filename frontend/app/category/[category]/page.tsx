import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ProductListResponse, FilterState, SortOption } from '@/types/category';
import { fetchCategoryProducts } from '@/lib/categoryApi';
import ProductCard from '@/components/ProductCard';
import FilterSidebar from '@/components/FilterSidebar';
import Pagination from '@/components/Pagination';
import styles from './page.module.css';

interface CategoryPageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<{
    sort_by?: string;
    price_min?: string;
    price_max?: string;
    offset?: string;
    limit?: string;
  }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';
const DEFAULT_LIMIT = 20;

const CATEGORY_LABELS: Record<string, string> = {
  electronics: 'Electronics',
  grocery: 'Grocery',
  home: 'Home & Living',
  health: 'Health & Beauty',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  electronics: 'Compare prices on phones, laptops, headphones, and more from top US retailers.',
  grocery: 'Find the best deals on groceries and daily essentials from US supermarkets.',
  home: 'Discover competitive prices on home appliances, furniture, and living essentials.',
  health: 'Compare health supplements, personal care, and wellness products across retailers.',
};

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  const label = CATEGORY_LABELS[category] || category;
  const description = CATEGORY_DESCRIPTIONS[category] || `Compare prices on ${label} products across US retailers.`;

  return {
    title: `${label} Price Comparison`,
    description,
    openGraph: {
      title: `${label} — BuyWhere`,
      description,
      type: 'website',
      url: `${BASE_URL}/category/${category}`,
      siteName: 'BuyWhere',
    },
    alternates: {
      canonical: `${BASE_URL}/category/${category}`,
      languages: { 'en-US': `${BASE_URL}/category/${category}` },
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { category } = await params;
  const sp = await searchParams;

  const sortBy = (sp.sort_by as SortOption) || 'relevance';
  const priceMin = sp.price_min ? parseFloat(sp.price_min) : undefined;
  const priceMax = sp.price_max ? parseFloat(sp.price_max) : undefined;
  const offset = sp.offset ? parseInt(sp.offset, 10) : 0;
  const limit = sp.limit ? parseInt(sp.limit, 10) : DEFAULT_LIMIT;

  const currentFilters: FilterState = {
    category,
    sort_by: sortBy,
    price_min: priceMin,
    price_max: priceMax,
  };

  let data: ProductListResponse;
  try {
    data = await fetchCategoryProducts({
      category,
      sort_by: sortBy,
      price_min: priceMin,
      price_max: priceMax,
      offset,
      limit,
    });
  } catch {
    data = { total: 0, limit, offset, items: [], has_more: false };
  }

  const label = CATEGORY_LABELS[category] || category;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>{label}</h1>
          {data.total > 0 && (
            <p className={styles.resultCount}>
              {data.total.toLocaleString()} products — page {currentPage} of {Math.ceil(data.total / limit)}
            </p>
          )}
        </div>
      </header>

      <div className={styles.layout}>
        <Suspense fallback={<div className={styles.sidebarSkeleton} />}>
          <FilterSidebar
            category={category}
            currentFilters={currentFilters}
            facets={data.facets}
          />
        </Suspense>

        <main className={styles.main}>
          {data.items.length === 0 ? (
            <div className={styles.emptyState}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <h2>No products found</h2>
              <p>Try adjusting your filters or search criteria.</p>
            </div>
          ) : (
            <>
              <div className={styles.productGrid}>
                {data.items.map((product, idx) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    priority={idx < 4}
                  />
                ))}
              </div>

              <Suspense fallback={null}>
                <Pagination
                  total={data.total}
                  limit={limit}
                  offset={offset}
                  category={category}
                />
              </Suspense>
            </>
          )}
        </main>
      </div>
    </div>
  );
}