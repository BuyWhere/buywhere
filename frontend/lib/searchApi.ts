import { ProductListResponse, SortOption } from '@/types/category';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
  sort_by?: SortOption;
  price_min?: number;
  price_max?: number;
  category?: string;
  platform?: string;
  region?: string;
  rating?: number;
}

export async function fetchSearchResults(params: SearchParams): Promise<ProductListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('q', params.q);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.price_min !== undefined) searchParams.set('price_min', String(params.price_min));
  if (params.price_max !== undefined) searchParams.set('price_max', String(params.price_max));
  if (params.category) searchParams.set('category', params.category);
  if (params.platform) searchParams.set('platform', params.platform);
  if (params.region) searchParams.set('region', params.region);
  if (params.rating !== undefined) searchParams.set('rating', String(params.rating));

  const url = `${API_BASE_URL}/products/search?${searchParams.toString()}`;

  const response = await fetch(url, {
    next: { revalidate: 60 },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch search results: ${response.statusText}`);
  }

  return response.json();
}

export function buildSearchUrl(
  q: string,
  filters: Partial<SearchParams>,
  offset: number = 0
): string {
  const params = new URLSearchParams();
  params.set('q', q);
  if (filters.price_min !== undefined) params.set('price_min', String(filters.price_min));
  if (filters.price_max !== undefined) params.set('price_max', String(filters.price_max));
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (filters.category) params.set('category', filters.category);
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.region) params.set('region', filters.region);
  if (filters.rating !== undefined) params.set('rating', String(filters.rating));
  if (offset > 0) params.set('offset', String(offset));
  return `/search?${params.toString()}`;
}

export function getSortLabel(sort: SortOption): string {
  const labels: Record<SortOption, string> = {
    relevance: 'Relevance',
    price_asc: 'Price: Low to High',
    price_desc: 'Price: High to Low',
    newest: 'Newest',
  };
  return labels[sort];
}

export interface SearchState {
  q: string;
  sort_by: SortOption;
  price_min?: number;
  price_max?: number;
  category?: string;
  platform?: string;
  region?: string;
  rating?: number;
}