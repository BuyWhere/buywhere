import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

// BUY-66904: Force dynamic rendering. Next.js 14.2.35 returns 500 Internal Server
// Error when a page that uses both `generateMetadata` and `searchParams` is
// re-rendered during an RSC navigation with `Next-Router-State-Tree` carrying
// search-param values (the reconciler re-invokes the server function with the
// state-tree-derived searchParams, and the static-metadata + Suspense-streamed
// client component combo fails the streaming pass). Forcing dynamic rendering
// keeps the page server-render path identical between the initial HTML render
// and any subsequent RSC re-render.
export const dynamic = 'force-dynamic';

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
  // BUY-66904: Defensive read of searchParams — if any unexpected shape arrives
  // during an RSC re-render, fall back to empty defaults rather than letting an
  // exception bubble up to a 500. The Schema block is fully static so it never
  // depends on searchParams, which keeps the RSC stream stable across re-renders.
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
