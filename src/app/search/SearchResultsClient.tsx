'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Search, X } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { MerchantBadge } from '@/components/ui/MerchantBadge';
import { PlatformChip } from '@/components/ui/PlatformChip';
import { CompareSelectButton } from '@/components/compare/CompareSelectButton';
import { ProductGridImage } from '@/components/seo/ProductGridImage';
import { openUpgradeIntentPrompt } from '@/lib/upgrade-intent-prompt';
import { attachProductCardClickAttribution, buildAffiliateRedirectUrl } from '@/lib/click-attribution';
import { SortDropdown, normalizeSortMode, type SortMode } from './SortDropdown';
import { FilterSidebar, type FacetOption } from './FilterSidebar';
import { FilterChipRow } from './FilterChipRow';
import { FilterBottomSheet } from './FilterBottomSheet';

const PAGE_SIZE = 20;
const SEARCH_FETCH_LIMIT = 40;
const MIN_QUERY_LENGTH = 2;
const SEARCH_HISTORY_KEY = 'bw_search_history';
const SEARCH_HISTORY_LIMIT = 8;
const SUGGESTED_SEARCHES = ['wireless headphones', 'running shoes', 'espresso machine', 'gaming laptop'];

// Exclude the currently-active query from the suggested-chips set so users
// never see a chip that would just resubmit the same search (dead-end UX).
// BUY-69618: case-insensitive + trim so "Gaming Laptop" / "  gaming laptop "
// both match a chip labeled "gaming laptop".
function filterSuggestedSearches(activeQuery: string): string[] {
  const needle = activeQuery.trim().toLowerCase();
  if (!needle) return SUGGESTED_SEARCHES;
  return SUGGESTED_SEARCHES.filter((suggestion) => suggestion.toLowerCase() !== needle);
}

const COUNTRY_OPTIONS = [
  { value: 'us', label: 'United States', apiValue: 'US', currency: 'USD' },
  { value: 'sg', label: 'Singapore', apiValue: 'SG', currency: 'SGD' },
] as const;

type CountryValue = (typeof COUNTRY_OPTIONS)[number]['value'];

type SearchResultsClientProps = {
  initialQuery?: string;
  initialCountry?: string;
  initialItems?: SearchApiItem[];
  initialTotal?: number;
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialDegraded?: boolean;
  initialDegradedHint?: string | null;
};

export type SearchApiItem = {
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
  // BUY-77675: forward category_path so the client-side category-mismatch
  // check can reason about products whose `category` column is null/empty
  // (e.g. SG laptops carried as `category_path:["home-living"]`).
  category_path?: string[] | null;
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
  merchantSlug?: string | null;
  source?: string | null;
  scrapedVia?: 'first_party' | 'affiliate' | 'aggregator' | string | null;
  imageUrl: string | null;
  href: string;
  brand: string | null;
  category: string | null;
  // BUY-77675: carry the API's category_path so `isCategoryMismatchedForDeviceQuery`
  // can see why a product was tagged (e.g. "home-living" vs. "laptop"). Empty array
  // means the API did not return one; normalized nulls are coerced to undefined.
  categoryPath?: string[] | null;
};

function normalizeCountry(value?: string): CountryValue {
  return value?.toLowerCase() === 'sg' ? 'sg' : 'us';
}

function getCountryOption(value: CountryValue) {
  return COUNTRY_OPTIONS.find((option) => option.value === value) ?? COUNTRY_OPTIONS[0];
}

// BUY-72907: Extract the actual retailer domain from product URLs.
// Prior behavior: badges showed "Shopify" / "Google Shopping" for ALL products
// from those platforms, even when the actual store was identifiable (e.g.
// a Wellbots product that happened to be on Shopify). Users saw platform names
// instead of the actual retailer, reducing trust in "View Deal" decisions.
//
// Fix: Parse the domain from product URLs as the primary merchant source,
// falling back to the existing merchant_name/merchant/source chain.
function extractMerchantFromUrl(url?: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Strip common subdomains and TLD suffixes to get the retailer's brand name.
    // Examples: "www.walmart.com" -> "walmart", "store.wellbots.com" -> "wellbots"
    const cleaned = hostname
      .replace(/^www\./, '')
      .replace(/^store\./, '')
      .replace(/^m\./, '')
      .replace(/\.com$/, '')
      .replace(/\.org$/, '')
      .replace(/\.net$/, '')
      .replace(/\.io$/, '')
      .replace(/\.ai$/, '');

    // Skip generic/captcha/tracking domains that aren't actual retailers.
    // BUY-72907: Also skip our own redirect domain - products with buywhere.ai
    // click/affiliate URLs should fall through to merchant_name/merchant/source.
    if (
      cleaned === 'google' ||
      cleaned === 'google shopping' ||
      cleaned === 'facebook' ||
      cleaned === 'instagram' ||
      cleaned === 'twitter' ||
      cleaned === 'linkedin' ||
      cleaned === 'click' ||
      cleaned === 'redirect' ||
      cleaned === 'track' ||
      cleaned === 'out' ||
      cleaned === 'go' ||
      cleaned === 'buywhere'
    ) {
      return null;
    }

    // Map known domain roots to their display names (handles non-standard casing).
    // "bestbuy.com" → "Best Buy", "homedepot.com" → "Home Depot", etc.
    const DOMAIN_DISPLAY: Record<string, string> = {
      bestbuy: 'Best Buy',
      homedepot: 'Home Depot',
      lowes: "Lowe's",
      bhphotovideo: "B&H",
      jet: 'Jet',
      macys: "Macy's",
      nordstrom: 'Nordstrom',
      kohls: "Kohl's",
    };
    if (DOMAIN_DISPLAY[cleaned]) {
      return DOMAIN_DISPLAY[cleaned];
    }

    // Title-case for display.
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return null;
  }
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

// BUY-72350: c1.neweggimages.com serves HTTP 400 (AkamaiGHost bot-detection)
// to ALL egress — referer-insensitive, reproduces from third-party IPs, and
// even the CDN host root 400s. Returning false here means imageUrl becomes
// null, so ProductGridImage short-circuits to BrandedPlaceholder WITHOUT
// ever emitting an <img> request.
//
// REGRESSION ALERT: 2d53dc31 (BUY-72387, 06:37Z) deleted this set while
// reframing root metadata. Do not remove it again. If you must touch
// `hasUsableProductImage`, preserve both this Set AND the BUY-71639
// last-segment sentinel check.
const SEARCH_IMAGE_BLOCKED_HOSTS = new Set([
  'c1.neweggimages.com',
  'www.neweggimages.com',
  'neweggimages.com',
  'images10.newegg.com',
  // BUY-72904: contents.mediadecathlon.com serves HTTP 410 (WediaGone) for deleted
  // or unavailable product assets. The server returns a 259-byte PNG placeholder.
  // Block at the host level — Decathlon product URLs are Wedia-based and can
  // become 410 at any time when inventory is retired.
  'contents.mediadecathlon.com',
  'www.contents.mediadecathlon.com',
]);

