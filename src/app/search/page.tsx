import type { Metadata } from 'next';
import SearchResultsClient from './SearchResultsClient';

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
    alternates: {
      canonical: query
        ? `https://buywhere.ai/search?q=${encodeURIComponent(query)}`
        : 'https://buywhere.ai/search',
    },
  };
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  const initialQuery = getSearchParam(searchParams?.q);
  const initialCountry = getSearchParam(searchParams?.country);

  return <SearchResultsClient initialQuery={initialQuery} initialCountry={initialCountry} />;
}
