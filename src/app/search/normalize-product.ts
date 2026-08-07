// Shared normalizer used by both the server-rendered page and the client
// SearchResultsClient. Keeping it in a plain module (no 'use client') lets the
// Next.js server import it during SSR so the initial HTML ships with product
// cards visible to AI crawlers / LLM answer engines.

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
  structured_specs?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
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

export function formatMerchantName(value?: string | null): string {
  if (!value) return 'BuyWhere seller';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function hasUsableProductImage(value?: string | null): boolean {
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

export function normalizeProduct(item: SearchApiItem, fallbackCurrency: string): SearchCardProduct {
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
    id: String(item.id),
    name: item.name || item.title || 'Untitled product',
    price: Number.isFinite(numericPrice) ? numericPrice : null,
    currency: priceCurrency || fallbackCurrency,
    merchant: formatMerchantName(item.merchant_name || item.merchant || item.source),
    imageUrl,
    href: item.affiliate_redirect_url || item.click_url || item.affiliate_url || item.buy_url || item.url || '#',
    brand: item.brand || specBrand,
    category: item.category || specCategory,
  };
}

export function sortProductsByImageQuality(products: SearchCardProduct[]): SearchCardProduct[] {
  return [...products].sort((leftProduct, rightProduct) => {
    const leftHasImage = leftProduct.imageUrl ? 1 : 0;
    const rightHasImage = rightProduct.imageUrl ? 1 : 0;
    if (leftHasImage !== rightHasImage) return rightHasImage - leftHasImage;
    return 0;
  });
}

export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return 'Price unavailable';
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
