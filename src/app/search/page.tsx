import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

// BUY-67036: Chrome RSC navigation requests carry Next-Router-State-Tree
// + __PAGE__ searchParams. Next 14.2.35 re-runs the page server-side
// against state-tree-derived params. The combination of streaming Suspense,
// generateMetadata that reads searchParams, and a data-driven client child
// trips the streaming pass and returns 500. Forcing dynamic rendering on
// every request makes the re-render safe (matches /categories/[slug]/[country]).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
