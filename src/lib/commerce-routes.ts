export interface CommerceBrandEntry {
  name: string;
  slug: string;
  productCount?: number;
}

export interface CommerceStoreEntry {
  name: string;
  slug: string;
  country: string;
  countryCode: string;
  productCount?: number;
  source: string;
}

export const commerceBrands: CommerceBrandEntry[] = [
  { name: "Apple", slug: "apple" },
  { name: "Samsung", slug: "samsung" },
  { name: "Sony", slug: "sony" },
  { name: "Nike", slug: "nike" },
  { name: "Dyson", slug: "dyson" },
  { name: "Nintendo", slug: "nintendo" },
  { name: "Dell", slug: "dell" },
  { name: "Lenovo", slug: "lenovo" },
  { name: "Canon", slug: "canon" },
  { name: "Xiaomi", slug: "xiaomi" },
];

export const commerceStores: CommerceStoreEntry[] = [
  { name: "Shopee Singapore", slug: "shopee", country: "Singapore", countryCode: "sg", productCount: 820000, source: "shopee_sg" },
  { name: "Lazada Singapore", slug: "lazada", country: "Singapore", countryCode: "sg", productCount: 650000, source: "lazada_sg" },
  { name: "Amazon US", slug: "amazon", country: "United States", countryCode: "us", productCount: 1247500, source: "amazon_us" },
  { name: "Walmart US", slug: "walmart", country: "United States", countryCode: "us", productCount: 890000, source: "walmart_us" },
  { name: "Target US", slug: "target", country: "United States", countryCode: "us", productCount: 420000, source: "target_us" },
  { name: "Best Buy US", slug: "best-buy", country: "United States", countryCode: "us", productCount: 310000, source: "bestbuy_us" },
  { name: "Carousell Singapore", slug: "carousell", country: "Singapore", countryCode: "sg", productCount: 185000, source: "carousell_sg" },
  { name: "Yahoo Shopping Japan", slug: "yahoo-shopping", country: "Japan", countryCode: "jp", productCount: 275000, source: "yahoo_jp" },
];

export function getCommerceBrand(slug: string): CommerceBrandEntry | null {
  return commerceBrands.find((brand) => brand.slug === slug) ?? null;
}

export function getCommerceStore(slug: string): CommerceStoreEntry | null {
  return commerceStores.find((store) => store.slug === slug) ?? null;
}

export function getStoreSearchPath(store: CommerceStoreEntry): string {
  return `/search?q=&source=${encodeURIComponent(store.source)}&country=${encodeURIComponent(store.countryCode)}`;
}
