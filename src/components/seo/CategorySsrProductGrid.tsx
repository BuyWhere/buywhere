import { toSiteUrl } from "@/lib/site-url";

type ProductGridCountry = "US" | "SG";

type SearchApiItem = {
  id?: number | string | null;
  _id?: number | string | null;
  name?: string | null;
  title?: string | null;
  price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  price_amount?: number | string | null;
  current_price?: number | string | null;
  price_currency?: string | null;
  currency?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  source?: string | null;
  platform?: string | null;
  url?: string | null;
  product_url?: string | null;
  buy_url?: string | null;
  click_url?: string | null;
  affiliate_url?: string | null;
  affiliate_redirect_url?: string | null;
  image_url?: string | null;
  image?: string | null;
};

type SearchApiResponse = {
  data?: SearchApiItem[];
  items?: SearchApiItem[];
  results?: SearchApiItem[];
  products?: SearchApiItem[];
};

type SsrProduct = {
  id: string;
  name: string;
  price: number;
  currency: string;
  merchant: string;
  merchantUrl: string;
  redirectUrl: string;
};

export interface CategorySsrProductGridProps {
  title: string;
  description: string;
  query: string;
  category?: string;
  country?: ProductGridCountry;
  pagePath: string;
}

const MIN_PRODUCTS = 12;
const FETCH_LIMIT = 36;
const COUNTRY_CURRENCY: Record<ProductGridCountry, string> = {
  US: "USD",
  SG: "SGD",
};

function getSearchApiBaseUrl(): string {
  return (
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    "https://api.buywhere.ai"
  ).replace(/\/$/, "");
}

function getSearchApiKey(): string {
  return process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
}

function extractItems(payload: SearchApiResponse | null): SearchApiItem[] {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.products)) return payload.products;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function extractPrice(item: SearchApiItem): number | null {
  const priceObject = typeof item.price === "object" && item.price !== null ? item.price : null;
  const rawPrice = priceObject?.amount ?? item.price_amount ?? item.current_price ?? item.price;
  const numeric = typeof rawPrice === "number"
    ? rawPrice
    : typeof rawPrice === "string" && rawPrice.trim()
      ? Number(rawPrice)
      : NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function formatMerchantName(value: string): string {
  return value
    .replace(/^www\./, "")
    .replace(/\.(com|net|org|co|sg|ai)$/i, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function merchantFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const core = hostname.split(".")[0];
    return core ? formatMerchantName(core) : null;
  } catch {
    return null;
  }
}

function extractMerchantUrl(item: SearchApiItem): string {
  return (
    item.affiliate_redirect_url ||
    item.click_url ||
    item.affiliate_url ||
    item.buy_url ||
    item.url ||
    item.product_url ||
    ""
  ).trim();
}

function normalizeProduct(item: SearchApiItem, country: ProductGridCountry): SsrProduct | null {
  const id = String(item.id ?? item._id ?? "").trim();
  const name = (item.name || item.title || "").trim();
  const merchantUrl = extractMerchantUrl(item);
  const price = extractPrice(item);

  if (!id || !name || !merchantUrl || price === null) return null;

  try {
    const parsedUrl = new URL(merchantUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }

  const merchant = formatMerchantName(
    merchantFromUrl(merchantUrl) ||
    item.merchant_name ||
    item.merchant ||
    item.source ||
    item.platform ||
    "Retailer"
  );

  return {
    id,
    name,
    price,
    currency: COUNTRY_CURRENCY[country],
    merchant,
    merchantUrl,
    redirectUrl: `/r/direct/${encodeURIComponent(id)}?url=${encodeURIComponent(merchantUrl)}`,
  };
}

function uniqueProducts(products: SsrProduct[]): SsrProduct[] {
  const seen = new Set<string>();
  const result: SsrProduct[] = [];

  for (const product of products) {
    const key = `${product.id}:${product.merchantUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(product);
  }

  return result;
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
    style: "currency",
    currency,
  }).format(price);
}

async function fetchProductsForQuery(query: string, country: ProductGridCountry, category?: string): Promise<SearchApiItem[]> {
  const baseUrl = getSearchApiBaseUrl();
  const apiKey = getSearchApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    q: query,
    country,
    country_code: country,
    limit: String(FETCH_LIMIT),
  });
  if (category) params.set("category", category);

  try {
    const response = await fetch(`${baseUrl}/v1/products/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return [];
    return extractItems(await response.json() as SearchApiResponse);
  } catch {
    return [];
  }
}

async function fetchSsrProducts(query: string, country: ProductGridCountry, category?: string): Promise<SsrProduct[]> {
  const backupQueries = Array.from(new Set([
    query,
    category,
    `${query} deals`,
    `${query} best sellers`,
    country === "US" ? "electronics home fashion deals" : "electronics home beauty deals singapore",
  ].filter((value): value is string => Boolean(value && value.trim()))));

  const products: SsrProduct[] = [];
  for (const backupQuery of backupQueries) {
    const items = await fetchProductsForQuery(backupQuery, country, category);
    products.push(
      ...items
        .map((item) => normalizeProduct(item, country))
        .filter((product): product is SsrProduct => Boolean(product))
    );

    const unique = uniqueProducts(products);
    if (unique.length >= MIN_PRODUCTS) return unique.slice(0, FETCH_LIMIT);
  }

  return uniqueProducts(products).slice(0, FETCH_LIMIT);
}

export default async function CategorySsrProductGrid({
  title,
  description,
  query,
  category,
  country = "US",
  pagePath,
}: CategorySsrProductGridProps) {
  const products = await fetchSsrProducts(query, country, category);
  const visibleProducts = products.slice(0, Math.max(MIN_PRODUCTS, Math.min(products.length, 24)));

  if (visibleProducts.length === 0) return null;

  const pageUrl = toSiteUrl(pagePath);
  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${pageUrl}#products`,
    url: pageUrl,
    name: title,
    description,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: visibleProducts.length,
      itemListElement: visibleProducts.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: product.name,
          offers: {
            "@type": "Offer",
            price: product.price.toFixed(2),
            priceCurrency: product.currency,
            url: toSiteUrl(product.redirectUrl),
            seller: {
              "@type": "Organization",
              name: product.merchant,
            },
          },
        },
      })),
    },
  };

  return (
    <section aria-labelledby="ssr-category-products" data-ssr-products="category-grid" className="py-16 bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mb-8">
          <h2 id="ssr-category-products" className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
            {title}
          </h2>
          <p className="text-gray-600">{description}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProducts.map((product) => (
            <article key={`${product.id}-${product.merchantUrl}`} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold leading-6 text-gray-900">
                <a
                  href={product.redirectUrl}
                  rel="nofollow sponsored"
                  className="hover:text-indigo-600"
                >
                  {product.name}
                </a>
              </h3>
              <p className="mt-3 text-xl font-bold text-indigo-600" data-price={product.price.toFixed(2)}>
                {formatPrice(product.price, product.currency)}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                Retailer: <span className="font-medium text-gray-900">{product.merchant}</span>
              </p>
              <a
                href={product.redirectUrl}
                rel="nofollow sponsored"
                className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                aria-label={`View ${product.name} from ${product.merchant}`}
              >
                View deal
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
