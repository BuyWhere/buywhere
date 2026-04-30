import Image from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import {
  buildSeoLandingSchema,
  getSeoLandingProducts,
  type LandingProduct,
  type SeoLandingPageConfig,
} from "@/lib/seo-landing-pages";

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

function ProductGridCard({ product }: { product: LandingProduct }) {
  return (
    <a
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.25),_rgba(248,250,252,0.92)_55%,_rgba(226,232,240,0.95))]">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
            {product.brand || product.merchant}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">{product.merchant}</span>
          {product.category ? <span>{product.category}</span> : null}
        </div>

        <div className="space-y-2">
          <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-slate-900 transition-colors group-hover:text-amber-700">
            {product.name}
          </h2>
          {product.brand ? <p className="text-sm text-slate-500">{product.brand}</p> : null}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Current price</p>
            <p className="text-2xl font-semibold text-slate-900">{formatPrice(product.price, product.currency)}</p>
          </div>
          <span className="text-sm font-medium text-amber-700">View offer</span>
        </div>
      </div>
    </a>
  );
}

export async function SeoLandingPage({ config }: { config: SeoLandingPageConfig }) {
  const products = await getSeoLandingProducts(config);
  const schema = buildSeoLandingSchema(config, products);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <main className="flex-1">
        <section className="overflow-hidden bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#f59e0b_130%)] text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:py-24">
            <div>
              <div className="mb-5 inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
                {config.heroEyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {config.heroTitle}
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-200">
                {config.heroBody}
              </p>
              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-100">
                <span className="rounded-full bg-white/10 px-3 py-1.5">{config.refreshedLabel}</span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">{config.country} market coverage</span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">Live BuyWhere search results</span>
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-slate-950/35 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Quick next step</p>
              <h2 className="mt-3 text-2xl font-semibold">{config.shopperCta.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-200">{config.shopperCta.body}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={config.shopperCta.href}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300"
                >
                  {config.shopperCta.label}
                </Link>
                <Link
                  href={config.developerCta.href}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {config.developerCta.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Live catalog snapshot</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.productSectionTitle}</h2>
              </div>
              <Link href={config.shopperCta.href} className="text-sm font-semibold text-amber-700 hover:text-amber-800">
                Open full search
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {products.map((product) => (
                <ProductGridCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-8 max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Editor summary</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.comparisonSectionTitle}</h2>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left text-sm text-slate-700">
                  <thead className="bg-slate-900 text-xs uppercase tracking-[0.18em] text-slate-200">
                    <tr>
                      {config.comparisonColumns.map((column) => (
                        <th key={column} className="px-4 py-4 font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.comparisonRows.map((row, index) => (
                      <tr key={`${row[config.comparisonColumns[0]]}-${index}`} className="border-t border-slate-100">
                        {config.comparisonColumns.map((column) => (
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
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">What to check</p>
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Developer angle</p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-900">{config.developerCta.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{config.developerCta.body}</p>
                <Link
                  href={config.developerCta.href}
                  className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  {config.developerCta.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">FAQ</p>
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

      <Footer />
    </div>
  );
}
