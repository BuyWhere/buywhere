import { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductListResponse, SortOption } from '@/types/category';
import { fetchSearchResults, SearchParams } from '@/lib/searchApi';
import ProductCard from '@/components/ProductCard';
import SearchFilterSidebar from '@/components/SearchFilterSidebar';
import Pagination from '@/components/Pagination';
import styles from './page.module.css';

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    sort_by?: string;
    price_min?: string;
    price_max?: string;
    category?: string;
    platform?: string;
    region?: string;
    rating?: string;
    offset?: string;
    limit?: string;
  }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';
const DEFAULT_LIMIT = 20;

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const sp = await searchParams;
  const query = sp.q || '';

  return {
    title: query ? `"${query}" — Search Results` : 'Search',
    description: query
      ? `Compare prices for "${query}" across US retailers. Find the best deals on BuyWhere.`
      : 'Search for products and compare prices across US retailers.',
    openGraph: {
      title: query ? `"${query}" — BuyWhere` : 'Search — BuyWhere',
      description: query
        ? `Compare prices for "${query}" across US retailers.`
        : 'Search for products and compare prices across US retailers.',
      type: 'website',
      url: `${BASE_URL}/search${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      siteName: 'BuyWhere',
    },
    alternates: {
      canonical: `${BASE_URL}/search`,
      languages: { 'en-US': `${BASE_URL}/search` },
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;

  const q = sp.q || '';
  const sortBy = (sp.sort_by as SortOption) || 'relevance';
  const priceMin = sp.price_min ? parseFloat(sp.price_min) : undefined;
  const priceMax = sp.price_max ? parseFloat(sp.price_max) : undefined;
  const category = sp.category;
  const platform = sp.platform;
  const region = sp.region;
  const rating = sp.rating ? parseFloat(sp.rating) : undefined;
  const offset = sp.offset ? parseInt(sp.offset, 10) : 0;
  const limit = sp.limit ? parseInt(sp.limit, 10) : DEFAULT_LIMIT;

  const currentFilters: SearchParams = {
    q,
    sort_by: sortBy,
    price_min: priceMin,
    price_max: priceMax,
    category,
    platform,
    region,
    rating,
  };

  let data: ProductListResponse;
  if (!q) {
    data = { total: 0, limit, offset, items: [], has_more: false };
  } else {
    try {
      data = await fetchSearchResults({
        q,
        sort_by: sortBy,
        price_min: priceMin,
        price_max: priceMax,
        category,
        platform,
        region,
        rating,
        offset,
        limit,
      });
    } catch {
      data = { total: 0, limit, offset, items: [], has_more: false };
    }
  }

  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>Search Results</h1>
          {q && (
            <p className={styles.queryDisplay}>
              Results for <strong>"{q}"</strong>
            </p>
          )}
          {data.total > 0 && (
            <p className={styles.resultCount}>
              {data.total.toLocaleString()} products — page {currentPage} of {Math.ceil(data.total / limit)}
            </p>
          )}
        </div>
      </header>

      <div className={styles.layout}>
        <Suspense fallback={<div className={styles.sidebarSkeleton} />}>
          <SearchFilterSidebar filters={currentFilters} facets={data.facets} />
        </Suspense>

        <main className={styles.main}>
          {!q ? (
            <div className={styles.emptyState}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <h2>Start your search</h2>
              <p>Enter a product name, brand, or category to find the best prices across US retailers.</p>
            </div>
          ) : data.items.length === 0 ? (
            <div className={styles.emptyState}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <h2>No products found</h2>
              <p>Try adjusting your filters, using different keywords, or checking your spelling.</p>
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
                  searchQ={q}
                />
              </Suspense>
            </>
          )}
        </main>
      </div>
    </div>
  );
}