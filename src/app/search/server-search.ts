// Server-side helpers for /search SSR.
// BUY-67120: lets the page server component fetch and normalize the first page
// of search results so they ship in initial HTML (instead of arriving after the
// client-side `useEffect(fetchResults)` round-trip). Keeps the existing client
// rendering behavior for hydration, refilter, and pagination — only the FIRST
// paint is changed.

import { toSiteUrl } from '@/lib/site-url';

export type ServerSearchApiItem = {
  id?: number | string;
  name?: string | null;
  title?: string | null;
  price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  price_amount?: number | string | null;
  price_currency?: string | null;
  currency?: string | null;
  click_url?: string | null;
  source?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  image_url?: string | null;
  image?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  affiliate_redirect_url?: string | null;
  brand?: string | null;
  category?: string | null;
  structured_specs?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ServerSearchCardProduct = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  merchant: string;
  imageUrl: string | null;
  href: string;
  brand: string | null;
  category: string | null;
};

export type ServerSearchResults = {
  products: ServerSearchCardProduct[];
  total: number;
  hasMore: boolean;
  degraded: boolean;
};

const MIN_QUERY_LENGTH = 2;
const PAGE_SIZE = 20;
const SERVER_FETCH_LIMIT = 40;

function countryToApiValue(country: string) {
  return country.toLowerCase() === 'sg' ? 'SG' : 'US';
}

function fallbackCurrencyFor(country: string) {
  return country.toLowerCase() === 'sg' ? 'SGD' : 'USD';
}

function hasUsableProductImage(value?: string | null) {
  if (!value) return false;
  try {
    const imageUrl = new URL(value);
    const hostname = imageUrl.hostname.toLowerCase();
    const pathname = imageUrl.pathname.toLowerCase();
    const search = imageUrl.search.toLowerCase();
    const fullUrl = `${hostname}${pathname}${search}`;
    if (hostname.includes('unsplash.com') || fullUrl.includes('unsplash.com')) return false;
    if (fullUrl.includes('placeholder')) return false;
    if (fullUrl.includes('image-unavailable')) return false;
    if (fullUrl.includes('no-image')) return false;
    if (fullUrl.includes('no_image')) return false;
    if (fullUrl.includes('missing-image')) return false;
    if (fullUrl.includes('generic')) return false;
    return true;
  } catch {
    return false;
  }
}

