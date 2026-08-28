import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai'
).replace(/\/$/, '');

const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';
const ALLOWED_PARAMS = new Set(['q', 'country', 'country_code', 'category', 'limit', 'cursor', 'offset', 'deliver_to', 'include_unshippable', 'region']);
// BUY-69727: Full device-query + storage-category detection for client-side demotion.
// Mirrors the isDeviceQuery / isStorageQuery logic from api/src/lib/searchRelevanceTaxonomy.ts
// to ensure all-words scanning (not just first word).
const DEVICE_QUERY_TOKENS = [
  'laptop', 'desktop', 'phone', 'tablet', 'monitor', 'smartwatch', 'earbud', 'headphone', 'console', 'ipad',
];
const STORAGE_QUERY_TOKENS = new Set(['ssd', 'hdd', 'nvme', 'storage', 'hard', 'drive']);
const STORAGE_CATEGORY_TOKENS = [
  'storage', 'internal ssd', 'solid state drive', 'solid state', 'hard drive',
  'nvme ssd', 'external ssd', 'internal drive', 'usb drive', 'memory card',
];
const PHONE_PRODUCT_TOKENS = [
  'iphone', 'samsung galaxy', 'galaxy s', 'galaxy z', 'google pixel', 'pixel',
  'android', 'smartphone', 'cell phone', 'mobile phone', 'unlocked phone',
  'dual sim', '5g', '4g', 'nokia', 'motorola', 'moto ', 'oneplus', 'xiaomi',
  'redmi', 'realme', 'infinix', 'oppo', 'vivo', 'sony xperia', 'feature phone',
  'keypad phone',
];
const PHONE_ACCESSORY_TOKENS = [
  'accessory', 'accessories', 'case', 'cover', 'protector', 'charger', 'charging',
  'cable', 'holder', 'mount', 'stand', 'pouch', 'wallet', 'crossbody', 'lanyard',
  'strap', 'armband', 'tripod', 'selfie stick', 'power bank', 'battery pack',
];

function classifyDeviceQuery(query: string): { isDevice: boolean; isStorage: boolean } {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  let isDevice = false, isStorage = false;
  for (const w of words) {
    for (const fam of DEVICE_QUERY_TOKENS) {
      if (w.length >= fam.length && w.startsWith(fam)) { isDevice = true; break; }
    }
    if (STORAGE_QUERY_TOKENS.has(w)) isStorage = true;
  }
  // Cap: don't trigger on long queries where device is incidental
  if (words.length > 4) isDevice = false;
  return { isDevice, isStorage };
}

function itemCategoryLower(item: Record<string, unknown>): string {
  const meta = item.metadata as Record<string, unknown> | null | undefined;
  const cat = typeof meta?.category === 'string' ? meta.category.toLowerCase() :
    (typeof item.category === 'string' ? item.category.toLowerCase() : '');
  return cat;
}

function isStorageCategoryItem(item: Record<string, unknown>): boolean {
  const cat = itemCategoryLower(item);
  if (!cat) return false;
  return STORAGE_CATEGORY_TOKENS.some((tok) => cat.includes(tok));
}

const ACCESSORY_KEYWORDS = [
  'adapter',
  'battery',
  'cable',
  'case',
  'charger',
  'charging',
  'cover',
  'ear pad',
  'ear pads',
  'ear cushion',
  'ear cushions',
  'earcup',
  'earcups',
  'foam',
  'holder',
  'mount',
  'pad',
  'pads',
  'part',
  'parts',
  'protector',
  'replacement',
  'sleeve',
  'stand',
  'strap',
  'usb',
];
const QUERY_STOP_WORDS = new Set(['a', 'an', 'and', 'best', 'for', 'in', 'of', 'the', 'to', 'with']);

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
    slug: 'laptop-us',
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
    slug: 'best-noise-canceling-headphones-us',
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
    slug: 'best-4k-monitors-us',
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
    slug: 'best',
    label: 'Standing desks',
    category: 'Office Furniture',
    country: 'US',
    currency: 'USD',
    keywords: ['standing desk', 'sit stand desk', 'adjustable desk', 'office desk'],
    products: [
      { name: 'Uplift V2 Standing Desk', price: 649, merchant: 'UPLIFT Desk', brand: 'UPLIFT' },
      { name: 'FlexiSpot E7 Pro Plus', price: 499, merchant: 'FlexiSpot', brand: 'FlexiSpot' },
      { name: 'Vari Electric Standing Desk', price: 750, merchant: 'Vari', brand: 'Vari' },
      { name: 'Secretlab Magnus Pro', price: 799, merchant: 'Secretlab', brand: 'Secretlab' },
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

function slugifyProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

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
  // BUY-60872 (governance rule #10): when upstream is degraded with zero results,
  // we MUST NOT synthesize invented product rows. Instead we return an honest empty
  // result set with a degraded flag and a suggestion to browse the editorial guide.
  const fallbackUrl = `/${fallback.slug}`;
  return {
    ...data,
    data: [],
    items: [],
    results: [],
    products: [],
    total: 0,
    fallback: {
      type: 'editorial',
      label: fallback.label,
      url: fallbackUrl,
      reason: 'upstream_degraded_zero_results',
    },
    meta: {
      ...(data?.meta ?? {}),
      total: 0,
      degraded: true,
      fallback: true,
      fallback_url: fallbackUrl,
    },
    hint: `Live search is degraded, so we are showing curated ${fallback.label.toLowerCase()} picks with a populated BuyWhere guide.`,
  };
}

