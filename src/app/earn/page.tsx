import type { Metadata } from 'next';

export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Earn Cashback — BuyWhere AI',
  description:
    'Earn cashback on every purchase. Shop through BuyWhere and get rewards back on your everyday spending.',
  alternates: { canonical: '/earn' },
};

export default async function EarnPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Earn Cashback — BuyWhere',
    description:
      'Earn cashback on every purchase through BuyWhere.',
    url: '/earn',
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
              Earn Cashback
            </h1>
            <p className="text-lg text-gray-600">
              Shop through BuyWhere and earn rewards on every purchase.
            </p>
          </header>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Compare Prices
              </h2>
              <p className="text-gray-600">
                Search for products and compare prices across hundreds of
                retailers instantly.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">🛒</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Shop Through Us
              </h2>
              <p className="text-gray-600">
                Click through to your chosen retailer and complete your purchase
                as normal.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">💰</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Earn Rewards
              </h2>
              <p className="text-gray-600">
                Earn cashback on qualifying purchases — it&apos;s that simple.
              </p>
            </div>
          </section>

          <section className="bg-blue-800 text-white rounded-xl p-10 text-center">
            <h2 className="text-3xl font-bold mb-4">Start Earning Today</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-2xl mx-auto">
              Sign up for a free account and start earning cashback on your
              everyday shopping. No fees, no hidden terms.
            </p>
            <a
              href="/search"
              className="inline-block bg-white text-blue-800 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Find Products
            </a>
          </section>
        </div>
      </main>
    </>
  );
}
