export interface PriceHistoryEntry {
  price: number;
  currency: string;
  platform: string;
  scraped_at: string;
}

export interface PriceHistoryAggregationEntry {
  date: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  price_count: number;
  currency: string;
  platform?: string;
}

export interface PriceHistoryResponse {
  product_id: number;
  entries: PriceHistoryEntry[];
  aggregated_entries: PriceHistoryAggregationEntry[];
  total: number;
  aggregate?: string;
  period?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export interface PriceHistoryParams {
  period?: '7d' | '30d' | '90d' | '1y';
  days?: number;
  platform?: string;
  aggregate?: 'daily';
}

export async function fetchPriceHistory(
  productId: number,
  params: PriceHistoryParams = {}
): Promise<PriceHistoryResponse> {
  const searchParams = new URLSearchParams();
  if (params.period) searchParams.set('period', params.period);
  if (params.days) searchParams.set('days', String(params.days));
  if (params.platform) searchParams.set('platform', params.platform);
  if (params.aggregate) searchParams.set('aggregate', params.aggregate);

  const url = `${API_BASE_URL}/products/${productId}/price-history?${searchParams.toString()}`;

  const response = await fetch(url, {
    next: { revalidate: 300 },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch price history: ${response.statusText}`);
  }

  return response.json();
}