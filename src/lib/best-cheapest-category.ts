import type { LandingProduct } from './seo-landing-pages';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai';

type SearchApiItem = {
  id: number | string;
  name?: string | null;
  title?: string | null;
  price?: number | string | null;
  currency?: string | null;
  source?: string | null;
  merchant?: string | null;
  image_url?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  brand?: string | null;
  category?: string | null;
};

type SearchApiResponse = {
  items?: SearchApiItem[];
  results?: SearchApiItem[];
  _sort?: string;
  _mode?: string;
};

function normalizeProduct(
  item: SearchApiItem,
  currency: string
): LandingProduct {
  const price =
    item.price != null
      ? typeof item.price === 'string'
        ? parseFloat(item.price)
        : item.price
      : null;
  return {
    id: String(item.id),
    name: item.name || item.title || '',
    price,
    currency: item.currency || currency,
    merchant: item.merchant || item.source || 'Unknown',
    imageUrl: item.image_url || null,
    href: item.buy_url || item.url || item.affiliate_url || '#',
    brand: item.brand || null,
    category: item.category || null,
  };
}

export type SortMode = 'best' | 'cheapest';

export type RouteProduct = LandingProduct & {
  // Additional fields specific to best/cheapest routes
};

function sortProducts(products: LandingProduct[], mode: SortMode): LandingProduct[] {
  if (mode === 'cheapest') {
    return [...products].sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return a.price - b.price;
    });
  }
  // 'best' — return as-is (editorial/relevance order from API)
  return products;
}

export async function fetchProductsForSlug(
  slug: string,
  country: 'US' | 'SG',
  mode: SortMode,
  limit = 20
): Promise<{ products: LandingProduct[]; query: string }> {
  const currency = country === 'US' ? 'USD' : 'SGD';
  // Strip country suffix from slug if present (e.g. "laptop-singapore" → "laptop")
  const query = slug.replace(/-singapore$|-us$/i, '');

  try {
    const params = new URLSearchParams({
      q: query,
      country,
      limit: String(limit),
    });

    const response = await fetch(`${API_BASE_URL}/v1/products/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 * 15 }, // ISR: 15-minute cache
    });

    if (!response.ok) {
      console.error(`[best-cheapest] search failed: ${response.status}`);
      return { products: [], query };
    }

    const data = (await response.json()) as SearchApiResponse;
    const items = data.items || data.results || [];

    const normalized = items.map((item) => normalizeProduct(item, currency));
    const sorted = sortProducts(normalized, mode);

    return { products: sorted.slice(0, limit), query };
  } catch (err) {
    console.error(`[best-cheapest] fetch error:`, err);
    return { products: [], query };
  }
}

export async function fetchCategoryProducts(
  slug: string,
  limit = 20
): Promise<{ products: LandingProduct[]; categoryName: string }> {
  const currency = 'SGD';

  try {
    // Try to fetch by category query
    const params = new URLSearchParams({
      q: slug,
      limit: String(limit),
    });

    const response = await fetch(`${API_BASE_URL}/v1/products/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 * 15 },
    });

    if (!response.ok) {
      return { products: [], categoryName: formatCategoryName(slug) };
    }

    const data = (await response.json()) as SearchApiResponse;
    const items = data.items || data.results || [];
    const normalized = items.map((item) => normalizeProduct(item, currency));

    return {
      products: normalized.slice(0, limit),
      categoryName: formatCategoryName(slug),
    };
  } catch (err) {
    console.error(`[category] fetch error:`, err);
    return { products: [], categoryName: formatCategoryName(slug) };
  }
}

function formatCategoryName(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
