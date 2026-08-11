import { Suspense, headers } from 'next/headers';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import SearchCard, { type SearchCardProduct } from './SearchCard';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';
import {
  fetchInitialSearchResults,
  buildSearchItemListJsonLd,
} from './server-search';

type SearchPageProps = {
  searchParams?: {
    q?: string | string[];
    country?: string | string[];
  };
};

function getSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const SEARCH_TITLE = 'Search Products Across Retailers | BuyWhere';
const SEARCH_DESCRIPTION =
  'Search products across retailers with BuyWhere, compare live prices, and discover where to buy the items you need.';
const SEARCH_PATH = '/search';

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const query = getSearchParam(searchParams?.q).trim();
  const metadata = buildPageMetadata({
    title: SEARCH_TITLE,
    description: SEARCH_DESCRIPTION,
    path: SEARCH_PATH,
  });

  return {
    ...metadata,
    title: query ? `Search results for '${query}' — BuyWhere` : SEARCH_TITLE,
    robots: { index: false, follow: true },
    alternates: {
      canonical: query
        ? toSiteUrl(`/search?q=${encodeURIComponent(query)}`)
        : toSiteUrl(SEARCH_PATH),
    },
  };
}

function getOrigin(): string {
  try {
    const headerList = headers();
    const forwardedHost = headerList.get('x-forwarded-host');
    const host = forwardedHost ?? headerList.get('host') ?? 'buywhere.ai';
    const forwardedProto = headerList.get('x-forwarded-proto');
    const proto = forwardedProto ?? 'https';
    return `${proto}://${host}`;
  } catch {
    return 'https://buywhere.ai';
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const initialQuery = getSearchParam(searchParams?.q);
  const initialCountry = getSearchParam(searchParams?.country) || 'us';

  const schema = buildSearchPageSchema({
    path: '/search',
    name: 'Search Products — BuyWhere',
    description:
      'Search and compare products across thousands of stores. AI-powered product discovery with real-time pricing.',
  });

  // BUY-67120: server-render the first page of product cards so crawlers and
  // LLM answer engines can read product name, merchant, price, brand, category,
  // and CTA copy on first paint — no JS bundle required. The client component
  // below hydrates with the same data and stays interactive (filter, refetch,
  // pagination, search history, etc.).
  const trimmedQuery = initialQuery.trim();
  let initialProducts: SearchCardProduct[] = [];
  let initialTotal = 0;
  let initialHasMore = false;
  let itemListJsonLd: object | null = null;

  if (trimmedQuery.length >= 2) {
    try {
      const headerList = headers();
      const origin = getOrigin();
      const result = await fetchInitialSearchResults({
        query: trimmedQuery,
        country: initialCountry,
        headers: headerList,
      });
      initialProducts = result.products;
      initialTotal = result.total;
      initialHasMore = result.hasMore;
      itemListJsonLd = buildSearchItemListJsonLd({
        query: trimmedQuery,
        country: initialCountry,
        origin,
        products: result.products,
      });
    } catch {
      // Swallow — the client component will fetch on hydration.
    }
  }

  const hasServerResults = initialProducts.length > 0;

  return (
    <>
      <Schema data={schema} />
      {itemListJsonLd ? <Schema data={itemListJsonLd} /> : null}

      {/*
        SSR-only first-paint grid. Mirrors the grid layout in SearchResultsClient
        so React reconciles without DOM mismatches. The client hydrates this same
        set of products and owns interactivity (filtering, search history, etc.).
      */}
      {hasServerResults ? (
        <section
          data-testid="search-ssr-results"
          aria-label={`${initialTotal} results for ${trimmedQuery}`}
          className="mx-auto w-full max-w-7xl px-4 pb-4 sm:px-6 sm:pb-8 lg:px-8 lg:pb-10"
        >
          <div className="space-y-6">
            <div className="hidden md:block">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                {initialCountry.toLowerCase() === 'sg' ? 'Singapore' : 'United States'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                {initialTotal.toLocaleString()} results for &ldquo;{trimmedQuery}&rdquo;
              </h1>
            </div>
            <div
              className="grid gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', maxWidth: '1200px' }}
            >
              {initialProducts.map((product) => (
                <SearchCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <Suspense fallback={null}>
        <SearchResultsClient
          initialQuery={initialQuery}
          initialCountry={initialCountry}
          initialProducts={initialProducts}
          initialTotal={initialTotal}
          initialHasMore={initialHasMore}
        />
      </Suspense>
    </>
  );
}