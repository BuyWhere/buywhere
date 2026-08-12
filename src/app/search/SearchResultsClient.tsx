'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Search, X } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { MerchantBadge } from '@/components/ui/MerchantBadge';
import { CompareSelectButton } from '@/components/compare/CompareSelectButton';
import { openUpgradeIntentPrompt } from '@/lib/upgrade-intent-prompt';

const PAGE_SIZE = 20;
const SEARCH_FETCH_LIMIT = 40;
const MIN_QUERY_LENGTH = 2;
const SEARCH_HISTORY_KEY = 'bw_search_history';
const SEARCH_HISTORY_LIMIT = 8;
const SUGGESTED_SEARCHES = ['wireless headphones', 'running shoes', 'espresso machine', 'gaming laptop'];

const COUNTRY_OPTIONS = [
  { value: 'us', label: 'United States', apiValue: 'US', currency: 'USD' },
  { value: 'sg', label: 'Singapore', apiValue: 'SG', currency: 'SGD' },
] as const;

type CountryValue = (typeof COUNTRY_OPTIONS)[number]['value'];

type SearchResultsClientProps = {
  initialQuery?: string;
  initialCountry?: string;
};

type SearchApiItem = {
  id: number | string;
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

type SearchApiResponse = {
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  hasMore?: boolean;
  cursor?: string | null;
  next_cursor?: string | null;
  nextCursor?: string | null;
  data?: SearchApiItem[];
  items?: SearchApiItem[];
  results?: SearchApiItem[];
  products?: SearchApiItem[];
  degraded?: boolean;
  hint?: string;
  timeout_ms?: number;
};

export type SearchCardProduct = {
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

function normalizeCountry(value?: string): CountryValue {
  return value?.toLowerCase() === 'sg' ? 'sg' : 'us';
}

function getCountryOption(value: CountryValue) {
  return COUNTRY_OPTIONS.find((option) => option.value === value) ?? COUNTRY_OPTIONS[0];
}

function formatMerchantName(value?: string | null) {
  if (!value) return 'BuyWhere seller';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// BUY-65559: price sanity bounds.
//
// The catalog ingest lane (BUY-52807 family) has historically emitted sentinel
// prices — `amount: 1` when the Google Shopping scraper could not parse the
// merchant's product page, and `amount: 0` from a handful of Shopify feeds.
// Those sentinels reached the card as ordinary finite numbers and rendered as
// "$1.00" / "$0.00", so a RTX 5050 gaming laptop was listed at a dollar.
//
// `isPlausiblePrice` is the render-side backstop: anything outside the bounds
// is coerced to `null` in `normalizeProduct`, which routes it through the
// existing "Price unavailable" copy instead of showing a fabricated number.
// A missing price is honest; a wrong price is not.
//
// The guard deliberately fails OPEN — hiding a real product from search is a
// worse failure than showing one odd price, so every bound below is set where
// no genuine retail offer lives, and anything ambiguous keeps its price.
const MAX_PLAUSIBLE_PRICE = 10_000_000;

// Universal sentinel floor. Nothing in the catalog legitimately retails below
// this: the cheapest real rows sampled across gaming laptops, cables,
// keychains, stickers and screen protectors were $5.50-$6.99. Scraper
// sentinels cluster at 0, 0.01 and 1, so this bound separates them cleanly
// without a title heuristic that could misread a real product.
const ABSOLUTE_MIN_PRICE = 3;

// A second, narrower floor for big-ticket devices, where even $40 is clearly a
// data error. Applied ONLY when the title is unambiguously a primary device —
// accessories and collectibles are excluded first, because "Laptop Cooling
// Pad" ($38) and "Pop Television Action Figure" ($9.99) are real products
// whose titles merely borrow a high-value keyword.
const HIGH_VALUE_PRODUCT_PATTERN =
  /\b(laptop|notebook|macbook|desktop|imac|smartphone|iphone|television|refrigerator|dishwasher|playstation|xbox)\b/;
const HIGH_VALUE_MIN_PRICE = 50;

// Titles that borrow a high-value keyword while describing something cheap.
// "Pop Television" is Funko's collectible line, not a TV; a "SIM card holder
// for iPhone 13 Pro" is not an iPhone. Every entry here was observed as a real
// live catalog row that the floor would otherwise have hidden. The trailing
// `s?` matches plural titles ("Ponchos - iPhone") as well as singular.
const HIGH_VALUE_FALSE_FRIEND_PATTERN =
  /\b(action figure|figurine|funko|pop television|collectible|plush|poster|keychain|sticker|decal|magnet|mug|t-shirt|tee|toy|lego|replica|miniature|keyboard|mouse|screen protector|tempered glass|poncho|holder|mount|strap|band|grip|ring|wallet|pouch|tripod|stylus|lens|film|clip|skin|sleeve|case|cover)s?\b/;

// A "for <device>" / "compatible with <device>" title is describing something
// made FOR the device, not the device itself.
const ACCESSORY_PREPOSITION_PATTERN = /\b(for|compatible with|fits|designed for)\b/;

function isPlausiblePrice(price: number | null, product: { name: string; category: string | null }): boolean {
  if (price === null || !Number.isFinite(price)) return false;

  // Zero, negative, or absurd is never a real offer, whatever the item.
  if (price <= 0 || price > MAX_PLAUSIBLE_PRICE) return false;

  // Sentinel territory — below any genuine retail price in the catalog.
  if (price < ABSOLUTE_MIN_PRICE) return false;

  const text = `${product.name} ${product.category || ''}`.toLowerCase();

  if (HIGH_VALUE_PRODUCT_PATTERN.test(text) && price < HIGH_VALUE_MIN_PRICE) {
    // Fail open for anything that only looks like a big-ticket device.
    if (HIGH_VALUE_FALSE_FRIEND_PATTERN.test(text)) return true;
    if (ACCESSORY_PREPOSITION_PATTERN.test(text)) return true;
    if (isAccessoryProduct({ name: product.name, category: product.category } as SearchCardProduct)) return true;
    return false;
  }

  return true;
}

function formatPrice(price: number | null, currency: string) {
  if (price === null || !Number.isFinite(price)) return 'Price unavailable';

  try {
    return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function hasUsableProductImage(value?: string | null) {
  if (!value) return false;

  try {
    const imageUrl = new URL(value);
    const hostname = imageUrl.hostname.toLowerCase();
    const pathname = imageUrl.pathname.toLowerCase();
    const search = imageUrl.search.toLowerCase();
    const fullUrl = `${hostname}${pathname}${search}`;

    if (hostname.includes('source.unsplash.com') || fullUrl.includes('source.unsplash.com')) return false;
    if (hostname.includes('images.unsplash.com') || fullUrl.includes('images.unsplash.com')) return false;
    if (hostname.includes('unsplash.com')) return false;
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

// BUY-63738: Re-rank search results for product-category queries.
// Priorities (descending):
//   1. Has usable image (filter out generic placeholders)
//   2. Has valid price (not null)
//   3. Is primary product (not accessory)
//   4. ts_rank from API (preserved within same tier)
const ACCESSORY_KEYWORDS = [
  'skin', 'skins', 'decal', 'decals', 'sticker', 'stickers',
  'sleeve', 'sleeves', 'case', 'cases', 'cover', 'covers', 'protector', 'protectors',
  'backpack', 'backpacks', 'bag', 'bags', 'briefcase', 'briefcases', 'messenger',
  'shell', 'shells', 'pad', 'pads', 'cooler', 'coolers',
  'adapter', 'adapters', 'dock', 'docks', 'hub', 'hubs',
  'lock', 'locks', 'charger', 'chargers', 'cable', 'cables',
  'stand', 'stands', 'mat', 'mats', 'tablet',
];

function isAccessoryProduct(product: SearchCardProduct): boolean {
  const titleLower = product.name.toLowerCase();
  const categoryLower = (product.category || '').toLowerCase();
  const text = `${titleLower} ${categoryLower}`;

  // BUY-63738: Detect accessories (backpacks, skins, sleeves, etc.).
  // Strategy: products with accessory keywords are accessories UNLESS the title
  // is clearly a primary laptop/notebook/macbook product.
  const hasAccessoryKeyword = ACCESSORY_KEYWORDS.some(keyword => titleLower.includes(keyword));

  if (!hasAccessoryKeyword) return false;

  // If title contains "laptop" and the title STARTS with or centers on a real laptop
  // (not an accessory for laptop), it's a laptop product.
  // E.g., "ASUS TUF Gaming F16 Laptop Intel..." = laptop
  // E.g., "Backpack Gaming Backpack For Laptop" = accessory
  // E.g., "Robotic Doodle Laptop Skin" = accessory
  // E.g., "MacBook Pro Case Cover" = accessory

  // Heuristic: if accessory keyword appears BEFORE "laptop/notebook/macbook", it's an accessory
  const accessoryIdx = ACCESSORY_KEYWORDS.reduce((minIdx, kw) => {
    const idx = titleLower.indexOf(kw);
    return idx >= 0 && (minIdx < 0 || idx < minIdx) ? idx : minIdx;
  }, -1);

  const laptopMatch = titleLower.match(/\b(laptop|notebook|macbook)\b/);
  const laptopIdx = laptopMatch ? laptopMatch.index! : -1;

  // Accessory word appears before laptop word = accessory (e.g., "Backpack for Laptop")
  if (accessoryIdx >= 0 && laptopIdx >= 0 && accessoryIdx < laptopIdx) {
    return true;
  }

  // Accessory word appears after laptop word and is a common suffix pattern
  // E.g., "Laptop Skin", "MacBook Case" = accessory
  if (accessoryIdx >= 0 && laptopIdx >= 0 && accessoryIdx > laptopIdx) {
    // If the accessory keyword is within 20 chars of the laptop word, it's likely a modifier (accessory)
    return (accessoryIdx - laptopIdx) < 25;
  }

  // Only accessory keyword (no laptop) = accessory
  return true;
}

function rankProduct(product: SearchCardProduct): number {
  let score = 0;
  // Has usable image
  if (product.imageUrl) score += 100;
  // Has valid price
  if (product.price !== null) score += 50;
  // Not an accessory
  if (!isAccessoryProduct(product)) score += 25;
  return score;
}

function sortProductsByRelevance(products: SearchCardProduct[]) {
  return [...products].sort((leftProduct, rightProduct) => {
    const leftScore = rankProduct(leftProduct);
    const rightScore = rankProduct(rightProduct);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return 0;
  });
}


function normalizeProduct(item: SearchApiItem, fallbackCurrency: string): SearchCardProduct {
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

  const name = item.name || item.title || 'Untitled product';
  const category = item.category || specCategory;
  const finitePrice = Number.isFinite(numericPrice) ? numericPrice : null;

  return {
    id: String(item.id),
    name,
    // BUY-65559: drop implausible sentinel prices to null so the card renders
    // "Price unavailable" instead of a fabricated "$1.00" / "$0.00".
    price: isPlausiblePrice(finitePrice, { name, category }) ? finitePrice : null,
    currency: priceCurrency || fallbackCurrency,
    merchant: formatMerchantName(item.merchant_name || item.merchant || item.source),
    imageUrl,
    href: item.affiliate_redirect_url || item.click_url || item.affiliate_url || item.buy_url || item.url || '#',
    brand: item.brand || specBrand,
    category,
  };
}

// BUY-68736: collapse near-identical placeholder products.
//
// QA reproduced a "gaming laptop" search where the same synthetic row appeared
// six times under tier-suffixed titles:
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Plus"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Elite"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Max"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro"
//
// Every variant carried the same merchant, currency, image, and
// `metadata: null` — seeded inventory the catalog ingest lane emits when it
// can't distinguish individual offers. Showing all six makes the page look
// fake; QA scored this P1 conversion/trust.
//
// Strategy: build a normalized cluster key per product (lowercase, drop the
// tier-suffix tokens, collapse whitespace) and within each cluster keep only
// the highest-scoring representative. Real products with genuinely different
// specs ("RTX 4060" vs "RTX 5060", "16GB RAM" vs "32GB RAM") keep distinct
// keys and are NOT collapsed. This is a render-side backstop that composes
// with the existing rankProduct tier (image > price > accessory).
const PLACEHOLDER_TIER_SUFFIX_PATTERN =
  /^(premium|plus|elite|max|pro|standard|basic|ultra|signature|limited|edition|plus\+?|xl|xs)\b[+\s-]*$/i;

function normalizeTitleForCluster(title: string): string {
  const stripped = title
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .split(/[\s/_\-–—+]+/)
    .filter(Boolean);
  // Drop trailing tier-suffix tokens (Premium / Plus / Elite / Max / Pro …)
  // repeatedly so a stack like "Pro Plus Elite" still collapses.
  const tokens: string[] = [];
  for (const token of stripped) {
    if (PLACEHOLDER_TIER_SUFFIX_PATTERN.test(token)) continue;
    tokens.push(token);
  }
  return tokens.join(' ');
}

function dedupeByTitleCluster(products: SearchCardProduct[]): SearchCardProduct[] {
  const order: string[] = [];
  const clusterOf = new Map<string, { representative: SearchCardProduct; representativeScore: number }>();

  for (const product of products) {
    const key = normalizeTitleForCluster(product.name);
    const score = rankProduct(product);
    const existing = clusterOf.get(key);
    if (!existing) {
      order.push(key);
      clusterOf.set(key, { representative: product, representativeScore: score });
      continue;
    }
    if (score > existing.representativeScore) {
      existing.representative = product;
      existing.representativeScore = score;
    }
  }

  return order.map((key) => clusterOf.get(key)!.representative);
}

// BUY-65559: exported for the price-sanity regression test.
// BUY-68736: also exports the placeholder-cluster dedup helpers for the
// regression test that pins the QA-reported collapse.
export const __test__ = {
  isPlausiblePrice,
  formatPrice,
  normalizeProduct,
  normalizeTitleForCluster,
  dedupeByTitleCluster,
  HIGH_VALUE_MIN_PRICE,
  MAX_PLAUSIBLE_PRICE,
};

function normalizeSearchHistoryQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function readSearchHistory() {
  if (typeof window === 'undefined') {
    return [] as string[];
  }

  try {
    const rawValue = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!rawValue) {
      return [] as string[];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [] as string[];
    }

    return parsedValue
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeSearchHistoryQuery)
      .filter(Boolean)
      .slice(-SEARCH_HISTORY_LIMIT);
  } catch {
    return [] as string[];
  }
}

function writeSearchHistory(entries: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries));
}

function mergeSearchHistoryEntry(entries: string[], query: string) {
  const normalizedQuery = normalizeSearchHistoryQuery(query);

  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return entries;
  }

  const dedupedEntries = entries.filter((entry) => entry.toLowerCase() !== normalizedQuery.toLowerCase());
  return [...dedupedEntries, normalizedQuery].slice(-SEARCH_HISTORY_LIMIT);
}

function SearchInputSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="h-14 animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-14 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}

function SearchResultsSkeleton() {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', maxWidth: '1200px' }}
      aria-hidden="true"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="aspect-[4/3] animate-pulse bg-slate-200" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
            <div className="h-8 w-1/2 animate-pulse rounded-full bg-amber-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchProgressIndicator({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const phase =
    elapsed < 3
      ? { icon: '\uD83D\uDD0D', message: 'Searching catalog across retailers\u2026' }
      : elapsed < 5
        ? { icon: '\u23F3', message: 'Still searching \u2014 this may take a moment' }
        : elapsed < 8
          ? { icon: '\u231B', message: 'Almost there \u2014 compiling results' }
          : { icon: '\uD83D\uDD0D', message: 'Still working \u2014 many retailers being queried' };

  return (
    <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span className="text-lg">{phase.icon}</span>
        <span>{phase.message}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full animate-pulse rounded-full bg-amber-500 transition-all duration-1000"
            style={{ width: `${Math.min((elapsed / 12) * 100, 85)}%` }}
          />
        </div>
        <span className="min-w-[2.5ch] text-xs tabular-nums text-slate-400">{elapsed}s</span>
      </div>
    </div>
  );
}


function SearchCard({ product }: { product: SearchCardProduct }) {
  const [imageError, setImageError] = useState(false);

  // Branded placeholder for broken/missing images - shows brand + product name
  // Similar to ProductGridImage's BrandedPlaceholder (BUY-63851 fix)
  function BrandedPlaceholder() {
    const brandText = (product.brand || 'BuyWhere').slice(0, 18);
    const productLabel = product.name.slice(0, 26);

    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 p-4">
        <div className="mb-2 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" className="w-full max-w-[180px] drop-shadow-sm">
            <defs>
              <linearGradient id="searchCardBg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#fff7ed" />
                <stop offset="1" stopColor="#fde68a" />
              </linearGradient>
            </defs>
            <rect width="400" height="300" fill="url(#searchCardBg)" />
            <rect x="40" y="40" width="320" height="220" rx="24" fill="#ffffff" stroke="#fcd34d" strokeWidth="3" />
            <g transform="translate(140 80)" fill="none" stroke="#b45309" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="0" y="0" width="120" height="90" rx="12" fill="#fef3c7" />
              <circle cx="60" cy="40" r="14" fill="#f59e0b" stroke="none" />
              <path d="M0 70 L40 35 L80 60 L120 25" stroke="#b45309" />
            </g>
            <text x="200" y="208" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="22" fontWeight="700" fill="#0f172a">
              {brandText}
            </text>
            <text x="200" y="236" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="14" fontWeight="500" fill="#475569">
              {productLabel}
            </text>
            <text x="200" y="258" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="11" fontWeight="600" letterSpacing="2" fill="#92400e">
              BUYWHERE
            </text>
          </svg>
        </div>
        {product.brand && (
          <span className="text-xs text-slate-600">{product.brand}</span>
        )}
      </div>
    );
  }

  return (
    <a
      data-testid="search-product-card"
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex h-full min-h-[460px] min-w-0 flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div
        className="relative w-full max-h-[220px] shrink-0 overflow-hidden border-b border-slate-100 bg-slate-100"
        style={{ aspectRatio: '4/3', maxHeight: '220px' }}
        data-testid="search-product-media"
      >
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_rgba(248,250,252,0.96)_55%,_rgba(226,232,240,0.96))] text-sm font-semibold text-slate-600">
          Product image
        </div>
        {product.imageUrl && !imageError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              setImageError(true);
            }}
            // BUY-64266: drop group-hover:scale-[1.03] which pushed the rightmost
            // card image beyond the grid column on desktop. Keep BUY-64736's
            // max-h-[220px] / max-w-full / object-contain bounds so the image
            // can never exceed its 220px-tall card frame.
            className="relative z-10 block h-full w-full max-h-[220px] max-w-full object-contain p-2"
            style={{ maxHeight: '220px', width: '100%', objectFit: 'contain' }}
          />
        ) : imageError || !product.imageUrl ? (
          <BrandedPlaceholder />
        ) : null}
        <div className="absolute right-2 top-2 z-20">
          <CompareSelectButton product={product} className="h-9 w-9" />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2.5 bg-white p-3.5" data-testid="search-product-details">
        <div className="flex min-h-7 items-start justify-between gap-2">
          <MerchantBadge merchant={product.merchant} className="min-w-0 flex-1 basis-0" />
          <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
            Shop
            <ExternalLink className="h-3 w-3" />
          </span>
        </div>

        <div className="space-y-1.5">
          <h2
            className="line-clamp-3 text-base font-semibold leading-snug text-slate-950 transition-colors group-hover:text-amber-700"
          >
            {product.name}
          </h2>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            {product.brand ? <span>{product.brand}</span> : null}
            {product.category ? <span>{product.category}</span> : null}
          </div>
        </div>

        <div className="mt-auto space-y-2.5 border-t border-slate-100 pt-2.5">
          {/* BUY-65455: label + price on a single baseline-aligned row so the
              numeric price is visually adjacent to the 'Current price' label
              (previously they were disconnected: a floating pill on the image
              + the label here). BUY-67976: bumped label + metadata from
              text-slate-500 (~4.76:1) to text-slate-600 (~7.58:1) so VidMee
              passes WCAG AA 4.5:1 against the white card background. */}
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">Current price</p>
            <p className="text-xl font-bold tracking-tight text-slate-950">{formatPrice(product.price, product.currency)}</p>
          </div>
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-amber-600">
            View Deal
            <ExternalLink className="h-4 w-4" />
          </span>
        </div>
      </div>
    </a>
  );
}

