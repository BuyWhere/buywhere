import type { Metadata } from 'next';
import Link from 'next/link';

export const revalidate = 900;

interface Brand {
  slug: string;
  name: string;
  product_count: number;
  logo_url?: string;
}

async function getBrands(): Promise<Brand[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/v1/brands`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export const metadata: Metadata = {
  title: 'Shop by Brand — BuyWhere AI',
  description:
    'Browse popular brands and find the best prices across retailers. Compare deals on Apple, Samsung, Sony, Nike, and more.',
  alternates: { canonical: '/brands' },
};

export default async function BrandsPage() {
  const brands = await getBrands();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Shop by Brand',
    description:
      'Browse popular brands and compare prices across retailers.',
    url: '/brands',
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
              Shop by Brand
            </h1>
            <p className="text-lg text-gray-600">
              Browse popular brands and find the best prices across retailers.
            </p>
          </header>

          {brands.length > 0 ? (
            <section>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {brands.map((brand) => (
                  <Link
                    key={brand.slug}
                    href={`/brand/${brand.slug}`}
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow text-center group"
                  >
                    {brand.logo_url && (
                      <img
                        src={brand.logo_url}
                        alt={brand.name}
                        className="h-16 mx-auto mb-4 object-contain"
                      />
                    )}
                    <h2 className="text-lg font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
                      {brand.name}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {brand.product_count} products
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <section className="text-center py-12">
              <p className="text-gray-500 text-lg">
                No brands available yet. Check back soon!
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