function hasUsableProductImage(value?: string | null) {
  if (!value) return false;

  try {
    const imageUrl = new URL(value);
    const hostname = imageUrl.hostname.toLowerCase();
    const pathname = imageUrl.pathname.toLowerCase();
    const search = imageUrl.search.toLowerCase();

    // BUY-72350: Newegg CDNs return HTTP 400 (AkamaiGHost) for every request.
    if (SEARCH_IMAGE_BLOCKED_HOSTS.has(hostname)) return false;

    // Block placeholder/sentinel hosts (we never serve these as real imagery).
    if (hostname.endsWith('unsplash.com') || hostname.endsWith('source.unsplash.com')) return false;

    // BUY-72693: reject ASIN-derived media keys on m.media-amazon.com.
    // Synthetic generators append the ASIN directly as the media key:
    //   https://m.media-amazon.com/images/I/B10162255701._AC_SY360_.jpg
    // where "B10162255701" is a 12-char string = ASIN + "01" suffix.
    // Real Amazon media keys are base64-encoded alphanumeric strings (e.g. "71jG+e7roXL").
    // Validate by checking the /images/I/<key> path segment: real keys are
    // alphanumeric+base64-safe (a-zA-Z0-9/+=) but DO NOT match the ASIN
    // pattern (uppercase B followed by exactly 10 digits, optionally +01).
    // This "fail-closed by shape" guard means ANY unknown CDN host already
    // fails by returning false — no host needs to be added to a blocklist.
    if (hostname === 'm.media-amazon.com' || hostname.endsWith('.media-amazon.com')) {
      const imgMatch = pathname.match(/^\/images\/i\/([^/.]+)\./);
      if (imgMatch) {
        const mediaKey = imgMatch[1];
        // Reject: B-prefixed numeric keys (ASIN-derived: B + ≥10 digits, + optional 2-digit suffix).
        // `pathname` was lowercased above, so match the lower-case shape here.
        if (/^b\d{10,}(?:_\d+)?$/.test(mediaKey)) return false;
      }
    }

    // BUY-71639: only block URLs whose FINAL segment is a sentinel filename —
    // the only shape a real CDN actually uses for a "no image" fallback asset.
    // Long descriptive slugs (`no-image-product`) resolve to a real file.
    const pathSegments = pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
    const base = lastSegment.replace(/\.[a-zA-Z0-9]+$/, '');
    if (/^(placeholder|image-unavailable|no[-_]?image|missing[-_]?image|generic|spacer|blank|fallback)([_-]\d+)?$/i.test(base)) return false;
    if (/\.(svg|gif)$/i.test(lastSegment)) return false;
    if (/[?&](placeholder|no[-_]?image|missing[-_]?image|generic|blank|fallback)=1/.test(search)) return false;

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
  // BUY-77675: 7 leak classes QA flagged on the SG laptop search:
  // Boya / lavalier mics, IEMs / headphones, laptop desks / standing desks,
  // portable monitors, privacy screens, keyboards (without laptop token),
  // and screen cleaners. Each is matched as a standalone token against the
  // title so a real laptop title (which never mentions these words) is
  // unaffected, while an accessory title like "Wireless Lavalier Microphone
  // for Laptop Recording" is demoted as an accessory.
  'microphone', 'microphones', 'mic', 'lavalier',
  'headphone', 'headphones', 'headset', 'headsets',
  'earbud', 'earbuds', 'earphone', 'earphones', 'earpiece', 'earpieces',
  'airpod', 'airpods', 'iem', 'iems',
  'desk', 'desks', 'standing desk', 'standing desks', 'sit-stand', 'sit stand',
  'portable monitor', 'portable monitors',
  'portable display', 'portable displays', 'second screen',
  'privacy screen', 'privacy filter', 'privacy filters',
  'screen protector', 'screen protectors', 'tempered glass',
  'cleaner', 'cleaners', 'wipes', 'cleaning kit', 'cleaning kits',
  'keyboard', 'keyboards', 'mechanical keyboard', 'mechanical keyboards',
  // BUY-77675 follow-up: the live API still leaks wireless mice and tempered
  // glass screen protectors into the top-20 because neither shares any of
  // the existing laptop-class signal — both reference "laptop" in the title
  // but are NOT laptops. "mouse" is word-bounded so model names like
  // "Mighty Mouse" still match (that's still an accessory) but "computer
  // mouse" (a phrase) is preserved via the multi-word "computer mouse".
  'mouse', 'mice', 'wireless mouse', 'bluetooth mouse', 'computer mouse',
  // BUY-77675 second follow-up: post-deploy probe of the SG laptop top-20
  // showed 4 power banks, 2 laptop holders, 1 riser still leaking through.
  // Power banks aren't strictly laptop-specific, but "Laptop Power Bank" /
  // "PowerBank" titles are accessory-shaped. Holders + risers are
  // ergonomic stands / furniture, not laptops. Each is multi-word where
  // possible to avoid false-positives on real laptop model names.
  'power bank', 'power banks', 'powerbank', 'powerbanks',
  'laptop holder', 'laptop holders',
  'riser', 'risers', 'laptop riser', 'laptop risers',
];

function isAccessoryProduct(product: SearchCardProduct): boolean {
  const titleLower = product.name.toLowerCase();

  // BUY-63738: Detect accessories (backpacks, skins, sleeves, etc.).
  // Strategy: products with accessory keywords are accessories UNLESS the title
  // is clearly a primary laptop/notebook/macbook product.
  // BUY-77675: word-bound every keyword so short stems like "mic" don't match
  // arbitrary substrings ("Mickey", "economic"). Multiword phrases like
  // "standing desk" stay as substring matches because the word-boundary regex
  // would over-anchor them (a title "Sit-Stand Desk" wouldn't match /\bstanding\b/
  // if "standing" is part of a hyphenated token).
  const keywordHit = ACCESSORY_KEYWORDS.reduce<{ idx: number; kw: string } | null>(
    (best, kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Word-bounded when the keyword contains a space, otherwise treat as a
      // word token. Hyphens collapse to whitespace so "sit-stand" matches.
      const pattern = /\s/.test(kw)
        ? escaped.replace(/-/g, '\\s?[\\-]?\\s?')
        : `\\b${escaped}\\b`;
      const match = new RegExp(pattern, 'i').exec(titleLower);
      if (!match) return best;
      if (best && match.index >= best.idx) return best;
      return { idx: match.index, kw };
    },
    null,
  );
  const hasAccessoryKeyword = keywordHit !== null;
  if (!hasAccessoryKeyword) return false;

  // If title contains "laptop" and the title STARTS with or centers on a real laptop
  // (not an accessory for laptop), it's a laptop product.
  // E.g., "ASUS TUF Gaming F16 Laptop Intel..." = laptop
  // E.g., "Backpack Gaming Backpack For Laptop" = accessory
  // E.g., "Robotic Doodle Laptop Skin" = accessory
  // E.g., "MacBook Pro Case Cover" = accessory

  // Heuristic: if accessory keyword appears BEFORE "laptop/notebook/macbook", it's an accessory
  const accessoryIdx = keywordHit!.idx;

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

// BUY-68365: Detect category-vs-query mismatch for complete-device queries.
// "Gaming laptop" should rank complete laptops, not "for Gaming PC Gaming Laptop"
// SSDs / cables / sleeves. The product's `category` field is the source of truth;
// the title is polluted by marketing copy that targets FTS tokens.
// Map each device-shaped query token to the canonical category strings that
// cover the device itself. A product whose category is set and does NOT match
// any of the allowed strings is considered a category mismatch.
const COMPLETE_DEVICE_TOKENS: Array<{ token: RegExp; allowedCategories: string[] }> = [
  {
    token: /\b(laptops?|notebooks?|macbooks?|chromebooks?|gaming\s+laptops?|ultrabooks?)\b/i,
    allowedCategories: [
      'laptops', 'laptop', 'notebooks', 'notebook', 'macbooks', 'macbook',
      'chromebooks', 'chromebook', 'ultrabooks', 'ultrabook', 'gaming laptops',
      'computers', 'computer', 'pc laptops', '2-in-1 laptops',
    ],
  },
  {
    token: /\b(phones?|smartphones?|iphones?|android\s+phones?|cell\s+phones?)\b/i,
    allowedCategories: [
      'smartphones', 'smartphone', 'mobile phones', 'mobile phone', 'cell phones',
      'cell phone', 'phones', 'phone', 'iphones', 'iphone', 'android phones',
      'unlocked phones', 'telephones',
    ],
  },
  {
    token: /\b(monitors?|displays?|computer\s+monitors?)\b/i,
    allowedCategories: [
      'monitors', 'monitor', 'computer monitors', 'computer monitor',
      'displays', 'display', 'monitors & displays',
    ],
  },
  {
    token: /\b(televisions?|tvs?|smart\s+tvs?)\b/i,
    allowedCategories: [
      'televisions', 'television', 'tvs', 'tv', 'smart tvs', 'smart tv',
      'tv, video & home audio',
    ],
  },
  {
    token: /\b(playstations?|xbox(es)?|nintendo\s+switch|consoles?)\b/i,
    allowedCategories: [
      'playstation', 'xbox', 'nintendo switch', 'nintendo', 'video game consoles',
      'game consoles', 'consoles',
    ],
  },
  {
    token: /\b(refrigerators?|fridges?|freezers?)\b/i,
    allowedCategories: [
      'refrigerators', 'refrigerator', 'fridges', 'freezers', 'freezer',
      'appliances', 'major appliances',
    ],
  },
  {
    token: /\b(dishwashers?)\b/i,
    allowedCategories: [
      'dishwashers', 'dishwasher', 'appliances', 'major appliances',
    ],
  },
];

function isCategoryMismatchedForDeviceQuery(query: string, product: SearchCardProduct): boolean {
  // BUY-77675: also fold `category_path` into the category check so products
  // whose `category` is null (or generic like "home-living") but whose category
  // path is clearly non-laptop still get flagged. The path is the structural
  // signal — "home-living" or "fashion" never contains a laptop-class term,
  // so a path of `["home-living"]` with no `category` is still a mismatch.
  const categoryLower = (product.category ?? '').toLowerCase();
  const pathLower = (product.categoryPath ?? [])
    .map((segment) => segment.toLowerCase())
    .join(' ');
  const categoryComposite = [categoryLower, pathLower].filter(Boolean).join(' ');
  if (!categoryComposite) return false; // no category signal → let other heuristics decide
  const queryLower = query.toLowerCase();
  for (const { token, allowedCategories } of COMPLETE_DEVICE_TOKENS) {
    if (!token.test(queryLower)) continue;
    const match = allowedCategories.some((allowed) => categoryComposite.includes(allowed));
    if (!match) return true;
  }
  return false;
}

function rankProduct(product: SearchCardProduct, query: string = ''): number {
  let score = 0;
  // Has usable image
  if (product.imageUrl) score += 100;
  // Has valid price
  if (product.price !== null) score += 50;
  // Not an accessory
  if (!isAccessoryProduct(product)) score += 25;
  // BUY-68365: Demote category-vs-query mismatches on complete-device queries.
  // A "Storage" SSD must not rank among the top "gaming laptop" results even
  // when the marketing title contains "for Gaming PC Gaming Laptop Desktop".
  if (query && isCategoryMismatchedForDeviceQuery(query, product)) score -= 500;
  return score;
}

function sortProductsByRelevance(products: SearchCardProduct[], query: string = '') {
  return [...products].sort((leftProduct, rightProduct) => {
    const leftScore = rankProduct(leftProduct, query);
    const rightScore = rankProduct(rightProduct, query);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return 0;
  });
}

// BUY-75939: client-side sort modes. Sort is applied AFTER filter (so the user
// sees a stable, expected order within their filtered subset). The sort does
// NOT mutate `products` — it always returns a new array.
//
// Each mode falls back to relevance ranking as the secondary key so the order
// stays sensible when the primary key is missing (e.g. a "Newest" sort with no
// timestamp on a row, or a price sort where some rows have `price = null` —
// those always sink to the bottom of price sorts, matching every
// price-comparison site).
function compareByPriceAsc(left: SearchCardProduct, right: SearchCardProduct): number {
  if (left.price === null && right.price === null) return 0;
  if (left.price === null) return 1;
  if (right.price === null) return -1;
  return left.price - right.price;
}

function compareByPriceDesc(left: SearchCardProduct, right: SearchCardProduct): number {
  if (left.price === null && right.price === null) return 0;
  if (left.price === null) return 1;
  if (right.price === null) return -1;
  return right.price - left.price;
}

function compareByMerchantAsc(left: SearchCardProduct, right: SearchCardProduct): number {
  const leftName = left.merchant || '';
  const rightName = right.merchant || '';
  return leftName.localeCompare(rightName);
}

// BUY-75939: the product shape does not carry a creation/indexed timestamp.
// We deliberately keep "Newest" as a no-op fallback to relevance ranking (the
// sort dropdown still lists it so QA can confirm the option exists, but the
// order is whatever the API returned). When the catalog ingest lane starts
// emitting a timestamp on each row, swap the comparator in place here — the
// public SortMode value stays the same.
function compareByNewest(
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  _left: SearchCardProduct,
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  _right: SearchCardProduct,
): number {
  return 0;
}

export function applyProductSort(
  products: SearchCardProduct[],
  mode: SortMode,
  query: string = ''
): SearchCardProduct[] {
  const base = sortProductsByRelevance(products, query);
  if (mode === 'relevance') return base;
  if (mode === 'price_asc') {
    return [...base].sort((left, right) => {
      const cmp = compareByPriceAsc(left, right);
      return cmp !== 0 ? cmp : rankProduct(right, query) - rankProduct(left, query);
    });
  }
  if (mode === 'price_desc') {
    return [...base].sort((left, right) => {
      const cmp = compareByPriceDesc(left, right);
      return cmp !== 0 ? cmp : rankProduct(right, query) - rankProduct(left, query);
    });
  }
  if (mode === 'merchant_asc') {
    return [...base].sort((left, right) => {
      const cmp = compareByMerchantAsc(left, right);
      return cmp !== 0 ? cmp : rankProduct(right, query) - rankProduct(left, query);
    });
  }
  if (mode === 'newest') {
    return [...base].sort((left, right) => {
      const cmp = compareByNewest(left, right);
      return cmp !== 0 ? cmp : rankProduct(right, query) - rankProduct(left, query);
    });
  }
  return base;
}

export type FilterState = {
  brands: string[];
  merchants: string[];
  priceMin: number | null;
  priceMax: number | null;
};

// BUY-75939: client-side filter applied AFTER the API returned its page of
// products. Filter does NOT mutate the input array. Each filter type is
// applied independently so the predicate order does not change the result:
//   - brand match: case-insensitive equality against the derived brand
//   - merchant match: case-insensitive equality against the formatted merchant
//     name (the same string rendered on the card so users can predict the
//     outcome)
//   - price range: a row with `price === null` is always excluded from any
//     bounded price filter (the user is asking for products IN that range;
//     unknown-price rows do not satisfy the contract). Rows with `price`
//     inside [min, max] survive.
export function applyProductFilters(
  products: SearchCardProduct[],
  filters: FilterState
): SearchCardProduct[] {
  const brandSet = new Set(filters.brands.map((brand) => brand.toLowerCase()));
  const merchantSet = new Set(filters.merchants.map((merchant) => merchant.toLowerCase()));

  return products.filter((product) => {
    if (brandSet.size > 0) {
      const brand = (product.brand || '').toLowerCase();
      if (!brandSet.has(brand)) return false;
    }

    if (merchantSet.size > 0) {
      const merchant = (product.merchant || '').toLowerCase();
      if (!merchantSet.has(merchant)) return false;
    }

    if (filters.priceMin !== null || filters.priceMax !== null) {
      if (product.price === null) return false;
      if (filters.priceMin !== null && product.price < filters.priceMin) return false;
      if (filters.priceMax !== null && product.price > filters.priceMax) return false;
    }

    return true;
  });
}

// BUY-75939: derive brand/merchant facet lists from the current products
// array. Counts reflect the FULL product set, NOT the active filter — that
// is the standard comparison-site behaviour (Amazon's left rail, Best Buy's
// facet sidebar, etc.) and what QA expects. Sorted alphabetically by label so
// the order is stable across renders and easy to scan.
export function deriveFacets(products: SearchCardProduct[]): {
  brandFacets: FacetOption[];
  merchantFacets: FacetOption[];
} {
  const brandMap = new Map<string, { label: string; count: number }>();
  const merchantMap = new Map<string, { label: string; count: number }>();

  for (const product of products) {
    if (product.brand) {
      const key = product.brand.toLowerCase();
      const existing = brandMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        brandMap.set(key, { label: product.brand, count: 1 });
      }
    }
    if (product.merchant) {
      const key = product.merchant.toLowerCase();
      const existing = merchantMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        merchantMap.set(key, { label: product.merchant, count: 1 });
      }
    }
  }

  const sortByLabel = (left: FacetOption, right: FacetOption) =>
    left.label.localeCompare(right.label);

  const brandFacets: FacetOption[] = Array.from(brandMap.entries())
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((left, right) => sortByLabel(left, right));

  const merchantFacets: FacetOption[] = Array.from(merchantMap.entries())
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((left, right) => sortByLabel(left, right));

  return { brandFacets, merchantFacets };
}

function parsePriceValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

// BUY-75939: parse the URL params for brand and merchant. Each value can be
// either a single value (`?brand=Apple`) or repeated (`?brand=Apple&brand=Sony`)
// — both shapes come from forms. Empty strings, single-char inputs, and
// surroundings whitespace are dropped so a stray `?brand=&brand=Apple` does
// not leak an empty facet into the sidebar.
function parseListParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// BUY-75939: shallow equality for the URL-read effect. Order-sensitive: when
// the URL lists `Apple,Sony` and the state has `Sony,Apple`, this returns
// false so the effect restores the URL order. The current UI presents brands
// alphabetically so the order is stable in practice.
function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}


// BUY-67977: derive a brand from the product title when the API did not
// supply one. The catalog ingest lane (BUY-52807 family) leaves `brand` and
// `metadata.brand` blank for the vast majority of products, but every
// product title begins with the brand (e.g. "JBL Everest 310…",
// "Sony MDR-100ABN/B…", "Beats by Dr. Dre Solo3…"). Without a derived brand,
// only the small minority of rows that happen to carry `metadata.category`
// render any subtitle line — which broke grid-row visual alignment. We use
// the first leading token(s) that look brand-shaped: starts with a letter,
// is not all-digits, and is not a generic product noun ("Wireless",
// "Headphones", "Ear", "ANC", "Pro", …).
//
// We deliberately keep the heuristic conservative so it never invents a brand
// from a generic noun like "Studio" or "Premium" — when the first token is
// ambiguous we return null and let the reserved slot render empty (PR #431's
// `min-h-[1.25rem]` keeps row alignment either way).
const TITLE_BRANDS_BLOCKLIST = new Set([
  // Product categories / descriptors.
  'wireless', 'bluetooth', 'headphones', 'headphone', 'earbuds', 'earbud',
  'ear', 'earpiece', 'over-ear', 'on-ear', 'in-ear', 'over',
  // BUY-77666: Category terms that leak into brand facet when they appear
  // as the first word in titles like "Laptop - Brand New 15.6 inch..."
  'laptop', 'laptops', 'notebook', 'notebooks', 'macbook', 'macbooks',
  'chromebook', 'chromebooks', 'desktop', 'desktops', 'computer', 'computers',
  'gaming', 'game', 'games', 'gamer',
  'mobile', 'phone', 'phones', 'smartphone', 'smartphones', 'iphone',
  'tablet', 'tablets', 'ipad',
  'portable', 'monitor', 'monitors', 'display', 'displays', 'screen', 'screens',
  'keyboard', 'keyboards', 'mouse', 'mices', 'mousepad', 'speaker', 'speakers',
  'camera', 'cameras', 'drone', 'drones', 'watch', 'watches', 'band', 'bands',
  'headset', 'headsets', 'earphone', 'earphones', 'charger', 'chargers',
  'cable', 'cables', 'adapter', 'adapters', 'hub', 'hubs', 'dock', 'docks',
  'stand', 'stands', 'mount', 'mounts', 'case', 'cases', 'cover', 'covers',
  'sleeve', 'sleeves', 'skin', 'skins', 'pad', 'pads', 'mat', 'mats',
  'bag', 'bags', 'backpack', 'backpacks', 'pouch', 'pouches',
  'toy', 'toys', 'gift', 'gifts', 'set', 'sets', 'kit', 'kits',
  'pack', 'packs', 'bundle', 'bundles', 'combo', 'combos',
  // Marketing / quality adjectives.
  'new', 'premium', 'pro', 'plus', 'mini', 'max', 'ultra', 'lite',
  'anc', 'hifi', 'hi-fi', 'stereo', 'mono', 'noise', 'cancelling',
  'cancellation', 'portable', 'foldable', 'folding',
  'studio', 'series', 'version', 'generation', 'gen', 'model',
  'official', 'original', 'authentic', 'genuine', 'brand', 'newest',
  'latest', 'best', 'top', 'quality', 'high', 'low', 'cheap', 'expensive',
  'free', 'shipping', 'sale', 'discount', 'limited', 'edition',
  'special', 'classic', 'deluxe', 'standard', 'edition',
  // Connectivity / port descriptors.
  'usb', 'usb-c', 'type-c', 'wired', 'cordless', 'rechargeable',
  // Colors / finishes — never a real brand when it appears as a leading token.
  'black', 'white', 'blue', 'red', 'green', 'yellow', 'pink', 'purple',
  'orange', 'grey', 'gray', 'silver', 'gold', 'rose', 'midnight',
  'space', 'starlight', 'graphite', 'natural', 'matte', 'glossy',
  // Common English function / generic words that show up as leading tokens
  // in generic, brand-less titles.
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'from', 'in', 'on',
  'at', 'by', 'of', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  // Single letters (rejected here so we don't pick them up after skipping
  // other tokens; the length check in isLikelyBrandToken also enforces this).
  'x', 'i',
]);