function formatMerchantName(value?: string | null) {
  if (!value) return 'BuyWhere seller';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeServerProduct(item: ServerSearchApiItem, fallbackCurrency: string): ServerSearchCardProduct {
  const priceValue =
    item.price && typeof item.price === 'object' && 'amount' in item.price
      ? item.price.amount
      : item.price_amount ?? item.price;
  const priceCurrency =
    item.price && typeof item.price === 'object' && 'currency' in item.price
      ? item.price.currency
      : item.price_currency ?? item.currency;
  const numericPrice =
    typeof priceValue === 'number'
      ? priceValue
      : typeof priceValue === 'string' && priceValue.trim()
        ? Number(priceValue)
        : null;
  const specs = item.structured_specs || item.metadata || null;
  const specBrand = typeof specs?.brand === 'string' ? specs.brand : null;
  const specCategory = typeof specs?.category === 'string' ? specs.category : null;
  const imageUrl = hasUsableProductImage(item.image_url)
    ? item.image_url || null
    : hasUsableProductImage(item.image)
      ? item.image || null
      : null;

  return {
    id: String(item.id ?? ''),
    name: item.name || item.title || 'Untitled product',
    price: Number.isFinite(numericPrice) ? (numericPrice as number) : null,
    currency: priceCurrency || fallbackCurrency,
    merchant: formatMerchantName(item.merchant_name || item.merchant || item.source),
    imageUrl,
    href: item.affiliate_redirect_url || item.click_url || item.affiliate_url || item.buy_url || item.url || '#',
    brand: item.brand || specBrand,
    category: item.category || specCategory,
  };
}

function getOriginFromHeaders(headers: Headers): string {
  const forwardedHost = headers.get('x-forwarded-host');
  const host = forwardedHost ?? headers.get('host') ?? 'buywhere.ai';
  const forwardedProto = headers.get('x-forwarded-proto');
  const proto = forwardedProto ?? 'https';
  return `${proto}://${host}`;
}

async function fetchFromApi(params: URLSearchParams): Promise<ServerSearchResults> {
  const apiBase = (
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    'https://api.buywhere.ai'
  ).replace(/\/$/, '');
  const apiKey = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';

  if (!apiKey) {
    return { products: [], total: 0, hasMore: false, degraded: false };
  }

  try {
    const upstream = new URLSearchParams();
    params.forEach((value, key) => upstream.set(key, value));
    const country = upstream.get('country');
    if (country) {
      if (!upstream.has('country_code')) upstream.set('country_code', country);
      upstream.delete('country');
    }
    const response = await fetch(`${apiBase}/v1/products/search?${upstream.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      // Allow Next.js to dedupe identical concurrent requests for the same query.
      next: { revalidate: 60, tags: ['search'] },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      return { products: [], total: 0, hasMore: false, degraded: false };
    }
    const rawItems: ServerSearchApiItem[] =
      (Array.isArray(data.data) && data.data) ||
      (Array.isArray(data.items) && data.items) ||
      (Array.isArray(data.results) && data.results) ||
      (Array.isArray(data.products) && data.products) ||
      [];
    const fallbackCurrency = fallbackCurrencyFor(params.get('country') ?? 'us');
    const normalized = rawItems
      .map((item) => normalizeServerProduct(item, fallbackCurrency))
      .slice(0, PAGE_SIZE);
    const total = typeof data.total === 'number' ? data.total : normalized.length;
    const hasMore = Boolean(data.has_more ?? data.hasMore ?? rawItems.length >= SERVER_FETCH_LIMIT);
    const degraded = Boolean(data.degraded ?? data.meta?.degraded);
    return { products: normalized, total, hasMore, degraded };
  } catch {
    return { products: [], total: 0, hasMore: false, degraded: false };
  }
}

export async function fetchInitialSearchResults({
  query,
  country,
  headers,
}: {
  query: string;
  country: string;
  headers?: Headers;
}): Promise<ServerSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { products: [], total: 0, hasMore: false, degraded: false };
  }

  const params = new URLSearchParams({
    q: trimmed,
    country: countryToApiValue(country),
    limit: String(SERVER_FETCH_LIMIT),
  });

  // First try the same /api/products/search proxy the client uses — it does
  // rank/dedupe/fallback handling and returns the canonical payload.
  const origin = headers ? getOriginFromHeaders(headers) : '';
  if (origin) {
    try {
      const proxyResponse = await fetch(`${origin}/api/products/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 30, tags: ['search', `q:${trimmed}`, `c:${country}`] },
      });
      if (proxyResponse.ok) {
        const data = await proxyResponse.json();
        const rawItems: ServerSearchApiItem[] =
          (Array.isArray(data.data) && data.data) ||
          (Array.isArray(data.items) && data.items) ||
          (Array.isArray(data.results) && data.results) ||
          (Array.isArray(data.products) && data.products) ||
          [];
        const fallbackCurrency = fallbackCurrencyFor(country);
        const normalized = rawItems
          .map((item) => normalizeServerProduct(item, fallbackCurrency))
          .slice(0, PAGE_SIZE);
        const total = typeof data.total === 'number' ? data.total : normalized.length;
        const hasMore = Boolean(data.has_more ?? data.hasMore ?? rawItems.length >= SERVER_FETCH_LIMIT);
        const degraded = Boolean(data.degraded ?? data.meta?.degraded);
        if (normalized.length > 0) {
          return { products: normalized, total, hasMore, degraded };
        }
        // Proxy returned 0 results — fall through to direct upstream before
        // giving up, so we still try the upstream catalog.
      }
    } catch {
      // ignore — fall through to direct fetch
    }
  }

  return fetchFromApi(params);
}

export function buildSearchItemListJsonLd({
  query,
  country,
  origin,
  products,
}: {
  query: string;
  country: string;
  origin: string;
  products: ServerSearchCardProduct[];
}) {
  if (products.length === 0) return null;
  const url = toSiteUrl(`/search?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`);
  const productSchemas = products
    .filter((product) => product.name && product.name !== 'Untitled product')
    .slice(0, 20)
    .map((product) => {
      const schema: Record<string, unknown> = {
        '@type': 'Product',
        name: product.name,
        url: product.href,
      };
      if (product.brand) schema.brand = { '@type': 'Brand', name: product.brand };
      if (product.category) schema.category = product.category;
      if (product.imageUrl) schema.image = product.imageUrl;
      if (typeof product.price === 'number') {
        schema.offers = {
          '@type': 'Offer',
          priceCurrency: product.currency,
          price: product.price.toFixed(2),
          availability: 'https://schema.org/InStock',
          url: product.href,
        };
      }
      return schema;
    });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        '@id': `${url}#results`,
        url,
        name: `Search results for "${query}"`,
        numberOfItems: products.length,
        itemListOrder: 'https://schema.org/ItemListUnordered',
        itemListElement: productSchemas.map((schema, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: schema,
        })),
      },
    ],
    // Surface the origin so consumers can sanity-check the source URL.
    _meta: { generatedFor: origin },
  };
}