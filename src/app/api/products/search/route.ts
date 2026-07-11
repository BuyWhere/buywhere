import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai'
).replace(/\/$/, '');

const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';
const ALLOWED_PARAMS = new Set(['q', 'country', 'country_code', 'limit', 'cursor', 'offset']);

type SearchFallbackItem = {
  id: string;
  title: string;
  name: string;
  price: { amount: number; currency: string };
  price_amount: number;
  price_currency: string;
  currency: string;
  merchant: string;
  merchant_name: string;
  source: string;
  url: string;
  click_url: string;
  brand: string;
  category: string;
};

type SearchFallback = {
  slug: string;
  label: string;
  category: string;
  country: 'US' | 'SG';
  currency: 'USD' | 'SGD';
  keywords: string[];
  products: Array<{
    name: string;
    price: number;
    merchant: string;
    brand: string;
  }>;
};

type UpstreamSearchResponse = {
  total?: number;
  degraded?: boolean;
  hint?: string;
  items?: unknown[];
  results?: unknown[];
  products?: unknown[];
  data?: unknown[];
  meta?: {
    total?: number;
    degraded?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const SEARCH_FALLBACKS: SearchFallback[] = [
  {
    slug: 'best-gaming-laptops-us',
    label: 'Gaming laptops',
    category: 'Laptops',
    country: 'US',
    currency: 'USD',
    keywords: ['gaming laptop', 'asus rog', 'rog zephyrus', 'alienware', 'razer blade', 'lenovo legion', 'msi'],
    products: [
      { name: 'ASUS ROG Zephyrus G16', price: 1699, merchant: 'Best Buy', brand: 'ASUS' },
      { name: 'Lenovo Legion Pro 5i', price: 1499, merchant: 'Lenovo', brand: 'Lenovo' },
      { name: 'MSI Raider GE78 HX', price: 2299, merchant: 'Amazon', brand: 'MSI' },
      { name: 'Razer Blade 16', price: 2699, merchant: 'Razer', brand: 'Razer' },
    ],
  },
  {
    slug: 'best-laptops-us',
    label: 'Laptops',
    category: 'Laptops',
    country: 'US',
    currency: 'USD',
    keywords: ['laptop', 'notebook', 'macbook', 'ultrabook', 'chromebook'],
    products: [
      { name: 'MacBook Air 13 M3', price: 999, merchant: 'Apple', brand: 'Apple' },
      { name: 'Dell XPS 13', price: 1099, merchant: 'Dell', brand: 'Dell' },
      { name: 'HP Spectre x360 14', price: 1249, merchant: 'Best Buy', brand: 'HP' },
      { name: 'Lenovo ThinkPad X1 Carbon', price: 1399, merchant: 'Lenovo', brand: 'Lenovo' },
    ],
  },
  {
    slug: 'best-headphones-us',
    label: 'Headphones',
    category: 'Headphones',
    country: 'US',
    currency: 'USD',
    keywords: ['wireless headphones', 'headphones', 'noise cancelling', 'noise canceling', 'sony wh', 'bose quietcomfort'],
    products: [
      { name: 'Sony WH-1000XM5 Wireless Headphones', price: 329, merchant: 'Amazon', brand: 'Sony' },
      { name: 'Bose QuietComfort Ultra Headphones', price: 379, merchant: 'Best Buy', brand: 'Bose' },
      { name: 'Apple AirPods Max', price: 479, merchant: 'Apple', brand: 'Apple' },
      { name: 'Sennheiser Momentum 4 Wireless', price: 299, merchant: 'Sennheiser', brand: 'Sennheiser' },
    ],
  },
  {
    slug: 'best-monitors-us',
    label: 'Monitors',
    category: 'Monitors',
    country: 'US',
    currency: 'USD',
    keywords: ['monitor', '4k monitor', 'display', 'ultrawide'],
    products: [
      { name: 'Dell UltraSharp 27 4K Monitor', price: 499, merchant: 'Dell', brand: 'Dell' },
      { name: 'LG UltraFine 32UN880-B', price: 599, merchant: 'Amazon', brand: 'LG' },
      { name: 'Samsung Odyssey G7', price: 549, merchant: 'Best Buy', brand: 'Samsung' },
      { name: 'ASUS ProArt Display PA279CRV', price: 469, merchant: 'B&H', brand: 'ASUS' },
    ],
  },
  {
    slug: 'best-robot-vacuums-2026',
    label: 'Robot vacuums',
    category: 'Robot Vacuums',
    country: 'US',
    currency: 'USD',
    keywords: ['robot vacuum', 'roomba', 'roborock', 'eufy vacuum', 'shark robot'],
    products: [
      { name: 'iRobot Roomba j9+', price: 599, merchant: 'Amazon', brand: 'iRobot' },
      { name: 'Roborock S8 MaxV Ultra', price: 1399, merchant: 'Roborock', brand: 'Roborock' },
      { name: 'Eufy X10 Pro Omni', price: 799, merchant: 'Amazon', brand: 'Eufy' },
      { name: 'Shark Matrix Plus 2-in-1', price: 499, merchant: 'Best Buy', brand: 'Shark' },
    ],
  },
  {
    slug: 'air-purifier-singapore',
    label: 'Air purifiers',
    category: 'Air Purifiers',
    country: 'SG',
    currency: 'SGD',
    keywords: ['air purifier', 'coway', 'levoit', 'blueair', 'xiaomi purifier'],
    products: [
      { name: 'Coway Airmega 150', price: 399, merchant: 'Coway Singapore', brand: 'Coway' },
      { name: 'Levoit Core 300S', price: 249, merchant: 'Amazon SG', brand: 'Levoit' },
      { name: 'Blueair Blue Max 3250i', price: 329, merchant: 'Courts', brand: 'Blueair' },
      { name: 'Xiaomi Smart Air Purifier 4', price: 229, merchant: 'Shopee', brand: 'Xiaomi' },
    ],
  },
  {
    slug: 'laptop-singapore',
    label: 'Laptops',
    category: 'Laptops',
    country: 'SG',
    currency: 'SGD',
    keywords: ['laptop', 'notebook', 'macbook', 'zenbook', 'thinkpad'],
    products: [
      { name: 'MacBook Air 13 M3', price: 1499, merchant: 'Apple Store', brand: 'Apple' },
      { name: 'ASUS Zenbook 14 OLED', price: 1699, merchant: 'ASUS Singapore', brand: 'ASUS' },
      { name: 'Lenovo Yoga 7i', price: 1549, merchant: 'Lenovo', brand: 'Lenovo' },
      { name: 'Dell XPS 14', price: 2199, merchant: 'Dell', brand: 'Dell' },
    ],
  },
];

function pickSearchFallback(query: string, countryCode: string) {
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedQuery) return null;

  const normalizedCountry = countryCode.toUpperCase() === 'SG' ? 'SG' : 'US';
  const candidates = SEARCH_FALLBACKS.filter((fallback) => fallback.country === normalizedCountry);
  return candidates.find((fallback) => fallback.keywords.some((keyword) => normalizedQuery.includes(keyword))) ?? null;
}

function hasResults(data: UpstreamSearchResponse | null) {
  const items = data?.items ?? data?.results ?? data?.products ?? data?.data ?? [];
  return Array.isArray(items) && items.length > 0;
}

function isDegradedZero(data: UpstreamSearchResponse | null) {
  const total = data?.total ?? data?.meta?.total;
  return Boolean(data?.degraded ?? data?.meta?.degraded) && !hasResults(data) && (total === undefined || Number(total) === 0);
}

function buildFallbackResponse(data: UpstreamSearchResponse | null, fallback: SearchFallback) {
  const fallbackUrl = `/${fallback.slug}`;
  const items: SearchFallbackItem[] = fallback.products.map((product, index) => ({
    id: `fallback-${fallback.slug}-${index + 1}`,
    title: product.name,
    name: product.name,
    price: { amount: product.price, currency: fallback.currency },
    price_amount: product.price,
    price_currency: fallback.currency,
    currency: fallback.currency,
    merchant: product.merchant,
    merchant_name: product.merchant,
    source: 'editorial_fallback',
    url: fallbackUrl,
    click_url: fallbackUrl,
    brand: product.brand,
    category: fallback.category,
  }));

  return {
    ...data,
    data: items,
    items,
    results: items,
    products: items,
    total: items.length,
    fallback: {
      type: 'editorial',
      label: fallback.label,
      url: fallbackUrl,
      reason: 'upstream_degraded_zero_results',
    },
    meta: {
      ...(data?.meta ?? {}),
      total: items.length,
      degraded: true,
      fallback: true,
      fallback_url: fallbackUrl,
    },
    hint: `Live search is degraded, so we are showing curated ${fallback.label.toLowerCase()} picks with a populated BuyWhere guide.`,
  };
}

export async function GET(request: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: 'missing_api_key', message: 'Search is not configured' },
      { status: 503 },
    );
  }

  const upstreamParams = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, key) => {
    if (ALLOWED_PARAMS.has(key)) {
      upstreamParams.set(key, value);
    }
  });

  const country = upstreamParams.get('country');
  if (country) {
    if (!upstreamParams.has('country_code')) {
      upstreamParams.set('country_code', country);
    }
    upstreamParams.delete('country');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/v1/products/search?${upstreamParams.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: 'search_failed', message: 'Search request failed' },
        { status: response.status },
      );
    }

    const query = upstreamParams.get('q') ?? '';
    const countryCode = upstreamParams.get('country_code') ?? 'US';
    const fallback = isDegradedZero(data) ? pickSearchFallback(query, countryCode) : null;

    if (fallback) {
      return NextResponse.json(buildFallbackResponse(data, fallback));
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'search_unavailable', message: 'Search service unavailable' },
      { status: 502 },
    );
  }
}