function isLikelyBrandToken(token: string): boolean {
  if (!token) return false;
  // Strip leading/trailing punctuation EXCEPT internal periods ("Dr.", "Inc.").
  // We deliberately keep periods so "Dr." survives into the candidate.
  const cleaned = token.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, '');
  if (!cleaned) return false;
  // Must start with a letter.
  if (!/^[A-Za-z]/.test(cleaned)) return false;
  // Require at least 2 characters so single-letter shapes like "X" are
  // rejected (those are usually model numbers, not brand names).
  if (cleaned.length < 2) return false;
  // Reject all-digit tokens (model numbers).
  if (/^\d+$/.test(cleaned)) return false;
  // Reject tokens that look like model numbers: contain a digit within 4 chars
  // of the start (e.g. "W820Nb", "WH-1000XM5", "MTU02LL/A").
  if (/^[A-Za-z]*\d/.test(cleaned) && cleaned.length <= 12) return false;
  // Reject generic product nouns.
  if (TITLE_BRANDS_BLOCKLIST.has(cleaned.toLowerCase())) return false;
  // Reject function words.
  if (/^(by|for|of|and|with|to|from|the|a|an)$/i.test(cleaned)) return false;
  return true;
}

// BUY-67977: Multi-word brand extraction for titles like
// "Beats by Dr. Dre Solo3 Wireless Headphones" → "Beats by Dr. Dre"
// "Audio-Technica ATH-CKS50TW2 Wireless Headphones" → "Audio-Technica"
// "JBL Everest 310 On-Ear Wireless Headphones" → "JBL"
//
// Rules:
//   - Take the first leading token that passes isLikelyBrandToken.
//   - If the next token is "by" and the token after is a brand-shaped
//     capitalized word, keep "First by Brand" up to two more title-cased
//     tokens (matches "Beats by Dr. Dre" exactly).
//   - Otherwise the brand is just the first token.
function deriveBrandFromTitle(title: string | null | undefined): string | null {
  if (!title || typeof title !== 'string') return null;
  const tokens = title.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Strip surrounding punctuation but PRESERVE internal periods so
  // "Dr." survives into the candidate string ("Beats by Dr. Dre").
  const clean = (s: string): string => s.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, '');

  // Find the first brand-shaped token.
  let idx = 0;
  while (idx < tokens.length && !isLikelyBrandToken(clean(tokens[idx]))) {
    idx += 1;
  }
  if (idx >= tokens.length) return null;

  // Handle "First by Brand Name" pattern (e.g. "Beats by Dr. Dre").
  // We only extend when the next token is exactly "by" (case-insensitive) and
  // the token after that is also brand-shaped — caps to 3 total tokens so we
  // never span onto a model number or product noun.
  let endIdx = idx + 1;
  const next = clean(tokens[idx + 1] ?? '').toLowerCase().replace(/\.$/, '');
  if (next === 'by' && tokens[idx + 2] && isLikelyBrandToken(clean(tokens[idx + 2]))) {
    const afterBy2 = clean(tokens[idx + 3] ?? '');
    endIdx = idx + 3; // include "by Brand"
    // Optional fourth token if also brand-shaped (e.g. "Beats by Dr. Dre").
    if (
      afterBy2 &&
      isLikelyBrandToken(afterBy2) &&
      // Don't extend if the fourth token would cross into a model-number zone.
      !/\d/.test(afterBy2)
    ) {
      endIdx = idx + 4;
    }
  }

  const candidate = tokens.slice(idx, endIdx).map(clean).filter(Boolean).join(' ');
  if (!candidate || candidate.length > 32) return null;
  return candidate;
}

