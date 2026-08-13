import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
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

  let metadata: Metadata;
  try {
    metadata = buildPageMetadata({
      title: SEARCH_TITLE,
      description: SEARCH_DESCRIPTION,
      path: SEARCH_PATH,
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

  return {
    ...metadata,
    title: query ? `Search results for '${query}' — BuyWhere` : SEARCH_TITLE,
    robots: { index: false, follow: true },
    alternates: {
      canonical,
    },
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
  const initialCountry = safeString(resolved?.country);

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
      <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />
    </>
  );
}
