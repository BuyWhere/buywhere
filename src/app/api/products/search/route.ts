import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai'
).replace(/\/$/, '');

const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';
const ALLOWED_PARAMS = new Set(['q', 'country', 'country_code', 'category', 'limit', 'cursor', 'offset']);

const DEVICE_QUERY_TOKENS = [
  'laptop',
  'desktop',
  'phone',
  'tablet',
  'monitor',
  'smartwatch',
  'earbud',
  'headphone',
  'console',
  'ipad',
];
const STORAGE_QUERY_TOKENS = new Set(['ssd', 'hdd', 'nvme', 'storage', 'hard', 'drive']);
const STORAGE_CATEGORY_TOKENS = ['storage', 'internal ssd', 'solid state drive', 'solid state', 'hard drive', 'nvme ssd', 'external ssd', 'internal drive', 'usb drive', 'memory card'];
const PHONE_ACCESSORY_CATEGORY_TOKENS = ['accessory', 'accessories', 'case', 'cover', 'protector', 'charger', 'cable', 'adapter', 'battery', 'mount', 'holder', 'stand', 'skin'];

const ACCESSORY_KEYWORDS = [
  'adapter',
  'adhesive',
  'armband',
  'battery',
  'bumper',
  'cable',
  'capas',
  'case',
  'casing',
  'charger',
  'charging',
  'clip',
  'compatible with',
  'cord',
  'cover',
  'cushion',
  'decal',
  'decals',
  'dock',
  'ear pad',
  'ear pads',
  'ear cushion',
  'ear cushions',
  'earcup',
  'earcups',
  'filter',
  'foam',
  'grip',
  'holder',
  'housing',
  'lens protector',
  'mount',
  'mousepad',
  'mouse pad',
  'pad',
  'pads',
  'part',
  'parts',
  'protector',
  'replacement',
  'ring',
  'shell',
  'skin',
  'skins',
  'sleeve',
  'spare',
  'stand',
  'sticker',
  'stickers',
  'strap',
  'stylus',
  'tempered glass',
  'tissue',
  'usb',
  'wrap',
  'wristband',
];
const ACCESSORY_TITLE_PREFIX_PATTERN = /^(capas?|cases?|covers?|skins?|stickers?|decals?|wraps?|shells?|sleeves?|sleevings?|replacements?|spares?|filters?|adapters?|chargers?|cables?|protectors?|mounts?|holders?|stands?|clips?|grips?|bumpers?|earmuffs?|cushions?|foams?|pads?|straps?|rings?|housings?|docks?|backpacks?|bags?)\s+(for|compatible\s+with|fits|to|with|of)\b/i;
const QUERY_STOP_WORDS = new Set(['a', 'an', 'and', 'best', 'for', 'in', 'of', 'the', 'to', 'with']);

type SearchFallback = {
  slug: string;
  label: string;
  category: string;
  country: 'US' | 'SG';
  currency: 'USD' | 'SGD';
  keywords: string[];
  // BUY-60872: products[] retained for slugs/guide metadata only; we no longer
  // synthesize these as search result items (governance rule #10).
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
    hint: `Live search is currently degraded. Browse our curated ${fallback.label.toLowerCase()} guide at ${fallbackUrl} for hand-picked recommendations, or try a different search term.`,
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
  return [item.name, item.title, item.brand, item.category].map(normalizeText).filter(Boolean).join(' ');
}

