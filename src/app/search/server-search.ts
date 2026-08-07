// Server-only search fetch. Calls the same upstream /v1/products/search the
// client uses (with a short timeout and no caching) and normalizes results
// for SSR rendering. Runs during the Next.js server render so the initial
// HTML includes real product cards visible to AI crawlers / LLM answer
// engines.

import { normalizeProduct, type SearchApiItem, type SearchCardProduct } from './normalize-product';

const SEARCH_PAGE_SIZE = 20;
const SERVER_SEARCH_TIMEOUT_MS = 2500;

type ServerSearchInput = {
  query: string;
  countryCode: string;
  fallbackCurrency: string;
};

type ServerSearchResult = {
  products: SearchCardProduct[];
  total: number;
  degraded: boolean;
  hint: string | null;
};

export async function loadInitialSearchResults({
  query,
  countryCode,
  fallbackCurrency,
}: ServerSearchInput): Promise<ServerSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { products: [], total: 0, degraded: false, hint: null };
  }

  const baseUrl =
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    'https://api.buywhere.ai';
  const apiKey = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';
  const upperCountry = countryCode.toUpperCase();

  const params = new URLSearchParams({
    q: trimmed,
    country: upperCountry,
    country_code: upperCountry,
    limit: String(SEARCH_PAGE_SIZE),
  });

  const searchUrl = `${baseUrl.replace(/\/$/, '')}/v1/products/search?${params.toString()}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(SERVER_SEARCH_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { products: [], total: 0, degraded: false, hint: null };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: SearchApiItem[];
          items?: SearchApiItem[];
          results?: SearchApiItem[];
          products?: SearchApiItem[];
          total?: number;
          meta?: { total?: number; degraded?: boolean };
          degraded?: boolean;
          hint?: string;
        }
      | null;

    if (!payload) return { products: [], total: 0, degraded: false, hint: null };

    const rawItems = payload.data ?? payload.items ?? payload.results ?? payload.products ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [];
    const normalized = items
      .map((item) => normalizeProduct(item, fallbackCurrency))
      .filter((product) => product.name && product.name !== 'Untitled product')
      .slice(0, SEARCH_PAGE_SIZE);

    const total =
      typeof payload.total === 'number'
        ? payload.total
        : typeof payload.meta?.total === 'number'
          ? payload.meta.total
          : normalized.length;

    const degraded = Boolean(payload.degraded ?? payload.meta?.degraded);
    const hint = typeof payload.hint === 'string' ? payload.hint : null;

    return { products: normalized, total, degraded, hint };
  } catch {
    return { products: [], total: 0, degraded: false, hint: null };
  }
}
