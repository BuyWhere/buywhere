import type { Metadata } from 'next';
import SearchResultsClient, { type SearchApiItem } from './SearchResultsClient';
import { headers } from 'next/headers';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

// BUY-67036: force-dynamic + revalidate=0 + Promise-based searchParams.
// The Next 14.2.35 runtime trips a parser bug when the route is re-rendered
// server-side against Next-Router-State-Tree-derived searchParams AND the
// route uses the legacy sync `searchParams` shape. Awaiting the params
// Promise (Next 15 style) avoids the legacy code path in the route
// resolver that throws 'The router state header was sent but could not
// be parsed.'.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    country?: string | string[];
  }>;
};

function safeString(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return '';
  } catch {
    return '';
  }
}

const SEARCH_TITLE = 'Search Products Across Retailers | BuyWhere';
const SEARCH_DESCRIPTION =
  'Search products across retailers with BuyWhere, compare live prices, and discover where to buy the items you need.';
const SEARCH_PATH = '/search';
const FALLBACK_TITLE = 'Search products — BuyWhere';

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  let resolved: Awaited<SearchPageProps['searchParams']> = {};
  try {
    resolved = await searchParams;
  } catch {
    resolved = {};
  }

  const query = safeString(resolved?.q).trim();
  const country = safeString(resolved?.country);

  // BUY-69622: Build query-aware title and path for metadata
  const queryTitle = query
    ? `Search results for '${query}' — BuyWhere`
    : SEARCH_TITLE;

  const searchPath = query
    ? `/search?q=${encodeURIComponent(query)}${country ? `&country=${country}` : ''}`
    : country
      ? `/search?country=${country}`
      : SEARCH_PATH;

  let metadata: Metadata;
  try {
    metadata = buildPageMetadata({
      title: queryTitle,
      description: SEARCH_DESCRIPTION,
      path: searchPath,
    });
  } catch {
    metadata = { title: FALLBACK_TITLE };
  }

  let canonical = toSiteUrl(SEARCH_PATH);
  try {
    if (query) {
      canonical = toSiteUrl(`/search?q=${encodeURIComponent(query)}`);
    }
  } catch {
    // keep the safe fallback
  }

  // BUY-69622: Add query-aware og:title, twitter:title, and og:url
  return {
    ...metadata,
    title: query ? `Search results for '${query}' — BuyWhere` : SEARCH_TITLE,
    robots: { index: false, follow: true },
    alternates: {
      canonical,
    },
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

// BUY-66902: server-side fetch of the first results page so product names,
// prices, merchants, and CTAs land in the initial HTML for crawlers/LLMs.
// Runs only when the request already carries a query (a bare /search hit would
// otherwise pay an API round-trip to render nothing). Any failure is swallowed —
// SSR results are strictly a crawler enhancement; the client fetch path remains
// the interactive source of truth.
//
// BUY-80594: limit=10 (NOT 40). The FastAPI's ranked search_products_tier path
// returns the correct top-N laptops at limit=10 but has different (degraded) ranking
// at limit=40 where a stale cache includes Casely/key-ring accessory rows. The
// Next.js route's client-side rankAndClassifyItems() only marks accessories (it
// does not filter them for laptop queries — "laptop case" contains "laptop"). Matching
// the SSR limit to the REST API's working limit=10 ensures both paths show the
// same ranked first page. The client-side fetch handles pagination separately.
const SSR_FETCH_LIMIT = 10;

async function fetchInitialResults(
  query: string,
  country: string
): Promise<{
  items: SearchApiItem[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  degraded: boolean;
  degradedHint: string | null;
} | null> {
  if (query.trim().length < 2) return null;

  let origin = 'https://buywhere.ai';
  try {
    const headerList = headers();
    const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
    const proto = headerList.get('x-forwarded-proto') ?? 'https';
    if (host) origin = `${proto}://${host}`;
  } catch {
    // keep the public default
  }

  const params = new URLSearchParams({
    q: query.trim(),
    country: country.toLowerCase() === 'sg' ? 'SG' : 'US',
    limit: String(SSR_FETCH_LIMIT),
  });

  try {
    const response = await fetch(`${origin}/api/products/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    const items: SearchApiItem[] =
      data.data || data.items || data.results || data.products || [];
    if (!Array.isArray(items)) return null;
    return {
      items: items.slice(0, 20),
      total: typeof data.total === 'number' ? data.total : items.length,
      hasMore: Boolean(data.has_more ?? data.hasMore ?? items.length >= SSR_FETCH_LIMIT),
      nextCursor: data.next_cursor ?? data.nextCursor ?? null,
      degraded: Boolean(data.degraded),
      degradedHint: typeof data.hint === 'string' && data.hint.trim() ? data.hint : null,
    };
  } catch {
    return null;
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  let resolved: Awaited<SearchPageProps['searchParams']> = {};
  try {
    resolved = await searchParams;
  } catch {
    resolved = {};
  }

  const initialQuery = safeString(resolved?.q);
  const initialCountry = safeString(resolved?.country);

  const initialResults = await fetchInitialResults(initialQuery, initialCountry);

  const schema = buildSearchPageSchema({
    path: '/search',
    name: 'Search Products — BuyWhere',
    description:
      'Search and compare products across thousands of stores. AI-powered product discovery with real-time pricing.',
  });

  return (
    <>
      <Schema data={schema} />
      {/* BUY-67036: no <Suspense> wrapper — streaming Suspense in Next
          14.2.35 trips the streaming pass when the page is re-rendered
          server-side against state-tree-derived searchParams (RSC nav),
          returning an opaque 500. The client component handles its own
          loading state internally. */}
      <SearchResultsClient
        initialQuery={initialQuery}
        initialCountry={initialCountry}
        initialItems={initialResults?.items}
        initialTotal={initialResults?.total}
        initialHasMore={initialResults?.hasMore}
        initialNextCursor={initialResults?.nextCursor}
        initialDegraded={initialResults?.degraded}
        initialDegradedHint={initialResults?.degradedHint}
        pathname="/search"
      />
    </>
  );
}