// Categories that, when present in `metadata.category`, indicate the item is an
// accessory / peripheral for another product rather than the primary product
// itself. The category taxonomy comes from upstream (Shopify / merchant) so it
// is the most reliable signal — product titles are noisy because accessories
// are often titled like the primary product ("Case for iPhone 15 Pro").
//
// Kept as a substring matcher (any category whose lowercased value contains
// one of these tokens is treated as accessory) so that we catch variations
// like "Clear Case", "MagSafe Case", "Capas iPhone 15 Pro" without enumerating
// every possible Shopify product-type string.
const ACCESSORY_CATEGORY_TOKENS = [
  'case',
  'capa',
  'cover',
  'protector',
  'screen protector',
  'lens protector',
  'tempered glass',
  'skin',
  'sleeve',
  'shell',
  'bumper',
  'strap',
  'wristband',
  'armband',
  'mount',
  'mounts',
  'holder',
  'stand',
  'dock',
  'grip',
  'clip',
  'cushion',
  'foam',
  'mouse pad',
  'mousepad',
  'mouse pads',
  'stylus',
  'cable',
  'cord',
  'charger',
  'charging',
  'adapter',
  'adapters',
  'replacement',
  'spare',
  'battery',
  'battery pack',
  'power cord',
  'backpack',
  'laptop bag',
  'laptop backpack',
  'laptop sleeve',
  'laptop skin',
  'ear pad',
  'ear cushion',
  'earcup',
  'sticker',
  'decal',
  'wrap',
  'ring',
  'housing',
];

function categorySignalsAccessory(item: Record<string, unknown>) {
  const metadata = item.metadata as Record<string, unknown> | null | undefined;
  const metaCategory = typeof metadata?.category === 'string' ? metadata.category.toLowerCase().trim() : '';
  if (metaCategory) {
    for (const token of ACCESSORY_CATEGORY_TOKENS) {
      if (metaCategory.includes(token)) return true;
    }
  }

  const topLevelCategory = typeof item.category === 'string' ? item.category.toLowerCase().trim() : '';
  if (topLevelCategory) {
    for (const token of ACCESSORY_CATEGORY_TOKENS) {
      if (topLevelCategory.includes(token)) return true;
    }
  }

  return false;
}

