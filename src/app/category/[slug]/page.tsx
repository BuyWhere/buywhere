import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { fetchCategoryProducts } from '@/lib/best-cheapest-category';
import { toSiteUrl } from '@/lib/site-url';
import Script from 'next/script';
import Image from 'next/image';

type Props = { params: { slug: string } };

function formatPrice(price: number | null, currency: string) {
  if (price === null) return 'Price unavailable';
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function buildBreadcrumbListSchema(slug: string, categoryName: string) {
  const path = `/category/${slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: toSiteUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Categories',
        item: toSiteUrl('/category'),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: categoryName,
        item: toSiteUrl(path),
      },
    ],
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = params;
  const categoryName = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    title: `${categoryName} — Shop Top Products at the Best Prices | BuyWhere`,
    description: `Browse the best ${categoryName.toLowerCase()} products. Compare prices from top merchants, find deals, and discover what's trending.`,
    alternates: { canonical: toSiteUrl(`/category/${slug}`) },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = params;

  const { products, categoryName } = await fetchCategoryProducts(slug);

  if (products.length === 0) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Script
        id="breadcrumb-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbListSchema(slug, categoryName)) }}
      />
      <Nav />
      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/" className="hover:underline">Home</Link>
              <span>/</span>
              <Link href="/category" className="hover:underline">Categories</Link>
              <span>/</span>
              <span className="text-slate-700">{categoryName}</span>
            </nav>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              {categoryName}
            </h1>
            <p className="text-lg text-slate-600">
              Discover top products in {categoryName.toLowerCase()}. Compare prices and find the best deals.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-slate-900">Top Products in {categoryName}</h2>
            <span className="text-sm text-slate-500">{products.length} results</span>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <a
                key={product.id}
                href={product.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg"
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
                  <div className="mt-auto text-lg font-bold text-slate-900">
                    {formatPrice(product.price, product.currency)}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Internal links block */}
          <aside className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">Explore More</h3>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/best/${slug}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                Best in {categoryName} →
              </Link>
              <Link
                href={`/cheapest/${slug}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                Cheapest in {categoryName} →
              </Link>
              <Link
                href={`/compare/${slug}`}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              >
                Compare {categoryName} →
              </Link>
            </div>
          </aside>
        </section>
      </main>
      <Footer />
    </div>
  );
}
