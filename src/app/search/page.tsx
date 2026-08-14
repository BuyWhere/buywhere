import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

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
  const country = getSearchParam(searchParams?.country);

  const queryTitle = query
    ? `Search results for '${query}' — BuyWhere`
    : SEARCH_TITLE;

  const searchPath = query
    ? `/search?q=${encodeURIComponent(query)}${country ? `&country=${country}` : ''}`
    : country
      ? `/search?country=${country}`
      : SEARCH_PATH;

  const metadata = buildPageMetadata({
    title: queryTitle,
    description: SEARCH_DESCRIPTION,
    path: searchPath,
  });

  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      title: queryTitle,
      url: toSiteUrl(searchPath),
    },
    twitter: {
      ...metadata.twitter,
      title: queryTitle,
    },
  };
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  const initialQuery = getSearchParam(searchParams?.q);
  const initialCountry = getSearchParam(searchParams?.country);

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
        <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />
      </Suspense>
    </>
  );
}