export default function SearchResultsClient({
  initialQuery = '',
  initialCountry = 'us',
}: SearchResultsClientProps) {
  const initialSearchQuery = initialQuery.trim();
  const hasInitialSearchQuery = initialSearchQuery.length >= MIN_QUERY_LENGTH;
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() ?? '';
  const urlSearchParams = useMemo(() => new URLSearchParams(searchParamsString), [searchParamsString]);
  const [isNavigating, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [country, setCountry] = useState<CountryValue>(normalizeCountry(initialCountry));
  const [debouncedQuery, setDebouncedQuery] = useState(initialSearchQuery);
  const [products, setProducts] = useState<SearchCardProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(hasInitialSearchQuery);
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [degradedHint, setDegradedHint] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);
  const lastRequestKeyRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFieldRef = useRef<HTMLLabelElement>(null);

  const persistSearchHistory = useCallback((searchTerm: string) => {
    setSearchHistory((currentHistory) => {
      const nextHistory = mergeSearchHistoryEntry(currentHistory, searchTerm);
      if (nextHistory !== currentHistory) {
        writeSearchHistory(nextHistory);
      }
      return nextHistory;
    });
  }, []);

  const runSearch = useCallback((searchTerm: string) => {
    const normalizedQuery = normalizeSearchHistoryQuery(searchTerm);
    setQuery(normalizedQuery);
    setDebouncedQuery(normalizedQuery);
    setHistoryOpen(false);
    setActiveHistoryIndex(-1);

    if (normalizedQuery.length >= MIN_QUERY_LENGTH) {
      persistSearchHistory(normalizedQuery);
    }
  }, [persistSearchHistory]);

  const removeHistoryEntry = useCallback((entryToRemove: string) => {
    setSearchHistory((currentHistory) => {
      const nextHistory = currentHistory.filter((entry) => entry !== entryToRemove);
      writeSearchHistory(nextHistory);
      return nextHistory;
    });
    setActiveHistoryIndex(-1);
  }, []);

  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    writeSearchHistory([]);
    setHistoryOpen(false);
    setActiveHistoryIndex(-1);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    setSearchHistory(readSearchHistory());
  }, []);

  useEffect(() => {
    const nextQuery = (urlSearchParams.get('q') || '').trim();
    const nextCountry = normalizeCountry(urlSearchParams.get('country') || initialCountry);

    if (nextQuery !== query) {
      setQuery(nextQuery);
      setDebouncedQuery(nextQuery);
    }

    if (nextCountry !== country) {
      setCountry(nextCountry);
    }
  }, [country, initialCountry, query, urlSearchParams]);

  useEffect(() => {
    const normalizedQuery = normalizeSearchHistoryQuery(debouncedQuery);
    if (normalizedQuery.length >= MIN_QUERY_LENGTH) {
      persistSearchHistory(normalizedQuery);
    }
  }, [debouncedQuery, persistSearchHistory]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) {
      params.set('q', debouncedQuery);
    }
    params.set('country', country);

    const nextQueryString = params.toString();
    const currentQueryString = urlSearchParams.toString();

    if (nextQueryString !== currentQueryString) {
      startTransition(() => {
        router.replace(nextQueryString ? `/search?${nextQueryString}` : '/search', { scroll: false });
      });
    }
  }, [country, debouncedQuery, router, urlSearchParams]);

  const activeCountry = useMemo(() => getCountryOption(country), [country]);

  const fetchResults = useCallback(async ({
    mode,
    cursor,
    offsetValue,
    signal,
  }: {
    mode: 'replace' | 'append';
    cursor?: string | null;
    offsetValue?: number;
    signal: AbortSignal;
  }) => {
    const trimmedQuery = debouncedQuery.trim();

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setProducts([]);
      setTotal(0);
      setHasMore(false);
      setNextCursor(null);
      setOffset(0);
      setError(null);
      return;
    }

    const params = new URLSearchParams({
      q: trimmedQuery,
      country: activeCountry.apiValue,
      limit: String(SEARCH_FETCH_LIMIT),
    });

    if (cursor) {
      params.set('cursor', cursor);
    } else if (offsetValue && offsetValue > 0) {
      params.set('offset', String(offsetValue));
    }

    const requestKey = `${trimmedQuery}:${country}:${cursor ?? offsetValue ?? 0}:${mode}`;
    lastRequestKeyRef.current = requestKey;

    if (mode === 'replace') {
      setLoadingInitial(true);
      setSearchStartTime(Date.now());
    } else {
      setLoadingMore(true);
    }

    setError(null);

    try {
      const response = await fetch(`/api/products/search?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      if (response.status === 429) {
        openUpgradeIntentPrompt({
          source: 'search:rate-limit',
          context: 'rate_limit',
          headline: 'You hit the free-tier limit',
          description:
            'Join the Pro launch list and we’ll contact you when higher daily quota is available.',
        });
        throw new Error('Too many requests, try again shortly');
      }

      if (!response.ok) {
        throw new Error('Search results could not be loaded');
      }

      const data: SearchApiResponse = await response.json();
      const rawItems = data.data || data.items || data.results || data.products || [];
      if (data.degraded) {
        setDegraded(true);
        if (typeof data.hint === 'string' && data.hint.trim().length > 0) {
          setDegradedHint(data.hint);
        }
      } else {
        setDegraded(false);
        setDegradedHint(null);
      }
      const normalizedItems = sortProductsByRelevance(
        dedupeByTitleCluster(rawItems.map((item) => normalizeProduct(item, activeCountry.currency)))
      ).slice(0, PAGE_SIZE);
      const fetchedPageIsFull = rawItems.length >= SEARCH_FETCH_LIMIT;

      if (lastRequestKeyRef.current !== requestKey) {
        return;
      }

      let mergedCount = normalizedItems.length;
      setProducts((currentProducts) => {
        const nextItems = mode === 'append' ? [...currentProducts, ...normalizedItems] : normalizedItems;
        mergedCount = nextItems.length;
        return nextItems;
      });
      setTotal(typeof data.total === 'number' ? data.total : mergedCount);
      setHasMore(Boolean(data.has_more ?? data.hasMore ?? fetchedPageIsFull));
      setNextCursor(data.next_cursor ?? data.nextCursor ?? null);
      setOffset(typeof data.offset === 'number' ? data.offset : offsetValue ?? 0);
    } catch (caughtError) {
      if (signal.aborted) {
        return;
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Search results could not be loaded');
      if (mode === 'replace') {
        setProducts([]);
        setTotal(0);
        setHasMore(false);
        setNextCursor(null);
        setOffset(0);
      }
    } finally {
      if (mode === 'replace') {
        setLoadingInitial(false);
        setSearchStartTime(null);
      } else {
        setLoadingMore(false);
      }
    }
  }, [activeCountry.apiValue, activeCountry.currency, country, debouncedQuery]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchResults({
      mode: 'replace',
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [fetchResults]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (searchFieldRef.current && !searchFieldRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!historyOpen || query.trim() || searchHistory.length === 0) {
      setActiveHistoryIndex(-1);
    }
  }, [historyOpen, query, searchHistory.length]);

  const showSearchPrompt = debouncedQuery.length < MIN_QUERY_LENGTH;
  const showDegradedState = !loadingInitial && !error && debouncedQuery.length >= MIN_QUERY_LENGTH && products.length === 0 && degraded;
  const showEmptyState = !loadingInitial && !error && debouncedQuery.length >= MIN_QUERY_LENGTH && products.length === 0 && !degraded;
  const showHistoryDropdown = historyOpen && query.trim().length === 0 && searchHistory.length > 0;
  const reversedSearchHistory = useMemo(() => [...searchHistory].reverse(), [searchHistory]);
  const hasActiveSearch = debouncedQuery.length >= MIN_QUERY_LENGTH;

  return (
    <div className="flex min-h-screen flex-col bg-[linear-gradient(180deg,_#fff7ed_0%,_#ffffff_28%,_#f8fafc_100%)]">
      <Header />

      <main id="main-content" className="flex-1">
        {/* Mobile compact summary (replaces the full hero on mobile when an active search
            is running) — keeps the result count + query fully visible by wrapping gracefully
            on small viewports instead of truncating with an ellipsis (BUY-67976).
            Rendered as an <h1> for SEO semantics and tightened to ~44px above the fold. */}
        {hasActiveSearch ? (
          <h1
            data-testid="search-mobile-summary"
            className="mx-auto block max-w-7xl px-4 py-3 text-sm font-semibold leading-snug text-slate-700 [overflow-wrap:anywhere] md:hidden"
          >
            <span className="text-amber-700">{activeCountry.label.toUpperCase()}</span>
            <span className="mx-2 text-slate-300">/</span>
            <span>
              {loadingInitial
                ? 'Searching…'
                : `${total.toLocaleString()} results for “${debouncedQuery}”`}
            </span>
          </h1>
        ) : null}

        <section className="hidden border-b border-amber-100 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.22),_rgba(255,247,237,0.85)_38%,_rgba(255,255,255,1)_80%)] md:block">
          <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${hasActiveSearch ? 'py-5 lg:py-6' : 'py-10 lg:py-14'}`}>
            <div className="max-w-3xl">
              {/* Hide the hero H1 + eyebrow when an active search is running so the query
                  isn't echoed twice. The result-count heading below becomes the single,
                  unified results header (rendered as <h1> for SEO semantics). */}
              {hasActiveSearch ? null : (
                <>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">Product search</p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                    Find live catalog results without leaving BuyWhere
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                    Search BuyWhere&apos;s product index by query and country, then jump directly to retailer listings.
                  </p>
                </>
              )}
            </div>

            <div className={`${hasActiveSearch ? 'mt-5 rounded-[28px] p-3 md:p-4' : 'mt-8 rounded-[32px] p-4 md:p-6'} border border-white/80 bg-white/80 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur`}>
              {isNavigating && showSearchPrompt ? <SearchInputSkeleton /> : null}

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <label ref={searchFieldRef} className="relative block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Search query</span>
                  <Search className="pointer-events-none absolute left-4 top-[3.2rem] h-5 w-5 text-slate-600" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      setQuery(nextQuery);
                      setHistoryOpen(!nextQuery.trim() && searchHistory.length > 0);
                    }}
                    onFocus={() => {
                      if (!query.trim() && searchHistory.length > 0) {
                        setHistoryOpen(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setHistoryOpen(false);
                        setActiveHistoryIndex(-1);
                        return;
                      }

                      if (!showHistoryDropdown) {
                        if (event.key === 'Enter' && query.trim().length >= MIN_QUERY_LENGTH) {
                          event.preventDefault();
                          runSearch(query);
                        }
                        return;
                      }

                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setActiveHistoryIndex((currentIndex) =>
                          currentIndex < reversedSearchHistory.length - 1 ? currentIndex + 1 : 0
                        );
                        return;
                      }

                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActiveHistoryIndex((currentIndex) =>
                          currentIndex > 0 ? currentIndex - 1 : reversedSearchHistory.length - 1
                        );
                        return;
                      }

                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (activeHistoryIndex >= 0 && activeHistoryIndex < reversedSearchHistory.length) {
                          runSearch(reversedSearchHistory[activeHistoryIndex]);
                        }
                      }
                    }}
                    placeholder="Search sneakers, laptops, espresso machines..."
                    className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-base text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    aria-label="Search products"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showHistoryDropdown}
                    aria-controls={showHistoryDropdown ? 'search-history-listbox' : undefined}
                    aria-activedescendant={
                      showHistoryDropdown && activeHistoryIndex >= 0
                        ? `search-history-option-${activeHistoryIndex}`
                        : undefined
                    }
                  />

                  {showHistoryDropdown ? (
                    <div
                      id="search-history-listbox"
                      role="listbox"
                      className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.45)]"
                    >
                      <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                        Recent searches
                      </div>
                      <ul className="py-2">
                        {reversedSearchHistory.map((entry, index) => (
                          <li
                            key={`${entry}-${index}`}
                            id={`search-history-option-${index}`}
                            role="option"
                            aria-selected={activeHistoryIndex === index}
                            className={`flex items-center gap-3 px-4 py-3 transition ${
                              activeHistoryIndex === index ? 'bg-amber-50' : 'hover:bg-slate-50'
                            }`}
                            onMouseEnter={() => setActiveHistoryIndex(index)}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => runSearch(entry)}
                            >
                              <Search className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
                              <span className="truncate text-sm font-medium text-slate-900">{entry}</span>
                            </button>
                            <button
                              type="button"
                              className="rounded-full p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-700"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => removeHistoryEntry(entry)}
                              aria-label={`Delete ${entry} from search history`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-amber-700 transition hover:text-amber-800"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={clearHistory}
                        >
                          Clear history
                        </button>
                      </div>
                    </div>
                  ) : null}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Country</span>
                  <select
                    value={country}
                    onChange={(event) => setCountry(normalizeCountry(event.target.value))}
                    className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    aria-label="Country selector"
                  >
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* BUY-68744: WCAG-AAA-compliant pill colors. Previous amber-50/amber-800
                  pairing computed to 6.37:1 — passes AA but VidMee flagged low
                  legibility and recommended darker text / neutral background. */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>Suggested:</span>
                {SUGGESTED_SEARCHES.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => runSearch(suggestion)}
                    className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-200"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          {showSearchPrompt ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 p-8 text-center shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">Start browsing</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Enter at least 2 characters to see results</h2>
              <p className="mt-3 text-slate-600">Try a product type, brand, or category and switch countries as needed.</p>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-900 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">Search unavailable</p>
              <h2 className="mt-2 text-2xl font-semibold">Results could not be loaded</h2>
              <p className="mt-3 text-red-800">{error}</p>
            </div>
          ) : null}

          {!showSearchPrompt && !error ? (
            <div className="space-y-6">
              {/* BUY-63238: Removed the redundant 'Back to homepage' CTA from the
                  results header. The sticky header logo already provides homepage
                  navigation on every viewport, so the CTA was duplicating it in the
                  highest-value slot and (previously) pushed product cards below the
                  fold on mobile. Keep the result-count heading alone above the grid. */}
              <div className="hidden md:block">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                  {activeCountry.label}
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                  {loadingInitial ? (
                    <>
                      Searching catalog...
                      <span className="ml-2 animate-pulse text-lg leading-none">&bull;&bull;&bull;</span>
                    </>
                  ) : (
                    `${total.toLocaleString()} results for “${debouncedQuery}”`
                  )}
                </h1>
              </div>

              {loadingInitial ? (
                <>
                  <SearchProgressIndicator startedAt={searchStartTime ?? Date.now()} />
                  <SearchResultsSkeleton />
                </>
              ) : null}

              {showDegradedState ? (
                <div
                  role="status"
                  data-testid="search-degraded-banner"
                  className="rounded-[28px] border border-amber-300 bg-amber-50 p-8 shadow-sm"
                >
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Catalog update in progress</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                    Live results for “{debouncedQuery}” are temporarily unavailable
                  </h2>
                  <p className="mt-3 max-w-2xl text-slate-700">
                    {degradedHint
                      ? degradedHint
                      : 'Our catalog is being refreshed right now. Real product results will return once the update finishes.'}
                  </p>
                  <p className="mt-3 max-w-2xl text-sm text-slate-600">
                    Try a more specific query (add a brand, category, or model), pick a different country, or come back in a few minutes.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="/"
                      className="inline-flex min-h-[44px] items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                    >
                      Browse homepage
                    </Link>
                    <button
                      type="button"
                      onClick={() => runSearch(debouncedQuery)}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : null}

              {showEmptyState ? (
                <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm" data-testid="search-no-matches">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">No matches</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                    No products found for “{debouncedQuery}”
                  </h2>
                  <p className="mt-3 max-w-2xl text-slate-600">
                    Try a broader term, switch countries, or start with one of these popular searches.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTED_SEARCHES.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => runSearch(suggestion)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!loadingInitial && products.length > 0 ? (
                <>
                  <div
                    className="grid gap-3 sm:gap-4"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', maxWidth: '1200px' }}
                  >
                    {products.map((product) => (
                      <SearchCard key={product.id} product={product} />
                    ))}
                  </div>

                  {hasMore ? (
                    <div className="flex justify-center pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          const controller = new AbortController();
                          const nextOffset = offset + PAGE_SIZE;

                          void fetchResults({
                            mode: 'append',
                            cursor: nextCursor,
                            offsetValue: nextCursor ? undefined : nextOffset,
                            signal: controller.signal,
                          });
                        }}
                        disabled={loadingMore}
                        className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                      >
                        {loadingMore ? 'Loading more...' : 'Load more'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>

      <Footer />
    </div>
  );
}