function normalizeProduct(item: SearchApiItem, fallbackCurrency: string): SearchCardProduct {
  const priceValue =
    item.price && typeof item.price === 'object' && 'amount' in item.price
      ? item.price.amount
      : item.price_amount ?? item.price;
  const numericPrice =
    typeof priceValue === 'number'
      ? priceValue
      : typeof priceValue === 'string' && priceValue.trim()
        ? Number(priceValue)
        : null;
  const specs = item.structured_specs || item.metadata || null;
  // BUY-77666: validate specBrand with isLikelyBrandToken so category terms,
  // common words, model numbers, and other garbage values stored in
  // metadata.brand (e.g. "Laptop", "Mobile", "Gaming", "Portable", "2025",
  // "in", "Rechargeable") do NOT leak into the brand facet. The blocklist
  // check happens inside deriveBrandFromTitle for title-derived brands
  // already; specBrand needs the same gate.
  const rawSpecBrand = typeof specs?.brand === 'string' ? specs.brand : null;
  const specBrand =
    rawSpecBrand && isLikelyBrandToken(rawSpecBrand) ? rawSpecBrand : null;
  // BUY-77666: top-level `item.brand` from upstream may also be a category
  // noun in scrapers that do not run the blocklist. Validate it too.
  const rawItemBrand = typeof item.brand === 'string' ? item.brand : null;
  const validatedItemBrand =
    rawItemBrand && isLikelyBrandToken(rawItemBrand) ? rawItemBrand : null;
  const specCategory = typeof specs?.category === 'string' ? specs.category : null;
  const imageUrl = hasUsableProductImage(item.image_url)
    ? item.image_url || null
    : hasUsableProductImage(item.image)
      ? item.image || null
      : null;

  const name = item.name || item.title || 'Untitled product';
  const category = item.category || specCategory;
  const finitePrice = Number.isFinite(numericPrice) ? numericPrice : null;

  // BUY-74691: capture merchant_slug + scraped_via from the API row.
  // merchant_slug is the kebab-case key used by MERCHANT_CONFIG; scraped_via
  // gates the verified-mark logic on MerchantBadge.
  const merchantSlug = (item as Record<string, unknown>).merchant_slug as string | null | undefined
    ?? (typeof item.merchant_name === 'string'
      ? item.merchant_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : null);
  const scrapedVia = (item as Record<string, unknown>).scraped_via as
    | 'first_party' | 'affiliate' | 'aggregator' | string | null | undefined
    ?? null;

  return {
    id: String(item.id),
    name,
    // BUY-65559: drop implausible sentinel prices to null so the card renders
    // "Price unavailable" instead of a fabricated "$1.00" / "$0.00".
    price: isPlausiblePrice(finitePrice, { name, category }) ? finitePrice : null,
    // BUY-71638: always store the selected-country display currency so the card
    // formats in the user's chosen country even when the API returned a row
    // whose source-row currency was different (e.g. an SGD-priced Newegg-ish
    // ingest row leaking into a US country filter). The numeric value is NOT
    // FX-converted — only the displayed currency code tracks the selected
    // country, matching the QA acceptance criterion for f369fdc9.
    currency: fallbackCurrency,
    // BUY-72907: prefer the domain extracted from the product URL (the actual
    // retailer the user would visit) over the platform-level merchant/source
    // field. A Wellbots product scraped via Shopify should show "Wellbots" from
    // its URL, not "Shopify" from its source field. Falls back to the legacy
    // chain so rows without a usable URL are unaffected; MerchantBadge performs
    // a second cleanup pass for platform/source fallbacks like "Decathlon Sg".
    merchant: formatMerchantName(
      extractMerchantFromUrl(item.affiliate_redirect_url) ||
      extractMerchantFromUrl(item.click_url) ||
      extractMerchantFromUrl(item.affiliate_url) ||
      extractMerchantFromUrl(item.buy_url) ||
      item.merchant_name ||
      item.merchant ||
      item.source
    ),
    // BUY-74691: forward merchant_slug + scraped_via so MerchantBadge can
    // resolve richer config and PlatformChip can render the platform line.
    merchantSlug,
    scrapedVia,
    source: item.source ?? null,
    imageUrl,
    // BUY-77675: forward the API's category_path so the FE mismatch check can
    // still rank-evaluate a product whose `category` is empty/null. Arrays of
    // empty/blank segments are dropped so the join path stays clean.
    categoryPath: Array.isArray(item.category_path)
      ? item.category_path.map((segment) => String(segment ?? '').trim()).filter(Boolean)
      : null,
    // BUY-75417: prefer /r/direct/{id} for server-rendered crawlers, fall
    // back to the API affiliate redirect, then click_url, etc.
    href: buildAffiliateRedirectUrl(item.id)
      || item.affiliate_redirect_url
      || item.click_url
      || item.affiliate_url
      || item.buy_url
      || item.url
      || '#',
    // BUY-67977: derive brand from the title when the API does not provide
    // one, so the meta slot renders a consistent brand line across all cards
    // in a grid row (rather than only the rare rows where the ingest lane
    // populated `metadata.brand`).
    // BUY-77666: use the validated brand values so scrapers that wrote
    // category terms ("Laptop", "Mobile", "Gaming", "Portable", "2025",
    // "in", "Rechargeable") into metadata.brand do not leak into the facet.
    brand:
      validatedItemBrand ||
      specBrand ||
      deriveBrandFromTitle(name),
    category,
  };
}

