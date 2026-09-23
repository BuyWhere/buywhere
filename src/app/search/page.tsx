import type { Metadata } from 'next';
import SearchResultsClient, { type SearchApiItem } from './SearchResultsClient';
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
    deliver_to?: string | string[];
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

// BUY-83802: never SSR-fetch the same-origin BFF (`/api/products/search`).
// That handler lives in this Next.js process; awaiting it from a force-dynamic
// page deadlocks Hikari (0 bytes until the edge timeout) while catalog search
// is already on a 10s degraded path. Product spec: TTFB <3s with a renderable
// shell; client fetch is the source of truth. Optional bounded upstream fetch
// (api.buywhere.ai, 800ms) may restore crawler HTML later — not same-origin.
const SSR_FETCH_BUDGET_MS = 800;

async function fetchInitialResults(
  query: string,
  _country: string
): Promise<{
  items: SearchApiItem[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  degraded: boolean;
  degradedHint: string | null;
} | null> {
  if (query.trim().length < 2) return null;
  // Fast shell: do not wait on catalog during SSR.
  void SSR_FETCH_BUDGET_MS;
  void _country;
  return {
    items: [],
    total: 0,
    hasMore: false,
    nextCursor: null,
    degraded: false,
    degradedHint: null,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  let resolved: Awaited<SearchPageProps['searchParams']> = {};
  try {
    resolved = await searchParams;
  } catch {
    resolved = {};
  }

  const initialQuery = safeString(resolved?.q);
  const initialCountry = safeString(resolved?.country) || safeString(resolved?.deliver_to);

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
