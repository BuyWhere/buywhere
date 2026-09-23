import type { Metadata } from 'next';
import { buildAffiliateRedirectFromMerchantUrl } from '@/lib/click-attribution';

export const revalidate = 300;

interface Deal {
  slug: string;
  name: string;
  price: number;
  original_price: number;
  discount_percent: number;
  retailer: string;
  url: string;
  image_url?: string;
  in_stock: boolean;
}

interface FallbackCard {
  href: string;
  title: string;
  blurb: string;
  cta: string;
}

const EVERGREEN_DEALS: FallbackCard[] = [
  {
    href: '/best-laptops-singapore',
    title: 'Best laptop prices in Singapore',
    blurb: 'Compare current laptop listings across retailers and jump to the lowest price.',
    cta: 'Compare laptops',
  },
  {
    href: '/best-iphones-us',
    title: 'iPhone deals (US)',
    blurb: 'Track iPhone listings and merchant prices in the US catalog.',
    cta: 'View iPhone prices',
  },
  {
    href: '/categories/electronics',
    title: 'Electronics',
    blurb: 'Phones, laptops, headphones, and gadgets with live merchant prices.',
    cta: 'Browse electronics',
  },
  {
    href: '/categories/fashion',
    title: 'Fashion',
    blurb: 'Clothing, shoes, and accessories across retailers.',
    cta: 'Browse fashion',
  },
  {
    href: '/categories/home-living',
    title: 'Home & Living',
    blurb: 'Furniture, appliances, and home essentials with price comparison.',
    cta: 'Browse home',
  },
  {
    href: '/search?q=wireless+earbuds',
    title: 'Wireless earbuds',
    blurb: 'Search live catalog prices for popular audio gear.',
    cta: 'Search earbuds',
  },
];

function apiBase(): string {
  return (
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'https://api.buywhere.ai'
  ).replace(/\/$/, '');
}

function productPrice(p: Record<string, unknown>): number {
  const price = p.price;
  if (typeof price === 'number' && Number.isFinite(price)) return price;
  if (price && typeof price === 'object' && typeof (price as { amount?: number }).amount === 'number') {
    return (price as { amount: number }).amount;
  }
  return 0;
}

function mapProduct(p: Record<string, unknown>): Deal | null {
  const name = String(p.title ?? p.name ?? '').trim();
  if (!name) return null;
  const price = productPrice(p);
  const original =
    typeof p.original_price === 'number' ? p.original_price : price;
  const discount =
    typeof p.discount_pct === 'number'
      ? p.discount_pct
      : original > price && original > 0
        ? Math.round((1 - price / original) * 100)
        : 0;
  const url = String(p.click_url ?? p.url ?? '');
  return {
    slug: String(p.id ?? p.sku ?? name),
    name,
    price,
    original_price: original,
    discount_percent: discount,
    retailer: String(p.merchant_name ?? p.merchant ?? p.merchant_id ?? ''),
    url,
    image_url: p.image_url ? String(p.image_url) : undefined,
    in_stock: p.availability !== 'unavailable',
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractItems(body: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!body) return [];
  for (const key of ['data', 'products', 'results', 'items'] as const) {
    const v = body[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

async function getDeals(): Promise<{ deals: Deal[]; source: 'deals' | 'search' | 'empty' }> {
  const base = apiBase();

  const dealsBody = await fetchJson(
    `${base}/v1/products/deals?deliver_to=SG&currency=SGD&limit=24`,
    3500,
  );
  const dealsItems = extractItems(dealsBody)
    .map(mapProduct)
    .filter((d): d is Deal => d !== null);
  if (dealsItems.length > 0) return { deals: dealsItems, source: 'deals' };

  const usdBody = await fetchJson(
    `${base}/v1/products/deals?deliver_to=US&currency=USD&limit=24`,
    3500,
  );
  const usdItems = extractItems(usdBody)
    .map(mapProduct)
    .filter((d): d is Deal => d !== null);
  if (usdItems.length > 0) return { deals: usdItems, source: 'deals' };

  const searchBody = await fetchJson(
    `${base}/v1/products/search?q=laptop&deliver_to=SG&limit=12`,
    4000,
  );
  const searchItems = extractItems(searchBody)
    .map(mapProduct)
    .filter((d): d is Deal => d !== null && d.price > 0);
  if (searchItems.length > 0) return { deals: searchItems, source: 'search' };

  return { deals: [], source: 'empty' };
}

export const metadata: Metadata = {
  title: "Today's Best Deals — BuyWhere AI",
  description:
    'Find the best deals and discounts across retailers. Compare prices and save on top products.',
  alternates: { canonical: '/deals' },
};

export default async function DealsPage() {
  const { deals, source } = await getDeals();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: "Today's Best Deals",
    description: 'Find the best deals and discounts across retailers.',
    url: '/deals',
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        <div className="container mx-auto px-4 py-16">
          <header className="mb-12">
            <h1 className="text-4xl font-bold text-blue-800 mb-4">
              Today&apos;s Best Deals
            </h1>
            <p className="text-lg text-gray-600">
              Compare prices and find discounts across retailers.
            </p>
            {source === 'search' && (
              <p className="mt-3 text-sm text-amber-700" data-deals-fallback="search">
                Live discount feed is catching up — showing popular priced products instead.
              </p>
            )}
          </header>

          {deals.length > 0 ? (
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {deals.map((deal) => (
                  <article
                    key={deal.slug}
                    className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                    data-deal-card="true"
                  >
                    {deal.image_url && (
                      <img
                        src={deal.image_url}
                        alt={deal.name}
                        className="h-48 w-full object-contain bg-gray-50 p-4"
                      />
                    )}
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        {deal.retailer ? (
                          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            {deal.retailer}
                          </span>
                        ) : (
                          <span />
                        )}
                        {deal.discount_percent > 0 && (
                          <span className="text-xs font-bold text-white bg-red-500 px-2 py-1 rounded">
                            -{deal.discount_percent}%
                          </span>
                        )}
                      </div>
                      <h2 className="text-lg font-semibold text-gray-800 mb-2">
                        {deal.name}
                      </h2>
                      {deal.price > 0 && (
                        <div className="flex items-baseline gap-3 mb-4">
                          <span className="text-2xl font-bold text-green-600">
                            ${deal.price.toFixed(2)}
                          </span>
                          {deal.original_price > deal.price && (
                            <span className="text-sm text-gray-400 line-through">
                              ${deal.original_price.toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                      <a
                        href={
                          deal.url
                            ? buildAffiliateRedirectFromMerchantUrl(deal.url) || deal.url
                            : `/search?q=${encodeURIComponent(deal.name)}`
                        }
                        target={deal.url ? '_blank' : undefined}
                        rel={deal.url ? 'nofollow sponsored noopener noreferrer' : undefined}
                        data-affiliate-redirect="deals-card"
                        className="block text-center bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        {deal.url ? 'View Deal' : 'Compare prices'}
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section data-deals-fallback="evergreen">
              <p className="text-sm text-gray-600 mb-6">
                The live discount feed is temporarily empty. Browse popular deal destinations
                while we refresh prices.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {EVERGREEN_DEALS.map((card) => (
                  <article
                    key={card.href}
                    className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                    data-deal-card="fallback"
                  >
                    <div className="p-6">
                      <h2 className="text-lg font-semibold text-gray-800 mb-2">
                        {card.title}
                      </h2>
                      <p className="text-sm text-gray-500 mb-4">{card.blurb}</p>
                      <a
                        href={card.href}
                        className="block text-center bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        {card.cta}
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
