import Schema from '@/components/Schema';
import { apiBase, apiHeaders } from "@/lib/server-api";
import { buildPageMetadata } from '@/lib/page-metadata';
import { buildCollectionPageSchema } from '@/lib/page-schema';

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
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${apiBase()}/v1/deals`, { headers: apiHeaders(),
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

const DEALS_TITLE = "Today's Best Deals on BuyWhere";
const DEALS_DESCRIPTION =
  'Find live discounts and compare prices across retailers so you can save on top products.';

export const metadata = buildPageMetadata({
  title: DEALS_TITLE,
  description: DEALS_DESCRIPTION,
  path: '/deals',
});

export default async function DealsPage() {
  const deals = await getDeals();

  const jsonLd = buildCollectionPageSchema({
    path: '/deals',
    name: DEALS_TITLE,
    description: DEALS_DESCRIPTION,
    // BUY-69732: Home > Deals breadcrumb for the deals route.
    breadcrumb: [
      { name: 'Home', path: '/' },
      { name: 'Deals', path: '/deals' },
    ],
  });

  return (
    <>
      <Schema data={jsonLd} />
      <main id="main-content" className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
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
                        href={deal.url}
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
            <section className="text-center py-12">
              <p className="text-gray-500 text-lg">
                No deals available right now. Check back soon!
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
