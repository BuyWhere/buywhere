import type { Metadata } from 'next';
import { buildAffiliateRedirectFromMerchantUrl } from '@/lib/click-attribution';

export const revalidate = 900;

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

async function getDeals(): Promise<Deal[]> {
  try {
    // BWEXT-2E39756C: this fetched a site-relative /api/v1/deals that has never
    // existed (404 -> silent []) — six consecutive external-benchmark failures.
    // The real endpoint is the API host's /v1/products/deals, shape {data:[...]}.
    const apiBase = (process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.buywhere.ai').replace(/\/$/, '');
    const res = await fetch(`${apiBase}/v1/products/deals?deliver_to=SG&limit=24`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    const body = await res.json();
    const items = Array.isArray(body?.data) ? body.data : [];
    return items.map((p: Record<string, unknown>) => ({
      slug: String(p.id),
      name: String(p.title ?? p.name ?? ''),
      price: (p.price as { amount?: number })?.amount ?? (typeof p.price === 'number' ? p.price : 0),
      original_price: (p.original_price as number) ?? 0,
      discount_percent: (p.discount_pct as number) ?? 0,
      retailer: String(p.merchant_name ?? p.merchant ?? p.merchant_id ?? ''),
      url: String(p.click_url ?? p.url ?? ''),
      image_url: p.image_url ? String(p.image_url) : undefined,
      in_stock: p.availability !== 'unavailable',
    }));
  } catch {
    return [];
  }
}

export const metadata: Metadata = {
  title: 'Today\'s Best Deals — BuyWhere AI',
  description:
    'Find the best deals and discounts across retailers. Compare prices and save on top products.',
  alternates: { canonical: '/deals' },
};

export default async function DealsPage() {
  const deals = await getDeals();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: "Today's Best Deals",
    description:
      'Find the best deals and discounts across retailers.',
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
          </header>

          {deals.length > 0 ? (
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {deals.map((deal) => (
                  <article
                    key={deal.slug}
                    className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
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
                        <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                          {deal.retailer}
                        </span>
                        <span className="text-xs font-bold text-white bg-red-500 px-2 py-1 rounded">
                          -{deal.discount_percent}%
                        </span>
                      </div>
                      <h2 className="text-lg font-semibold text-gray-800 mb-2">
                        {deal.name}
                      </h2>
                      <div className="flex items-baseline gap-3 mb-4">
                        <span className="text-2xl font-bold text-green-600">
                          ${deal.price.toFixed(2)}
                        </span>
                        <span className="text-sm text-gray-400 line-through">
                          ${deal.original_price.toFixed(2)}
                        </span>
                      </div>
                      <a
                        href={buildAffiliateRedirectFromMerchantUrl(deal.url) || deal.url}
                        target="_blank"
                        rel="nofollow sponsored noopener noreferrer"
                        data-affiliate-redirect="deals-card"
                        className="block text-center bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        View Deal
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="flex flex-col items-center justify-center py-16">
              <div className="bg-blue-50 rounded-full p-8 mb-6">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-16 w-16 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-gray-800 mb-3">
                No deals available right now
              </h2>
              <p className="text-gray-500 text-center max-w-md mb-8">
                We&apos;re constantly scouting the best discounts across retailers.
                Check back soon or browse categories to find great prices now.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <a
                  href="/categories/electronics"
                  className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Browse Electronics
                </a>
                <a
                  href="/search"
                  className="inline-flex items-center px-5 py-2.5 bg-white text-blue-600 font-medium rounded-lg border-2 border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  Search Products
                </a>
                <button
                  type="button"
                  className="inline-flex items-center px-5 py-2.5 bg-white text-gray-600 font-medium rounded-lg border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  Notify Me
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
