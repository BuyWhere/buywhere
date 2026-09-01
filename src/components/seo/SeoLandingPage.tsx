import { ProductGridCard } from "@/components/seo/ProductGridCard";
import { SeoAnswerBlock } from "@/components/seo/SeoAnswerBlock";
import { SeoLandingStickyAnchor } from "@/components/seo/SeoLandingStickyAnchor";
import { SeoLivePricesSnippet } from "@/components/seo/SeoLivePricesSnippet";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import {
  buildAnswerBlock,
  buildSeoLandingSchema,
  getSeoLandingProducts,
  resolveHeroTitle,
  type LandingProduct,
  type SeoLandingPageConfig,
} from "@/lib/seo-landing-pages";
import { toSiteUrl } from "@/lib/site-url";
import { RelatedCategoryBlock } from "@/components/RelatedCategoryBlock";
import AgentMarketingBlock from "@/components/AgentMarketingBlock";
import { formatCheckedStamp, getOrUpdatePageLastmod, serializeHashable } from "@/lib/page-content-hash";

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

// Cap on how recent a product `updatedAt` can be before we stop trusting it
// as a proxy for "page freshness". A catalog row stamped more than this many
// days ago (BUY-63742: 2026-05-05 entries while today is 2026-07-29, ~85
// days) reads like a placeholder and undermines buyer trust — fall back to
// the generic copy rather than display a misleading badge. 30 days keeps the
// badge honest: it only renders when there is genuinely fresh activity in
// the upstream catalog for this query.
const STALE_CATALOG_DAYS = 30;

function parseCatalogTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

