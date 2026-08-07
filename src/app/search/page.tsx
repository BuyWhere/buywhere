import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
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

function getSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function safeString(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return '';
  } catch {
    return '';
  }
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  let resolved: Awaited<SearchPageProps['searchParams']> = {};
  try {
    resolved = await searchParams;
  } catch {
    resolved = {};
  }

  const query = safeString(resolved?.q).trim();
  const title = query
    ? `Search results for '${query}' — BuyWhere`
    : 'Search products — BuyWhere';

  let canonical = '/search';
  try {
    if (query) {
      canonical = `/search?q=${encodeURIComponent(query)}`;
    }
  } catch {
    canonical = '/search';
  }

  let safeCanonical = toSiteUrl('/search');
  try {
    safeCanonical = toSiteUrl(canonical);
  } catch {
    // keep safeCanonical as the /search fallback
  }

  return {
    title,
    robots: { index: false, follow: true },
    alternates: {
      canonical: safeCanonical,
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
      <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />
    </>
  );
}