function normalizeUpstreamItems(items: Record<string, unknown>[], countryCode: string): Record<string, unknown>[] {
  if (items.length <= 1) return items;

  const countryPrefix = countryCode.toUpperCase() === 'SG' ? 'sg' : 'us';
  const urls = items.map((item) => item.url || item.click_url).filter(Boolean);
  const allSameUrl = urls.length > 1 && new Set(urls).size === 1;

  if (!allSameUrl) return items;

  return items.map((item) => {
    const name = (typeof item.name === 'string' && item.name) || (typeof item.title === 'string' && item.title) || '';
    if (!name) return item;
    const productSlug = slugifyProductName(name);
    const productUrl = `/products/${countryPrefix}/${productSlug}`;
    return {
      ...item,
      url: productUrl,
      click_url: productUrl,
    };
  });
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
}

function coreQueryWords(query: string) {
  return normalizeText(query)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !QUERY_STOP_WORDS.has(word));
}

function itemSearchText(item: Record<string, unknown>) {
  const meta = item.metadata as Record<string, unknown> | null | undefined;
  return [item.name, item.title, item.brand, item.category, meta?.category]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function isPhoneProductItem(item: Record<string, unknown>) {
  const searchText = itemSearchText(item);
  return PHONE_PRODUCT_TOKENS.some((token) => searchText.includes(token));
}

function isPhoneAccessoryItem(item: Record<string, unknown>) {
  const category = itemCategoryLower(item);
  const searchText = itemSearchText(item);
  if (category.includes('phone accessory') || category.includes('cell phone accessory')) return true;
  if (isPhoneProductItem(item)) return false;
  return PHONE_ACCESSORY_TOKENS.some((token) => searchText.includes(token));
}

function isAccessoryItem(item: Record<string, unknown>, queryWords: string[]) {
  const searchText = itemSearchText(item);
  if (!searchText) return false;

  const hasAccessoryKeyword = ACCESSORY_KEYWORDS.some((keyword) => searchText.includes(keyword));
  if (!hasAccessoryKeyword) return false;
  if (queryWords.length === 0) return true;

  const matchedQueryWords = queryWords.filter((word) => searchText.includes(word)).length;
  return matchedQueryWords / queryWords.length < 0.5;
}

function dedupeKey(item: Record<string, unknown>) {
  const name = normalizeText(item.name || item.title);
  const brand = normalizeText(item.brand);
  if (!name) return '';

  return `${brand}:${name}`
    .replace(/\b(new|sale|deal|official|authentic|original)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function deduplicateItems(items: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = dedupeKey(item);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankAndClassifyItems(items: Record<string, unknown>[], query: string) {
  const queryWords = coreQueryWords(query);
  const { isDevice, isStorage } = classifyDeviceQuery(query);
  let dedupedItems = deduplicateItems(items);

  // BUY-69727: Demote storage-category items for device queries (not storage queries).
  if (isDevice && !isStorage) {
    const primary: Record<string, unknown>[] = [], demoted: Record<string, unknown>[] = [];
    for (const item of dedupedItems) {
      if (isStorageCategoryItem(item)) demoted.push(item);
      else primary.push(item);
    }
    dedupedItems = [...primary, ...demoted];
  }

  // BUY-69753: The live `phone` query has enough actual handset rows after rank
  // 10, but generic phone accessories/holders dominate the head. Promote handset
  // rows before the generic accessory pass so the top page satisfies device intent
  // without deleting accessories from longer-tail results.
  if (isDevice && !isStorage && query.toLowerCase().includes('phone')) {
    const phones: Record<string, unknown>[] = [], rest: Record<string, unknown>[] = [];
    for (const item of dedupedItems) {
      if (isPhoneProductItem(item)) phones.push(item);
      else rest.push(item);
    }
    dedupedItems = [...phones, ...rest];
  }

  const primaryItems: Record<string, unknown>[] = [];
  const accessoryItems: Record<string, unknown>[] = [];

  dedupedItems.forEach((item) => {
    const isAccessoryByKeyword = isAccessoryItem(item, queryWords);
    // For phone queries, also demote phone-accessory items
    const isPhoneAccessory = isDevice && !isStorage && query.toLowerCase().includes('phone')
      ? isPhoneAccessoryItem(item)
      : false;
    const isAccessory = isAccessoryByKeyword || isPhoneAccessory;
    const classifiedItem = { ...item, isAccessory, product_type: isAccessory ? 'accessory' : item.product_type };
    if (isAccessory) {
      accessoryItems.push(classifiedItem);
    } else {
      primaryItems.push(classifiedItem);
    }
  });

  return [...primaryItems, ...accessoryItems];
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

  // BUY-72906: REMOVED the country -> country_code rename. The FastAPI backend
  // expects 'country' (not 'country_code'), so we now pass it through unchanged.
  // The deliver_to + include_unshippable params now handle the region filtering.

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
    const countryCode = upstreamParams.get('country') ?? upstreamParams.get('country_code') ?? 'US';
    const fallback = isDegradedZero(data) ? pickSearchFallback(query, countryCode) : null;

    if (fallback) {
      return NextResponse.json(buildFallbackResponse(data, fallback));
    }

    const itemKey = data?.items ? 'items' : data?.results ? 'results' : data?.products ? 'products' : data?.data ? 'data' : null;
    if (itemKey && Array.isArray(data[itemKey]) && data[itemKey].length > 0) {
      data[itemKey] = rankAndClassifyItems(normalizeUpstreamItems(data[itemKey], countryCode), query);
      if (itemKey !== 'data' && data.data) data.data = data[itemKey];
      if (itemKey !== 'items' && data.items) data.items = data[itemKey];
      if (itemKey !== 'results' && data.results) data.results = data[itemKey];
      if (itemKey !== 'products' && data.products) data.products = data[itemKey];
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'search_unavailable', message: 'Search service unavailable' },
      { status: 502 },
    );
  }
}
