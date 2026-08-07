import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildSearchPageSchema } from '@/lib/page-schema';
import { toSiteUrl } from '@/lib/site-url';

// BUY-67036: force-dynamic + revalidate=0 so the server-side re-render
// during Chrome RSC navigation (Next-Router-State-Tree + __PAGE__ params)
// does not depend on cached build output. Matches /categories/[slug]/[country]
// which does not exhibit the 500.
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

// BUY-67036: restore generateMetadata with extra defensive wrapping. Earlier
// attempts (static metadata, remove Suspense, try/catch inside metadata)
// did not fix the RSC-nav 500. The root cause is opaque; the most robust
// mitigation is to ensure no throw path inside generateMetadata can hit
// the streaming-pass. We compute the title/canonical inside try/catch and
// fall back to safe defaults on any error.
export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const fallbackTitle = 'Search products — BuyWhere';
  let query = '';
  let canonical = '/search';

  try {
    query = getSearchParam(searchParams?.q).trim();
  } catch {
    query = '';
  }

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
    title: query ? `Search results for '${query}' — BuyWhere` : fallbackTitle,
    robots: { index: false, follow: true },
    alternates: {
      canonical: safeCanonical,
    },
  };
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  let initialQuery = '';
  let initialCountry = '';
  try {
    initialQuery = getSearchParam(searchParams?.q);
  } catch {
    initialQuery = '';
  }
  try {
    initialCountry = getSearchParam(searchParams?.country);
  } catch {
    initialCountry = '';
  }

  const schema = buildSearchPageSchema({
    path: '/search',
    name: 'Search Products — BuyWhere',
    description:
      'Search and compare products across thousands of stores. AI-powered product discovery with real-time pricing.',
  });

  return (
    <>
      <Schema data={schema} />
      {/* BUY-67036: removed <Suspense> wrapper. Streaming Suspense in Next
          14.2.35 trips the streaming pass when the page is re-rendered
          server-side against state-tree-derived searchParams (RSC nav),
          returning an opaque 500. The client component handles its own
          loading state internally — no Suspense fallback needed. */}
      <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />
    </>
  );
}
