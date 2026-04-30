import { ProductListResponse, FilterState, SortOption } from '@/types/category';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export interface CategoryProductsParams {
  category: string;
  limit?: number;
  offset?: number;
  sort_by?: SortOption;
  price_min?: number;
  price_max?: number;
}

export async function fetchCategoryProducts(
  params: CategoryProductsParams
): Promise<ProductListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('category', params.category);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.price_min !== undefined) searchParams.set('price_min', String(params.price_min));
  if (params.price_max !== undefined) searchParams.set('price_max', String(params.price_max));

  const url = `${API_BASE_URL}/products?${searchParams.toString()}`;

  const response = await fetch(url, {
    next: { revalidate: 300 },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch category products: ${response.statusText}`);
  }

  return response.json();
}

export function buildCategoryUrl(category: string, filters: FilterState, offset: number = 0): string {
  const params = new URLSearchParams();
  params.set('category', category);
  if (filters.price_min !== undefined) params.set('price_min', String(filters.price_min));
  if (filters.price_max !== undefined) params.set('price_max', String(filters.price_max));
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (offset > 0) params.set('offset', String(offset));
  return `/category/${category}?${params.toString()}`;
}

export function formatPrice(price: number, currency: string = 'SGD'): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price);
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