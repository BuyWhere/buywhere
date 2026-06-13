import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { fetchProductsForSlug } from '@/lib/best-cheapest-category';
import { toSiteUrl } from '@/lib/site-url';
import Script from 'next/script';
import Image from 'next/image';

const VALID_COUNTRIES = new Set(['singapore', 'us']);
const COUNTRY_MAP: Record<string, 'SG' | 'US'> = {
  singapore: 'SG',
  us: 'US',
};

type Props = { params: { slug: string } };

function formatPrice(price: number | null, currency: string) {
  if (price === null) return 'Price unavailable';
  return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function buildItemListSchema(products: Awaited<ReturnType<typeof fetchProductsForSlug>>['products'], slug: string, country: string) {
  const base = toSiteUrl(`/cheapest/${slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Cheapest ${slug.replace(/-/g, ' ')} in ${country}`,
    url: base,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: p.href,
      item: {
        '@type': 'Product',
        name: p.name,
        image: p.imageUrl || undefined,
        offers: p.price !== null ? {
          '@type': 'Offer',
          price: p.price,
          priceCurrency: p.currency,
          availability: 'https://schema.org/InStock',
        } : undefined,
      },
    })),
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = params;
  const countrySuffix = slug.split('-').pop()?.toLowerCase() ?? '';
  const countryCode = VALID_COUNTRIES.has(countrySuffix) ? COUNTRY_MAP[countrySuffix] : null;
  const displayCountry = countryCode === 'SG' ? 'Singapore' : countryCode === 'US' ? 'the US' : '';
  const queryPart = slug.replace(/-singapore$|-us$/i, '').replace(/-/g, ' ');

  return {
    title: `Cheapest ${queryPart}${displayCountry ? ` in ${displayCountry}` : ''} — BuyWhere`,
    description: `Find the lowest prices on ${queryPart}${displayCountry ? ` in ${displayCountry}` : ''}. Compare deals across merchants and save money.`,
    alternates: { canonical: toSiteUrl(`/cheapest/${slug}`) },
  };
}

export default async function CheapestPage({ params }: Props) {
  const { slug } = params;

  const countrySuffix = slug.split('-').pop()?.toLowerCase() ?? '';
  const countryCode: 'SG' | 'US' = VALID_COUNTRIES.has(countrySuffix)
    ? COUNTRY_MAP[countrySuffix]
    : 'SG';

  const { products, query } = await fetchProductsForSlug(slug, countryCode, 'cheapest');

  if (products.length === 0) {
    notFound();
  }

  const displayCountry = countryCode === 'SG' ? 'Singapore' : 'the US';
  const queryFormatted = query.replace(/-/g, ' ');

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Script
        id="itemlist-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListSchema(products, slug, displayCountry)) }}
      />
      <Nav />
      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/" className="hover:underline">Home</Link>
              <span>/</span>
              <Link href="/cheapest" className="hover:underline">Cheapest Products</Link>
              <span>/</span>
              <span className="text-slate-700 capitalize">{queryFormatted}</span>
            </nav>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Cheapest {queryFormatted}{displayCountry ? ` in ${displayCountry}` : ''}
            </h1>
            <p className="text-lg text-slate-600">
              Find the lowest prices on {queryFormatted}{displayCountry ? ` available in ${displayCountry}` : ''}.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-slate-900">Lowest Prices</h2>
            <span className="text-sm text-slate-500">{products.length} results</span>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <a
                key={product.id}
                href={product.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-green-300 hover:shadow-lg"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                  {product.imageUrl ? (
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm font-semibold uppercase tracking-widest text-slate-400">
                      {product.merchant}
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{product.merchant}</div>
                  <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-slate-900">{product.name}</h3>
                  <div className="mt-auto text-xl font-bold text-green-700">
                    {formatPrice(product.price, product.currency)}
                  </div>
                </div>
              </a>
            ))}
          </div>

          <aside className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">Explore More</h3>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/best/${slug}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                Best {queryFormatted} →
              </Link>
              <Link
                href={`/compare/${query}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                Compare {queryFormatted} →
              </Link>
              <Link
                href={`/category/${query}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                {queryFormatted} Categories →
              </Link>
            </div>
          </aside>
        </section>
      </main>
      <Footer />
    </div>
  );
}
