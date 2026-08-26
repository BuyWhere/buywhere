import Link from "next/link";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import type { CountryLandingConfig } from "@/lib/country-landings";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

interface CountryLandingPageProps {
  config: CountryLandingConfig;
}

export default function CountryLandingPage({ config }: CountryLandingPageProps) {
  const countryParam = encodeURIComponent(config.countryCode);
  const schema = buildWebPageSchema({
    path: `/${config.slug}`,
    name: `BuyWhere ${config.countryCode} — Compare Prices in ${config.countryName}`,
    description: config.description,
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: config.countryName, path: `/${config.slug}` },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex min-h-screen flex-col bg-white">
        <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold text-indigo-600">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="28" height="28" rx="6" fill="#4f46e5" />
                <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
              BuyWhere
            </Link>
            <div className="flex items-center gap-4 text-sm font-medium text-gray-600">
              <Link href={`/search?q=&country=${countryParam}`} rel="nofollow" className="transition-colors hover:text-indigo-600">
                Browse {config.countryCode}
              </Link>
              <Link href="/categories" className="transition-colors hover:text-indigo-600">
                Categories
              </Link>
              <Link href="/api-keys" className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700">
                Get API Key
              </Link>
            </div>
          </div>
        </header>

        <main id="main-content">
          <section className="bg-gradient-to-b from-indigo-50 to-white py-20 md:py-24">
            <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-indigo-600">
                {config.flag} {config.countryName} catalog
              </p>
              <h1 className="text-3xl font-bold leading-tight text-gray-900 sm:text-4xl md:text-5xl lg:text-6xl" style={{ lineHeight: 1.1 }}>
                {config.headline}
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 md:text-xl">
                {config.description}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <Link
                  href={`/search?q=&country=${countryParam}`} rel="nofollow"
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Search {config.countryName}
                </Link>
                <Link
                  href="/categories"
                  className="inline-flex items-center justify-center rounded-lg border-2 border-gray-200 px-6 py-3 font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  Browse categories
                </Link>
              </div>
            </div>
          </section>

          <section className="bg-white py-16">
            <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Market filter</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Every search from this page opens BuyWhere with <strong>country={config.countryCode}</strong> so results are scoped to {config.countryName}.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Currency</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Compare visible offers and local market data in <strong>{config.currency}</strong> where retailer feeds provide localized pricing.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Retailer coverage</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Explore marketplace and merchant coverage from {config.topRetailers.join(", ")} and other catalog sources.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-gray-50 py-16">
            <div className="mx-auto max-w-5xl px-4 sm:px-6">
              <h2 className="text-center text-2xl font-bold text-gray-900 md:text-3xl">
                Start with a popular {config.countryName} search
              </h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {config.searchExamples.map((query) => (
                  <Link
                    key={query}
                    href={`/search?q=${encodeURIComponent(query)}&country=${countryParam}`} rel="nofollow"
                    className="rounded-xl border border-gray-100 bg-white p-5 text-center font-semibold text-gray-900 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 hover:shadow-md"
                  >
                    {query}
                  </Link>
                ))}
              </div>
              <p className="mt-8 text-center text-sm text-gray-500">
                Canonical URL: <span className="font-medium text-gray-700">{toSiteUrl(`/${config.slug}`)}</span>
              </p>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
