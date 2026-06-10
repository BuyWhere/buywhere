import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';
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

  return <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />;
}
