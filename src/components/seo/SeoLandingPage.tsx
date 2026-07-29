import { ProductGridCard } from "@/components/seo/ProductGridCard";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import {
  buildSeoLandingSchema,
  getSeoLandingProducts,
  type LandingProduct,
  type SeoLandingPageConfig,
} from "@/lib/seo-landing-pages";
import { RelatedCategoryBlock } from "@/components/RelatedCategoryBlock";

function formatPrice(price: number | null, currency: string) {
  if (price === null) {
    return "Price unavailable";
  }

  return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

const DEFAULT_SHOPPER_CTA = {
  title: "Start comparing prices",
  body: "Search millions of products across Southeast Asia and the US — find the best price in seconds.",
  label: "Search products",
  href: "/",
};
const DEFAULT_DEVELOPER_CTA = {
  title: "Add BuyWhere to your agent",
  body: "Integrate real-time product search into your AI agent with one API call.",
  label: "View docs",
  href: "/developers",
};

// Derive comparison rows from live products so the table always matches the product cards above.
// Falls back to the hardcoded editorial rows only when no live products are available.
function buildComparisonRows(config: SeoLandingPageConfig, products: LandingProduct[]): { columns: string[]; rows: Record<string, string>[] } {
  if (products.length === 0) {
    // No live data — use static editorial rows (legacy behavior)
    return { columns: config.comparisonColumns, rows: config.comparisonRows };
  }
  // Derive rows from live products (up to 5)
  const columns = ["Model", "Price", "Merchant"];
  const rows = products.slice(0, 5).map((p) => ({
    Model: p.name,
    Price: formatPrice(p.price, p.currency),
    Merchant: p.merchant,
  }));
  return { columns, rows };
}

function buildRefreshedLabel(config: SeoLandingPageConfig, products: LandingProduct[]): string {
  // If the config provides a static label, keep it for editorial pages that
  // explicitly set a review/revision date.
  if (config.refreshedLabel) {
    return config.refreshedLabel;
  }

  // Otherwise, reflect the freshness of the live products on the page.
  const latest = products
    .map((p) => p.updatedAt)
    .filter(Boolean)
    .sort()
    .pop();

  if (latest) {
    const date = new Date(latest);
    const formatted = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return `Updated ${formatted}`;
  }

  return "Live prices updated regularly";
}

export async function SeoLandingPage({ config }: { config: SeoLandingPageConfig }) {
  const shopperCta = config.shopperCta || DEFAULT_SHOPPER_CTA;
  const developerCta = config.developerCta || DEFAULT_DEVELOPER_CTA;
  const products = await getSeoLandingProducts(config);
  const comparison = buildComparisonRows(config, products);
  const schema = buildSeoLandingSchema(config, products);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <main id="main-content" className="flex-1">
        <section className="overflow-hidden max-sm:overflow-visible bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#f59e0b_130%)] text-white">
          <div className={`mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end ${config.compactCatalogCards ? "py-6" : "py-16 lg:py-24"}`}>
            <div>
              <div className="mb-5 inline-flex items-center rounded-full border border-white/20 bg-slate-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
                {config.heroEyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {config.heroTitle}
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-200">
                {config.heroBody}
              </p>
              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-100">
                <span className="rounded-full bg-white/10 px-3 py-1.5">{buildRefreshedLabel(config, products)}</span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">{config.country} market coverage</span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">Live BuyWhere search results</span>
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-slate-950/35 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Quick next step</p>
              <h2 className="mt-3 text-2xl font-semibold">{shopperCta.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-200">{shopperCta.body}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={shopperCta.href}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300"
                >
                  {shopperCta.label}
                </Link>
                <Link
                  href={developerCta.href}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {developerCta.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={`bg-slate-50 ${config.compactCatalogCards ? "py-6" : "py-16"}`}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className={`${config.compactCatalogCards ? "mb-4" : "mb-8"} flex flex-col gap-3 md:flex-row md:items-end md:justify-between`}>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Live catalog snapshot</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.productSectionTitle}</h2>
              </div>
              <Link href={shopperCta.href} className="text-sm font-semibold text-amber-700 hover:text-amber-800">
                Open full search
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center col-span-full">
                <p className="text-slate-600">
                  Live product data is currently unavailable for this category. Please check back shortly or use the search to find products.
                </p>
              </div>
            ) : (
              <div className={config.compactCatalogCards ? "grid gap-4 lg:grid-cols-2" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>
                {products.map((product) => (
                  <ProductGridCard key={product.id} product={product} compact={config.compactCatalogCards} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-8 max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">Editor summary</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.comparisonSectionTitle}</h2>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left text-sm text-slate-700">
                  <thead className="bg-slate-900 text-xs uppercase tracking-[0.18em] text-slate-200">
                    <tr>
                      {comparison.columns.map((column) => (
                        <th key={column} className="px-4 py-4 font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row, index) => (
                      <tr key={`${row[comparison.columns[0]]}-${index}`} className="border-t border-slate-100">
                        {comparison.columns.map((column) => (
                          <td key={column} className="px-4 py-4 align-top">
                            {row[column]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {config.categoryIntro && (
          <section className="py-12">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="rounded-[28px] border border-amber-100 bg-amber-50/60 p-8 sm:p-10">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                  {config.categoryIntro.heading}
                </h2>
                <p className="mt-4 max-w-4xl text-base leading-7 text-slate-700">
                  {config.categoryIntro.body}
                </p>
              </div>
            </div>
          </section>
        )}

        {config.categoryComparisonRows && config.categoryComparisonRows.length > 0 && (
          <section className="py-12">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">{config.categoryComparisonEyebrow || "Featured models"}</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  {config.categoryComparisonTitle || "Models compared"}
                </h2>
              </div>
              <div className="mt-8 overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white text-left text-sm text-slate-700">
                    <thead className="bg-slate-900 text-xs uppercase tracking-[0.18em] text-slate-200">
                      <tr>
                        {(config.categoryComparisonColumns || Object.keys(config.categoryComparisonRows[0])).map((column) => (
                          <th key={column} className="px-4 py-4 font-semibold">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {config.categoryComparisonRows.map((row, index) => (
                        <tr key={`${row[config.categoryComparisonColumns?.[0] || Object.keys(row)[0]]}-${index}`} className="border-t border-slate-100">
                          {(config.categoryComparisonColumns || Object.keys(row)).map((column) => (
                            <td key={column} className="px-4 py-4 align-top">
                              {row[column]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_100%)] py-16">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Buying signals</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.highlightSectionTitle}</h2>
              <div className="mt-8 space-y-4">
                {config.highlights.map((highlight) => (
                  <article key={highlight.title} className="rounded-[24px] border border-amber-100 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">{highlight.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{highlight.body}</p>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">What to check</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.adviceSectionTitle}</h2>
              <div className="mt-8 rounded-[28px] border border-slate-200 bg-slate-900 p-8 text-slate-100 shadow-sm">
                <ul className="space-y-4">
                  {config.advicePoints.map((point) => (
                    <li key={point} className="flex gap-3 text-sm leading-6">
                      <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-semibold text-slate-950">
                        ✓
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Developer angle</p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-900">{developerCta.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{developerCta.body}</p>
                <Link
                  href={developerCta.href}
                  className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  {developerCta.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">FAQ</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.faqSectionTitle}</h2>
            </div>
            <div className="mt-8 grid gap-4">
              {config.faqs.map((faq) => (
                <article key={faq.question} className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">{faq.question}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      {config.showRelatedCategory && <RelatedCategoryBlock slug={config.slug} />}

      <Footer />
    </div>
  );
}