function isAccessoryItem(item: Record<string, unknown>, queryWords: string[]) {
  const searchText = itemSearchText(item);
  if (!searchText) return false;

  const rawTitle = (typeof item.name === 'string' && item.name) || (typeof item.title === 'string' && item.title) || '';
  const hasAccessoryKeyword = ACCESSORY_KEYWORDS.some((keyword) => searchText.includes(keyword));
  const hasAccessoryTitlePrefix = rawTitle ? ACCESSORY_TITLE_PREFIX_PATTERN.test(rawTitle) : false;
  const hasAccessoryCategory = categorySignalsAccessory(item);

  // Strongest signal: upstream metadata.category says it is an accessory.
  // Trust it even if the title happens to mention the primary product (e.g.
  // "MagSafe Silicone iPhone 15 Pro Max" classified upstream as a Case).
  if (hasAccessoryCategory) return true;
  if (!hasAccessoryKeyword && !hasAccessoryTitlePrefix) return false;
  if (queryWords.length === 0) return true;

  // Title-prefix signals are decisive: "Case for iPhone 15 Pro" is always an
  // accessory even if every query word appears in the title.
  if (hasAccessoryTitlePrefix) return true;

  // Keyword present somewhere in name/title/brand/category. The accessory
  // signal wins unless the item matches EVERY query word AND its title has
  // no accessory keyword outside of compound phrases like "back case".
  const matchedQueryWords = queryWords.filter((word) => searchText.includes(word)).length;
  const matchesEveryQueryWord = matchedQueryWords === queryWords.length;
  if (matchesEveryQueryWord && hasAccessoryKeyword) {
    // Items like "Digital Glass Back Case (iPhone 12 Pro Till 15 Pro Max)" —
    // title mentions the primary product but is structurally an accessory.
    // Treat them as accessory unless they look like a primary product (their
    // first significant word is NOT an accessory noun).
    const firstWord = normalizeText(rawTitle).split(/\s+/).find((w) => w.length > 1) ?? '';
    const firstWordIsAccessory = ACCESSORY_CATEGORY_TOKENS.some((token) => firstWord === token || firstWord.endsWith(token));
    if (firstWordIsAccessory) return true;
    // Even if the first word isn't an accessory noun, a strong keyword like
    // "case" / "cover" / "protector" appearing in the title is decisive: the
    // item is being sold as an accessory for the primary product.
    const titleText = normalizeText(rawTitle);
    if (titleText.includes(' case') || titleText.startsWith('case ') || /\b(cover|skin|sleeve|protector|charger|cable|adapter|battery|strap|stand|mount|holder|replacement|spare|sticker|decal|wrap|shell|bumper)\b/.test(titleText)) {
      return true;
    }
  }
  return matchedQueryWords / queryWords.length < 0.8;
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

// BUY-69727: Mirrors isDeviceQuery / isStorageQuery from api/src/lib/searchRelevanceTaxonomy.ts.
// Detects device-typed queries (laptop/desktop/phone/tablet/...) regardless of which
// word carries the device token. Storage tokens (ssd/hdd/nvme/...) act as the positive
// control so e.g. `laptop ssd` correctly stays as a storage-positive query.
function classifyDeviceQuery(query: string): { isDevice: boolean; isStorage: boolean; wordCount: number } {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let isDevice = false;
  let isStorage = false;
  for (const w of words) {
    // Stem-tolerant startsWith: laptops -> laptop, earbuds -> earbud, monitors -> monitor
    for (const fam of DEVICE_QUERY_TOKENS) {
      if (w.length >= fam.length && w.startsWith(fam)) {
        isDevice = true;
        break;
      }
    }
    if (STORAGE_QUERY_TOKENS.has(w)) isStorage = true;
  }
  // Cap so multi-word phrasing like "asus rog gaming laptop 16gb" doesn't
  // accidentally trigger storage/exclusion logic when the device is incidental.
  if (wordCount > 4) isDevice = false;
  return { isDevice, isStorage, wordCount };
}

function itemCategoryLower(item: Record<string, unknown>): string {
  const metadata = item.metadata as Record<string, unknown> | null | undefined;
  const metaCat = typeof metadata?.category === 'string' ? metadata.category.toLowerCase() : '';
  if (metaCat) return metaCat;
  return typeof item.category === 'string' ? item.category.toLowerCase() : '';
}

function isStorageCategoryItem(item: Record<string, unknown>): boolean {
  const cat = itemCategoryLower(item);
  if (!cat) return false;
  return STORAGE_CATEGORY_TOKENS.some((tok) => cat.includes(tok));
}

function isPhoneAccessoryCategoryItem(item: Record<string, unknown>): boolean {
  const cat = itemCategoryLower(item);
  if (!cat) return false;
  return PHONE_ACCESSORY_CATEGORY_TOKENS.some((tok) => cat.includes(tok));
}

function rankAndClassifyItems(items: Record<string, unknown>[], query: string) {
  const queryWords = coreQueryWords(query);
  const { isDevice, isStorage } = classifyDeviceQuery(query);
  let dedupedItems = deduplicateItems(items);

  // BUY-69727: Device-query gate. If this is a device query that is NOT also a
  // storage query, demote storage-category rows out of the top-N result. Defense-
  // in-depth: upstream SQL should already filter them, but live tests showed
  // Firecuda-style leaks survive (e.g. NULL category on tier vs populated on
  // archive, or pagination that bypasses the tier FTS path).
  if (isDevice && !isStorage) {
    const primary: Record<string, unknown>[] = [];
    const demoted: Record<string, unknown>[] = [];
    for (const item of dedupedItems) {
      if (isStorageCategoryItem(item)) demoted.push(item);
      else primary.push(item);
    }
    dedupedItems = [...primary, ...demoted];
  }

  const primaryItems: Record<string, unknown>[] = [];
  const accessoryItems: Record<string, unknown>[] = [];

  dedupedItems.forEach((item) => {
    const accessoryByTitle = isAccessoryItem(item, queryWords);
    const accessoryByCategory =
      isDevice && !isStorage
        ? (query.toLowerCase().includes('phone') && isPhoneAccessoryCategoryItem(item))
        : false;
    const isAccessory = accessoryByTitle || accessoryByCategory;
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
