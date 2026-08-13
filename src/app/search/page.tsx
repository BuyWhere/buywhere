import { Suspense } from 'react';
import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

// BUY-69260: Chrome RSC navigation sends a populated `__PAGE__` segment in the
// `Next-Router-State-Tree` header (e.g. ["__PAGE__", {"q": "...", "country": "..."}]).
// The legacy sync `searchParams` shape combined with cached build output trips
// a Next 14.2.35 router-state parse error that surfaces as HTTP 500 with
// `page: "/_error"` instead of the route-local `error.tsx` boundary.
//
// Fix: switch to the Promise<searchParams> shape Next 14 prefers (matches
// /categories/[slug]/[country]/page.tsx which doesn't 500), force the page
// dynamic so the second server-side render during RSC nav does not depend on
// cached build output, and harden the param helpers with try/catch so any
// throw path falls back to safe defaults.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SearchPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
    country?: string | string[];
  }>;
};

function getSearchParam(value?: string | string[]) {
  try {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  } catch {
    return '';
  }
}

const SEARCH_TITLE = 'Search Products Across Retailers | BuyWhere';
const SEARCH_DESCRIPTION =
  'Search products across retailers with BuyWhere, compare live prices, and discover where to buy the items you need.';
const SEARCH_PATH = '/search';

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  let query = '';
  try {
    const sp = searchParams ? await searchParams : undefined;
    query = getSearchParam(sp?.q).trim();
  } catch {
    query = '';
  }

  let metadata: Metadata;
  try {
    metadata = buildPageMetadata({
      title: SEARCH_TITLE,
      description: SEARCH_DESCRIPTION,
      path: SEARCH_PATH,
    });
  } catch {
    metadata = {};
  }

  let canonical: string | undefined;
  try {
    canonical = query
      ? toSiteUrl(`/search?q=${encodeURIComponent(query)}`)
      : toSiteUrl(SEARCH_PATH);
  } catch {
    canonical = undefined;
  }

  return {
    ...metadata,
    title: query ? `Search results for '${query}' — BuyWhere` : SEARCH_TITLE,
    robots: { index: false, follow: true },
    alternates: canonical ? { canonical } : undefined,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  let initialQuery = '';
  let initialCountry = '';
  try {
    const sp = searchParams ? await searchParams : undefined;
    initialQuery = getSearchParam(sp?.q);
    initialCountry = getSearchParam(sp?.country);
  } catch {
    initialQuery = '';
    initialCountry = '';
  }

  let schema;
  try {
    schema = buildSearchPageSchema({
      path: '/search',
      name: 'Search Products — BuyWhere',
      description:
        'Search and compare products across thousands of stores. AI-powered product discovery with real-time pricing.',
    });
  } catch {
    schema = null;
  }

  return (
    <>
      {schema ? <Schema data={schema} /> : null}
      <Suspense fallback={null}>
        <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />
      </Suspense>
    </>
  );
}
