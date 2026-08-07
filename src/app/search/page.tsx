import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
import Schema from '@/components/Schema';
import { buildPageMetadata } from '@/lib/page-metadata';
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

const SEARCH_TITLE = 'Search Products Across Retailers | BuyWhere';
const SEARCH_DESCRIPTION =
  'Search products across retailers with BuyWhere, compare live prices, and discover where to buy the items you need.';
const SEARCH_PATH = '/search';
const FALLBACK_TITLE = 'Search products — BuyWhere';

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  // BUY-67036: defensive try/catch around every step of metadata resolution.
  // Chrome RSC navigation re-renders this page server-side against
  // state-tree-derived searchParams; opaque Promise/non-string values
  // have hit each helper individually across earlier attempts. The robust
  // mitigation is to ensure no throw path inside generateMetadata can hit
  // the streaming pass.
  let query = '';
  try {
    query = getSearchParam(searchParams?.q).trim();
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

export default function SearchPage({ searchParams }: SearchPageProps) {
  // BUY-67036: same defensive try/catch around searchParam reads in the
  // default export — earlier revisions missed this and the streaming pass
  // could still trip on Promise-resolved values.
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
