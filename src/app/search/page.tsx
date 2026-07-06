import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
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