// Parse a refreshedLabel like "Refreshed July 25, 2026" or "Updated July 21, 2026"
// to extract the date. Returns null if the label doesn't contain a parseable date
// or if the date is in the future (BUY-63853: catch placeholder/future dates in hardcoded labels).
function parseRefreshedLabelDate(label: string): Date | null {
  // Match patterns like "Updated July 21, 2026" or "Refreshed Jan 15, 2026"
  const match = label.match(/(?:Updated|Refreshed)\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (!match) return null;
  const ts = Date.parse(match[1]);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function buildRefreshedLabel(config: SeoLandingPageConfig, products: LandingProduct[]): string {
  // If the config provides a static label, validate it's not a future/placeholder date.
  // Editorial pages may set an explicit review date, but it must be in the past
  // to avoid the "future/placeholder-style date" false positive (BUY-63853).
  if (config.refreshedLabel) {
    const labelDate = parseRefreshedLabelDate(config.refreshedLabel);
    const now = Date.now();
    // If we can parse a date from the label and it's in the future, fall back to dynamic
    if (labelDate && labelDate.getTime() > now) {
      console.warn(
        `[seo] ${config.slug}: refreshedLabel "${config.refreshedLabel}" has future date, falling back to dynamic`
      );
    } else {
      return config.refreshedLabel;
    }
  }

  // Otherwise, reflect the freshness of the live products on the page — but
  // only when the upstream `updated_at` is plausibly live. Skipping future
  // dates and anything older than STALE_CATALOG_DAYS prevents a stale catalog
  // row (BUY-63742) from rendering as a hero badge.
  const now = Date.now();
  const staleCutoff = now - STALE_CATALOG_DAYS * 24 * 60 * 60 * 1000;
  const latest = products
    .map((p) => parseCatalogTimestamp(p.updatedAt))
    .filter((d): d is Date => d !== null)
    .filter((d) => d.getTime() <= now && d.getTime() >= staleCutoff)
    .map((d) => d.getTime())
    .reduce<number | null>((max, ts) => (max === null || ts > max ? ts : max), null);

  if (latest !== null) {
    const formatted = new Date(latest).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return `Updated ${formatted}`;
  }

  return "Live prices updated regularly";
}

// Exported for the regression test in SeoLandingPage.test.tsx (BUY-63742).
export const __test__ = { buildRefreshedLabel, STALE_CATALOG_DAYS };

export async function SeoLandingPage({ config }: { config: SeoLandingPageConfig }) {
  const shopperCta = config.shopperCta || DEFAULT_SHOPPER_CTA;
  const developerCta = config.developerCta || DEFAULT_DEVELOPER_CTA;
  const products = await getSeoLandingProducts(config);
  const comparison = buildComparisonRows(config, products);
  // BUY-66320: render the hero headline from the live catalog floor (when the
  // config provides a template) so the H1, JSON-LD headline, and breadcrumb
  // all match the lowest visible price.
  const heroTitle = resolveHeroTitle(config, products);

  // BUY-74905 (directive §5): compute a hash of the rendered page body
  // (config fields + live product snapshot + editorial sections) and pin the
  // visible "Updated <date>" stamp and JSON-LD `dateModified` to whatever
  // ISO that hash maps to in the content-hash store. Date moves only when
  // content changes. (Editorial `refreshedLabel` overrides are honored below
  // when present — that override still flows through this hash so its
  // identity-by-content invariant holds.)
  const hashInputBody = serializeHashable({
    kind: "seo-landing-page",
    slug: config.slug,
    canonicalPath: config.canonicalPath,
    title: config.title,
    description: config.description,
    heroTitle,
    heroBody: config.heroBody,
    heroEyebrow: config.heroEyebrow,
    productSectionTitle: config.productSectionTitle,
    comparisonSectionTitle: config.comparisonSectionTitle,
    highlightSectionTitle: config.highlightSectionTitle,
    adviceSectionTitle: config.adviceSectionTitle,
    faqSectionTitle: config.faqSectionTitle,
    comparisonColumns: config.comparisonColumns,
    comparisonRows: config.comparisonRows,
    highlights: config.highlights,
    advicePoints: config.advicePoints,
    faqs: config.faqs,
    fallbackProducts: config.fallbackProducts,
    refreshedLabel: config.refreshedLabel ?? null,
    // Live catalog floor: sorted by id so order doesn't change the hash.
    productSnapshot: products
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        merchant: p.merchant,
        updatedAt: p.updatedAt,
        brand: p.brand,
        category: p.category,
      })),
  });
  const stamp = await getOrUpdatePageLastmod(
    toSiteUrl(config.canonicalPath),
    hashInputBody,
    new Date(config.dateModified ?? config.datePublished ?? "2026-06-29").toISOString(),
  );
  const checked = formatCheckedStamp(stamp);
  // BUY-74905: thread the hash-stable ISO through the JSON-LD builder so the
  // Article.dateModified mirrors the visible "Updated <date>" stamp exactly.
  const schema = buildSeoLandingSchema(config, products, checked.iso);

  // BUY-74928 [OPENAI-CHANNEL]: 40-60-word plain-text answer block above the
  // fold. Built from the same live products the price table renders, and the
  // "Prices checked <date>" mirrors the JSON-LD dateModified exactly
  // (directive §5). Returns null when the live catalog has fewer than 2 priced
  // offers — we never invent a "next retailer" or a delta.
  const answerBlock = buildAnswerBlock(config, products, checked);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <main id="main-content" className="flex-1">
        {/* BUY-74928: answer block FIRST in DOM order (4seen OAI-SearchBot
            checklist item 1) — before nav-heavy markup, the price table, the
            verdict sentence, and FAQs. Plain text, server-side rendered,
            visible to crawlers that don't run JS. */}
        {answerBlock && (
          <SeoAnswerBlock
            block={answerBlock}
            intent={`${config.searchQuery} in ${config.country}`}
          />
        )}

        {/* BUY-77662: product grid appears ABOVE the hero CTA so buy links are
            above the fold. Moved before the hero section. */}
        <section className={`bg-slate-50 ${config.compactCatalogCards ? "py-6" : "py-16"}`}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className={`${config.compactCatalogCards ? "mb-4" : "mb-8"} flex flex-col gap-3 md:flex-row md:items-end md:justify-between`}>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#8A4300]">Live catalog snapshot</p>
                <h2 id="live-deals" className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{config.productSectionTitle}</h2>
              </div>
              <Link href={shopperCta.href} prefetch={false} className="text-sm font-semibold text-amber-900 hover:text-amber-950 underline-offset-4 hover:underline">
                Open full search
              </Link>
            </div>

            {/* BUY-77662: when the live catalog returns nothing, render
                config.fallbackProducts (curated editorial picks) so product cards
                are always visible above the fold. Only show the empty-state message
                when both live products AND fallback products are unavailable. */}
            {products.length === 0 && !config.fallbackProducts?.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center col-span-full">
                <p className="text-slate-600">
                  Live product data is currently unavailable for this category. Please check back shortly or use the search to find products.
                </p>
              </div>
            ) : (
              <div className={config.compactCatalogCards ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>
                {(products.length > 0 ? products : (config.fallbackProducts ?? [])).map((product) => (
                  // BUY-78335: pass pathname so /r/ links include source_page at render time (e.g., "/best-macbooks-us")
                  <ProductGridCard key={product.id} product={product} compact={config.compactCatalogCards} pathname={`/${config.slug}`} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden max-sm:overflow-visible bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#f59e0b_130%)] text-white">
          <div className={`mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end ${config.compactCatalogCards ? "py-6" : "py-12 lg:py-16"}`}>
            <div>
              <div className="mb-5 inline-flex items-center rounded-full border border-white/20 bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-100">
                {config.heroEyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {heroTitle}
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-200">
                {config.heroBody}
              </p>
              <ul
                className="mt-8 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-100"
                aria-label="Page metadata"
                data-ssr-prices-checked={checked.iso}
              >
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="text-amber-100">✓</span>
                  {/* BUY-74905 (directive §5): the visible "Updated <date>" pill
                      mirrors the JSON-LD `dateModified` and the sitemap
                      <lastmod>; all three derive from the same content hash
                      so they move together (or not at all). When an editorial
                      `refreshedLabel` is set we honor it as text but still
                      record its content hash so the identity-by-content
                      invariant holds. */}
                  <span>
                    Updated{" "}
                    <time dateTime={checked.iso}>{checked.text}</time>
                  </span>
                </li>
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="text-amber-100">✓</span>
                  <span>{config.country} market coverage</span>
                </li>
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="text-amber-100">✓</span>
                  <span>Live BuyWhere search results</span>
                </li>
              </ul>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-slate-950 p-6 shadow-2xl shadow-slate-950/30">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Quick next step</p>
              <h2 className="mt-3 text-2xl font-semibold">{shopperCta.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-200">{shopperCta.body}</p>
              <div className="mt-6">
                <Link
                  href={shopperCta.href}
                  prefetch={false}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  {shopperCta.label}
                </Link>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-300">
                Building a deal feed? {" "}
                <Link
                  href={developerCta.href}
                  prefetch={false}
                  className="font-semibold text-amber-200 underline-offset-4 hover:text-amber-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  {developerCta.label} →
                </Link>
              </p>
            </div>
          </div>
        </section>

        <SeoLandingStickyAnchor />

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
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">{config.categoryComparisonEyebrow || "Featured models"}</p>
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
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">Buying signals</p>
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
                      <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-800 text-xs font-semibold text-white">
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
                  prefetch={false}
                  className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  {developerCta.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* BUY-74862 (Day 1): per-page "Check live prices yourself" snippet. Renders
            server-side (SSR) with this page's own searchQuery + country so agents
            and developers who land here can pull the same prices without parsing
            the page. Visible to crawlers — do NOT hide behind a <details> toggle. */}
        <SeoLivePricesSnippet config={config} />

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

      <AgentMarketingBlock searchQuery={config.searchQuery} country={config.country} />
      <Footer />
    </div>
  );
}