// BUY-65559: exported for the price-sanity regression test.
// BUY-68365: also exported for the category-mismatch regression test.
// BUY-67977: also exported for the brand-derivation regression test.
// BUY-71639: exported for the image-filter regression test.
// BUY-72907: exported for the merchant-URL regression test.
// BUY-75939: also exported for the sort/filter/facet regression tests.
export const __test__ = {
  isPlausiblePrice,
  formatPrice,
  normalizeProduct,
  rankProduct,
  sortProductsByRelevance,
  isAccessoryProduct,
  isCategoryMismatchedForDeviceQuery,
  deriveBrandFromTitle,
  hasUsableProductImage,
  extractMerchantFromUrl,
  applyProductSort,
  applyProductFilters,
  deriveFacets,
  parsePriceValue,
  parseListParam,
  areStringArraysEqual,
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
      // BUY-75947: auto-fill minmax(220px,1fr) adapts to container width; matches live grid (line 1649)
      className="grid max-w-full gap-3 sm:gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
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


function SearchCard({ product, currency }: { product: SearchCardProduct; currency: string }) {
  return (
    <a
      data-testid="search-product-card"
      href={product.href}
      onClick={attachProductCardClickAttribution}
      target="_blank"
      rel="noopener noreferrer nofollow sponsored"
      aria-label={`View deal: ${product.name} from ${product.merchant}`}
      className="group relative flex h-full min-h-[460px] min-w-0 flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div
        // BUY-75930: unified bg-white frame with image container (was bg-slate-100 + white image = mismatch)
        className="relative w-full max-h-[220px] shrink-0 overflow-hidden border-b border-slate-100 bg-white"
        style={{ aspectRatio: '4/3', maxHeight: '220px' }}
        data-testid="search-product-media"
      >
        <ProductGridImage
          src={product.imageUrl || ''}
          alt={product.name}
          brand={product.brand}
          merchant={product.merchant}
          category={product.category}
          className="relative z-10 block h-full w-full max-h-[220px] max-w-full object-contain p-2"
        />
        <div className="absolute right-2 top-2 z-20">
          <CompareSelectButton product={product} className="h-9 w-9" />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2.5 bg-white p-3.5" data-testid="search-product-details">
        {/* BUY-68743: drop the redundant "Shop ↗" pill — the merchant name
            and verified checkmark are already conveyed by MerchantBadge on the
            left, and the whole card wraps the deal URL, so a second visual CTA
            at the top competed with the primary "View Deal" button below.
            Keep MerchantBadge informational and View Deal the single CTA.
            BUY-74691: add PlatformChip beneath the badge so the platform
            provenance (Shopify / Shopee SG / Amazon SG) is visible but
            visually subordinate — the merchant_name remains the primary signal. */}
        <div className="flex min-h-7 flex-col items-start gap-0.5">
          <MerchantBadge
            merchant={product.merchant}
            merchantSlug={product.merchantSlug}
            scrapedVia={product.scrapedVia}
            className="min-w-0"
          />
          <PlatformChip source={product.source} />
        </div>

        <div className="space-y-1.5">
          <h2
            // BUY-75930: break-words prevents mid-specifier truncation like "2.4GH..."
            className="line-clamp-2 break-words text-base font-semibold leading-snug text-slate-950 transition-colors group-hover:text-amber-700"
            title={product.name}
            aria-label={product.name}
          >
            {product.name}
          </h2>
          {/* BUY-67977: reserve a single-line slot so cards with no brand/category
              don't collapse to 0 height and break grid row alignment. */}
          <div className="flex min-h-[1.25rem] flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
            {product.brand ? <span className="line-clamp-1">{product.brand}</span> : null}
            {product.category ? <span className="line-clamp-1">{product.category}</span> : null}
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
            {/* BUY-71638: use the Selected-country currency for display, not the
                per-item source currency. The QA repro (f369fdc9) was a US
                filter showing SGD/INR/TRY prices because each row rendered
                its own currency. */}
            <p className="text-xl font-bold tracking-tight text-slate-950">{formatPrice(product.price, currency)}</p>
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
  initialItems = [],
  initialTotal = 0,
  initialHasMore = false,
  initialNextCursor = null,
  initialDegraded = false,
  initialDegradedHint = null,
}: SearchResultsClientProps) {
  const initialSearchQuery = initialQuery.trim();
  const hasInitialSearchQuery = initialSearchQuery.length >= MIN_QUERY_LENGTH;
  const initialCountryValue = normalizeCountry(initialCountry);
  const initialCountryOption = getCountryOption(initialCountryValue);
  const initialProducts = useMemo(
    () => sortProductsByRelevance(
      initialItems.map((item) => normalizeProduct(item, initialCountryOption.currency)),
      initialSearchQuery
    ).slice(0, PAGE_SIZE),
    [initialCountryOption.currency, initialItems, initialSearchQuery]
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() ?? '';
  const urlSearchParams = useMemo(() => new URLSearchParams(searchParamsString), [searchParamsString]);
  const [isNavigating, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [country, setCountry] = useState<CountryValue>(initialCountryValue);
  const [debouncedQuery, setDebouncedQuery] = useState(initialSearchQuery);
  const [products, setProducts] = useState<SearchCardProduct[]>(initialProducts);
  const [total, setTotal] = useState(initialTotal || initialProducts.length);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [offset, setOffset] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(hasInitialSearchQuery && initialProducts.length === 0);
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(initialDegraded);
  const [degradedHint, setDegradedHint] = useState<string | null>(initialDegradedHint);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);
  const [hasHydrated, setHasHydrated] = useState(false);
  // BUY-75939: sort dropdown + brand/merchant/price-range filters. State is
  // initialized from `urlSearchParams` so a deep-linked URL like
  // /search?q=laptop&sort=price_asc&brand=Apple&price_min=50 renders with
  // the correct selections already applied. State writes back to the URL
  // through the effect below — the round-trip stays inside one place
  // (urlSearchParams -> setSort/setFilters -> effect -> router.replace()).
  const initialSort = normalizeSortMode(searchParams?.get('sort'));
  const initialBrandParams = searchParams?.get('brand');
  const initialMerchantParams = searchParams?.get('merchant');
  const initialPriceMin = searchParams?.get('price_min') ?? '';
  const initialPriceMax = searchParams?.get('price_max') ?? '';
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(() =>
    parseListParam(initialBrandParams)
  );
  const [selectedMerchants, setSelectedMerchants] = useState<string[]>(() =>
    parseListParam(initialMerchantParams)
  );
  const [priceMin, setPriceMin] = useState<string>(initialPriceMin);
  const [priceMax, setPriceMax] = useState<string>(initialPriceMax);
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false);
  const lastRequestKeyRef = useRef<string | null>(null);
  const initialResultsServedRef = useRef(initialProducts.length > 0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFieldRef = useRef<HTMLLabelElement>(null);
  // BUY-75939: track the last URL we wrote so the URL-read effect knows to
  // ignore URLs that match our own write (otherwise a click that fires
  // setSelectedBrands would race with the URL-write effect and the URL-read
  // effect could reset the brand back to the URL's value, which was the
  // pre-click state).
  const lastWrittenSearchParamsRef = useRef<string>(searchParamsString);

  // Track hydration state to avoid server/client mismatch
  useEffect(() => {
    setHasHydrated(true);
  }, []);

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
    // BUY-75939: bail out when the URL matches our own write — otherwise a
    // user click (e.g. checkbox toggle) would race the URL-write effect and
    // the URL-read effect could reset the local state back to the pre-click
    // URL value, dropping the click. Only genuine external URL changes
    // (browser back/forward, a deep-link) flow through.
    if (searchParamsString === lastWrittenSearchParamsRef.current) {
      return;
    }

    const nextQuery = (urlSearchParams.get('q') || '').trim();
    const nextCountry = normalizeCountry(urlSearchParams.get('country') || initialCountry);
    // BUY-75939: read sort + filter state from the URL so back/forward
    // navigation and any external link to /search?... restores the user's
    // filters. `areStringArraysEqual` does shallow set-comparison so a no-op
    // URL change (e.g. trailing-swap toggle order) does not re-render.
    const nextSort = normalizeSortMode(urlSearchParams.get('sort'));
    const nextBrands = parseListParam(urlSearchParams.get('brand'));
    const nextMerchants = parseListParam(urlSearchParams.get('merchant'));
    const nextPriceMin = urlSearchParams.get('price_min') ?? '';
    const nextPriceMax = urlSearchParams.get('price_max') ?? '';

    if (nextQuery !== query) {
      setQuery(nextQuery);
      setDebouncedQuery(nextQuery);
    }

    if (nextCountry !== country) {
      setCountry(nextCountry);
    }

    if (nextSort !== sortMode) {
      setSortMode(nextSort);
    }

    if (!areStringArraysEqual(nextBrands, selectedBrands)) {
      setSelectedBrands(nextBrands);
    }

    if (!areStringArraysEqual(nextMerchants, selectedMerchants)) {
      setSelectedMerchants(nextMerchants);
    }

    if (nextPriceMin !== priceMin) {
      setPriceMin(nextPriceMin);
    }

    if (nextPriceMax !== priceMax) {
      setPriceMax(nextPriceMax);
    }

    // Mark this URL as already consumed so a re-render with the same
    // searchParams does not re-run the same assignments.
    lastWrittenSearchParamsRef.current = searchParamsString;
  }, [country, initialCountry, priceMax, priceMin, query, searchParamsString, selectedBrands, selectedMerchants, sortMode, urlSearchParams]);

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
    // BUY-75939: serialize filter state into the URL so the browser back button
    // and any shared link restores the exact state. Empty / default values are
    // omitted so a default view keeps the URL clean.
    if (sortMode !== 'relevance') {
      params.set('sort', sortMode);
    }
    if (selectedBrands.length > 0) {
      params.set('brand', selectedBrands.join(','));
    }
    if (selectedMerchants.length > 0) {
      params.set('merchant', selectedMerchants.join(','));
    }
    if (priceMin.trim()) {
      params.set('price_min', priceMin.trim());
    }
    if (priceMax.trim()) {
      params.set('price_max', priceMax.trim());
    }

    const nextQueryString = params.toString();
    const currentQueryString = urlSearchParams.toString();

    if (nextQueryString !== currentQueryString) {
      lastWrittenSearchParamsRef.current = nextQueryString;
      startTransition(() => {
        router.replace(nextQueryString ? `/search?${nextQueryString}` : '/search', { scroll: false });
      });
    }
  }, [country, debouncedQuery, priceMax, priceMin, router, selectedBrands, selectedMerchants, sortMode, urlSearchParams]);

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
        rawItems.map((item) => normalizeProduct(item, activeCountry.currency)),
        query
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
    if (initialResultsServedRef.current) {
      initialResultsServedRef.current = false;
      return;
    }

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

  // BUY-75939: derive the current filter state once and reuse it for the
  // filtered list, the active-filter chips, and the empty-state counter.
  // `parsePriceValue` returns null for invalid inputs so a typo like "abc"
  // in the price field never crashes the filter and just renders as no
  // price filter active.
  const filterState = useMemo<FilterState>(
    () => ({
      brands: selectedBrands,
      merchants: selectedMerchants,
      priceMin: parsePriceValue(priceMin),
      priceMax: parsePriceValue(priceMax),
    }),
    [priceMax, priceMin, selectedBrands, selectedMerchants]
  );

  const filteredProducts = useMemo(
    () => applyProductFilters(products, filterState),
    [filterState, products]
  );

  const sortedFilteredProducts = useMemo(
    () => applyProductSort(filteredProducts, sortMode, debouncedQuery),
    [debouncedQuery, filteredProducts, sortMode]
  );

  // Facets are derived from the FULL products array (not the filtered
  // subset) per the standard comparison-site behaviour described on
  // `deriveFacets`.
  const facets = useMemo(() => deriveFacets(products), [products]);

  const hasActiveFilters =
    filterState.brands.length > 0 ||
    filterState.merchants.length > 0 ||
    filterState.priceMin !== null ||
    filterState.priceMax !== null;

  const totalActiveFilterCount =
    (filterState.brands.length > 0 ? 1 : 0) +
    (filterState.merchants.length > 0 ? 1 : 0) +
    (filterState.priceMin !== null || filterState.priceMax !== null ? 1 : 0);

  // Active-filter chip descriptors for the sidebar and mobile chip row.
  // Each `onClear` toggles state back to its empty / default value.
  const activePriceChip = useMemo(() => {
    if (filterState.priceMin === null && filterState.priceMax === null) return null;
    const minLabel = filterState.priceMin !== null ? `${activeCountry.currency === 'SGD' ? 'S$' : '$'}${filterState.priceMin}` : '';
    const maxLabel = filterState.priceMax !== null ? `${activeCountry.currency === 'SGD' ? 'S$' : '$'}${filterState.priceMax}` : '';
    const parts = [minLabel, maxLabel].filter(Boolean);
    return { label: parts.join('–'), onClear: () => { setPriceMin(''); setPriceMax(''); } };
  }, [filterState.priceMax, filterState.priceMin, activeCountry.currency]);

  const activeBrandChips = useMemo(
    () => selectedBrands.map((brand) => ({ value: brand, onClear: () => toggleBrand(brand) })),
    [selectedBrands]
  );
  const activeMerchantChips = useMemo(
    () => selectedMerchants.map((merchant) => ({ value: merchant, onClear: () => toggleMerchant(merchant) })),
    [selectedMerchants]
  );

  // BUY-75939: facet toggling. When a value is already selected we remove
  // it (toggling off); otherwise append. Always returns a NEW array so the
  // memoization in `filteredProducts` re-runs. Order is preserved so the
  // URL reflects the user's selection order.
  function toggleBrand(brand: string) {
    setSelectedBrands((current) => {
      if (current.includes(brand)) {
        return current.filter((value) => value !== brand);
      }
      return [...current, brand];
    });
  }

  function toggleMerchant(merchant: string) {
    setSelectedMerchants((current) => {
      if (current.includes(merchant)) {
        return current.filter((value) => value !== merchant);
      }
      return [...current, merchant];
    });
  }

  function clearAllFilters() {
    setSelectedBrands([]);
    setSelectedMerchants([]);
    setPriceMin('');
    setPriceMax('');
  }

  return (
    // BUY-75930: overflow-x-hidden prevents horizontal scroll on mobile
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[linear-gradient(180deg,_#fff7ed_0%,_#ffffff_28%,_#f8fafc_100%)]">
      <Header />

      <main id="main-content" className="flex-1">
        {/* Mobile compact summary — shows result count on mobile only (not an H1) */}
        {hasActiveSearch && hasHydrated ? (
          <div
            data-testid="search-mobile-summary"


            className="mx-auto block max-w-7xl whitespace-normal break-words px-4 py-3 text-sm font-semibold text-slate-700 md:hidden"

          >
            <span className="text-amber-700">{activeCountry.label.toUpperCase()}</span>
            <span className="mx-2 text-slate-300">/</span>
            <span>
              {loadingInitial
                ? 'Searching...'
                : `${total.toLocaleString()} results for “${debouncedQuery}”`}
            </span>
          </div>
        ) : null}

        <section className="hidden border-b border-amber-100 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.22),_rgba(255,247,237,0.85)_38%,_rgba(255,255,255,1)_80%)] md:block">
          <div className={`mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 ${hasActiveSearch ? 'py-5 lg:py-6' : 'py-10 lg:py-14'}`}>
            <div className="max-w-3xl">
              {/* Hide the hero H1 + eyebrow when an active search is running so the query
                  isn't echoed twice. The result-count heading below becomes the single,
                  unified results header (rendered as <h1> for SEO semantics).

                  BUY-69622: During SSR, if initialQuery exists, the hero H1 is hidden
                  and only the result-count H1 (below) renders to avoid duplicate H1s.
                  This ensures crawlers see the actual search query in the H1, not
                  a loading placeholder. */}
              {hasActiveSearch || initialQuery ? null : (
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
                {filterSuggestedSearches(debouncedQuery).map((suggestion) => (
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

        <section className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
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
                  fold on mobile. Keep the result-count heading alone above the grid.

                  BUY-69622: The H1 is now rendered with actual query text during SSR
                  (via initialQuery prop), not with "Searching catalog..." skeleton.
                  Loading indicator is rendered below as a separate element with
                  role="status" (BUY-69622 a11y fix). */}
              <div className="hidden md:block">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                  {activeCountry.label}
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                  {hasHydrated && !loadingInitial
                    ? `${total.toLocaleString()} results for “${debouncedQuery}”`
                    : `${initialQuery ? `Search results for “${initialQuery}”` : 'Search Products — BuyWhere'}`}
                </h1>
              </div>

              {/* BUY-75939: results-toolbar row. Mobile gets the chip strip +
                  sort dropdown inline; desktop gets the sort dropdown next to
                  the H1 and the filter sidebar to the left of the grid (rendered
                  below). The desktop sort dropdown mirrors the mobile one so
                  either viewport can change the sort. */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
                {products.length > 0 ? (
                  <SortDropdown
                    value={sortMode}
                    onChange={setSortMode}
                    resultCount={sortedFilteredProducts.length}
                  />
                ) : (
                  <span />
                )}
                <span className="text-xs font-medium text-slate-500 md:text-sm">
                  {sortedFilteredProducts.length === total
                    ? `Showing ${sortedFilteredProducts.length.toLocaleString()} of ${total.toLocaleString()} loaded`
                    : `Showing ${sortedFilteredProducts.length.toLocaleString()} of ${total.toLocaleString()} loaded — filters active`}
                </span>
              </div>

              {/* BUY-75939: mobile-only chip strip with Filters trigger and active
                  filters. Hidden at lg+ where the sidebar takes over. */}
              {products.length > 0 ? (
                <FilterChipRow
                  totalActiveFilterCount={totalActiveFilterCount}
                  onOpenFilters={() => setMobileFilterSheetOpen(true)}
                  onClearAll={clearAllFilters}
                  activePriceChipLabel={activePriceChip?.label ?? null}
                  onClearPrice={activePriceChip ? activePriceChip.onClear : undefined}
                  activeBrandChips={activeBrandChips}
                  activeMerchantChips={activeMerchantChips}
                />
              ) : null}

              {/* BUY-69622: Only render loading indicator after hydration to avoid
                  SSR showing "Searching..." in the initial HTML. The H1 above now
                  provides meaningful server-rendered content instead. */}
              {loadingInitial && hasHydrated ? (
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
                    {filterSuggestedSearches(debouncedQuery).map((suggestion) => (
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

              {/* BUY-75939: filters-applied empty state. Distinct from
                  `showEmptyState` (no results at all for the query) — here the
                  API returned products but the user's active filters wiped
                  them out. Offer a single-tap "Clear filters" recovery rather
                  than steering the user to suggested searches, which are not
                  the right next step when the query itself was fine. */}
              {!loadingInitial &&
              !showEmptyState &&
              !showDegradedState &&
              products.length > 0 &&
              sortedFilteredProducts.length === 0 ? (
                <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-8 shadow-sm" data-testid="search-no-filter-matches">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Filters cleared everything</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                    No products match your current filters
                  </h2>
                  <p className="mt-3 max-w-2xl text-slate-700">
                    {products.length.toLocaleString()} {products.length === 1 ? 'result' : 'results'} match “{debouncedQuery}” but none pass your selected brand, merchant, or price filters.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex min-h-[44px] items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                    >
                      Clear filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileFilterSheetOpen(true)}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 lg:hidden"
                    >
                      Edit filters
                    </button>
                  </div>
                </div>
              ) : null}

              {!loadingInitial && products.length > 0 ? (
                <div className="lg:flex lg:items-start lg:gap-6">
                  {/* BUY-75939: desktop filter sidebar (≥1024px). Hidden on
                      mobile because the FilterChipRow + FilterBottomSheet pair
                      covers the same controls in a mobile-friendly form. */}
                  <div className="hidden lg:block">
                    <FilterSidebar
                      selectedBrands={selectedBrands}
                      selectedMerchants={selectedMerchants}
                      priceMin={priceMin}
                      priceMax={priceMax}
                      onToggleBrand={toggleBrand}
                      onToggleMerchant={toggleMerchant}
                      onPriceMinChange={setPriceMin}
                      onPriceMaxChange={setPriceMax}
                      onClearAll={clearAllFilters}
                      brandFacets={facets.brandFacets}
                      merchantFacets={facets.merchantFacets}
                      resultCount={products.length}
                      hasActiveFilters={hasActiveFilters}
                      activePriceChip={activePriceChip}
                      activeBrandChips={activeBrandChips}
                      activeMerchantChips={activeMerchantChips}
                      currencyPrefix={activeCountry.currency === 'SGD' ? 'S$' : '$'}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    {sortedFilteredProducts.length > 0 ? (
                      <>
                        <div
                          // BUY-75947: auto-fill minmax(220px,1fr) adapts to
                          // container width — when the BUY-75939 sidebar takes
                          // ~224px from the row, the grid quietly drops one
                          // column without a hardcoded breakpoint.
                          className="grid max-w-full gap-3 sm:gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
                        >
                          {sortedFilteredProducts.map((product) => (
                            <SearchCard key={product.id} product={product} currency={activeCountry.currency} />
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
                </div>
              ) : null}

              {/* BUY-75939: mobile bottom sheet (≤1024px). On desktop the
                  filter sidebar in the row above covers this surface. */}
              <FilterBottomSheet
                open={mobileFilterSheetOpen}
                onClose={() => setMobileFilterSheetOpen(false)}
                onApply={() => setMobileFilterSheetOpen(false)}
                onClearAll={clearAllFilters}
                sortMode={sortMode}
                onSortChange={setSortMode}
                priceMin={priceMin}
                priceMax={priceMax}
                onPriceMinChange={setPriceMin}
                onPriceMaxChange={setPriceMax}
                selectedBrands={selectedBrands}
                selectedMerchants={selectedMerchants}
                onToggleBrand={toggleBrand}
                onToggleMerchant={toggleMerchant}
                brandFacets={facets.brandFacets}
                merchantFacets={facets.merchantFacets}
                currencyPrefix={activeCountry.currency === 'SGD' ? 'S$' : '$'}
                resultCount={products.length}
                hasActiveFilters={hasActiveFilters}
              />
            </div>
          ) : null}
        </section>
      </main>

      <Footer />
    </div>
  );
}
