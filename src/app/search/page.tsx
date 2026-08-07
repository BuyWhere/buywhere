import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';
import { loadInitialSearchResults } from './server-search';

type SearchPageProps = {
  searchParams?: {
    q?: string | string[];
    country?: string | string[];
  };
};

function getSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const COUNTRY_CURRENCY: Record<string, string> = {
  us: 'USD',
  sg: 'SGD',
};

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const query = getSearchParam(searchParams?.q).trim();
  const title = query ? `Search results for '${query}' — BuyWhere` : 'Search products — BuyWhere';

  return {
    title,
    robots: { index: false, follow: true },
    alternates: {
      canonical: query
        ? toSiteUrl(`/search?q=${encodeURIComponent(query)}`)
        : toSiteUrl('/search'),
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const initialQuery = getSearchParam(searchParams?.q);
  const initialCountry = getSearchParam(searchParams?.country).toLowerCase() || 'us';
  const fallbackCurrency = COUNTRY_CURRENCY[initialCountry] ?? 'USD';

  const { products, total, degraded, hint } = await loadInitialSearchResults({
    query: initialQuery,
    countryCode: initialCountry,
    fallbackCurrency,
  });

  const schema = buildSearchPageSchema({
    path: '/search',
    name: 'Search Products — BuyWhere',
    description:
      'Search and compare products across thousands of stores. AI-powered product discovery with real-time pricing.',
  });

  return (
    <>
      <Schema data={schema} />
      <Suspense fallback={null}>
        <SearchResultsClient
          initialQuery={initialQuery}
          initialCountry={initialCountry}
          initialProducts={products}
          initialTotal={total}
          initialDegraded={degraded}
          initialHint={hint}
        />
      </Suspense>
    </>
  );
}
