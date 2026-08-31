import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AffiliateLink } from "@/components/AffiliateLink";
import ComparisonShareButton from "@/components/compare/ComparisonShareButton";
import { MerchantBadge } from "@/components/ui/MerchantBadge";
import {
  ComparisonOffer,
  findBestOffer,
  formatOfferPrice,
  hasRetailerHref,
  normalizeComparisonOffer,
  parseIdsParam,
  sortComparisonOffers,
} from "@/lib/compare-page";
import { stripMerchantTenantSuffix } from "@/lib/merchant-name";
import { PRODUCT_TAXONOMY } from "@/lib/taxonomy";
import { CompareProductsGrid, type CompareProduct } from "@/components/compare/CompareProductsGrid";
import { getFreshnessTier } from "@/lib/freshness";
import type { DataFreshness } from "@/lib/freshness";
import { buildCompareIndexMetadata } from "@/lib/seo-category-metadata";
import { toSiteUrl } from "@/lib/site-url";
import { inferCategoryFromQuery, filterOffersByCategory } from "@/lib/compare-category-filter";


export const metadata = buildCompareIndexMetadata();

// BUY-67036: Chrome RSC navigation requests carry Next-Router-State-Tree
// + __PAGE__ searchParams. Next 14.2.35 re-runs the page server-side
// against state-tree-derived params. With async loadComparisonOffers +
// the implicit route metadata, the streaming pass can fail and return 500.
// Forcing dynamic rendering on every request makes the re-render safe
// (matches /categories/[slug]/[country]).
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL =
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.BUYWHERE_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

const API_KEY =
  process.env.BUYWHERE_API_KEY ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
  process.env.BUYWHERE_API_INTERNAL_KEY;

type ComparePageProps = {
  searchParams: Promise<{
    q?: string;
    ids?: string;
    // BUY-72773: `p` is the share-link alias for `ids` (single product id surfaced
    // as a short canonical URL on the share button); `from` is the surface tag
    // for attribution (e.g. "blog-cheapest-macbook-air-m3-12-countries-compared").
    p?: string;
    from?: string;
    country?: string;
    country_code?: string;
  }>;
};

// BUY-69732: same CollectionPage entity as before, now inside a @graph so the
// route also carries a BreadcrumbList (Home > Compare) alongside it.
const schemaMarkup = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      "@id": `${toSiteUrl("/compare")}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: toSiteUrl("/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Compare",
          item: toSiteUrl("/compare"),
        },
      ],
    },
    {
      "@type": "CollectionPage",
      "@id": `${toSiteUrl("/compare/")}#collection`,
      name: "Compare Product Prices by Market",
      description:
        "Compare prices on electronics, fashion, home goods, beauty products, and more across the US and Southeast Asia.",
      url: toSiteUrl("/compare/"),
      mainEntityOfPage: toSiteUrl("/compare/"),
      isPartOf: { "@id": `${toSiteUrl("/compare")}#webpage` },
      publisher: {
        "@type": "Organization",
        "@id": `${toSiteUrl("/#organization")}`,
        name: "BuyWhere",
      },
    },
    {
      "@type": "WebPage",
      "@id": `${toSiteUrl("/compare")}#webpage`,
      url: toSiteUrl("/compare"),
      name: "Compare Product Prices by Market",
      description:
        "Compare prices on electronics, fashion, home goods, beauty products, and more across the US and Southeast Asia.",
      inLanguage: "en-US",
      isPartOf: { "@id": "https://buywhere.ai/#website" },
      breadcrumb: { "@id": `${toSiteUrl("/compare")}#breadcrumb` },
    },
  ],
};

async function fetchJson(url: string) {
  if (!API_KEY) {
    throw new Error("BUYWHERE API key is required for compare page live offers");
  }

  // BUY-65450: /compare is a high-intent conversion page (rows show retailer
  // prices and "Open retailer" CTAs). 5-minute Next.js cache combined with
  // the upstream API's 10-minute cache meant stale "Price unavailable" rows
  // lingered for up to 10 min after prices had been updated in the database.
  // Tighten to 60s so a fix or ingest is visible within ~1 minute.
  //
  // Also retry on 429 (rate limit) up to 3 times with exponential backoff so
  // a brief over-cap burst from any Tune/MCP probe falls back gracefully
  // instead of returning "No results found" for what is otherwise a live
  // catalog page.
  const maxAttempts = 3;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
        next: { revalidate: 60, tags: ["compare-offers"] },
      });

      if (response.ok) {
        return response.json();
      }

      lastResponse = response;

      if (response.status !== 429 || attempt === maxAttempts - 1) {
        throw new Error(`API request failed with ${response.status}`);
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Math.max(1, Number(retryAfterHeader) || 1) : 0;
      const backoffMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : Math.min(2000, 250 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError ?? new Error(`API request failed with ${lastResponse?.status ?? "unknown"}`);
}

async function fetchOffersByQuery(query: string, country?: string): Promise<ComparisonOffer[]> {
  const inferredCategory = inferCategoryFromQuery(query);

  const params = new URLSearchParams({
    q: query,
    limit: "8",
  });

  if (country) {
    params.set("country_code", country);
  }

  if (inferredCategory) {
    params.set("category", inferredCategory);
  }

  const data = await fetchJson(`${API_BASE_URL}/v1/products/search?${params.toString()}`);
  const rawItems = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.products)
      ? data.products
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.results)
          ? data.results
          : [];

  const allOffers = sortComparisonOffers(
    rawItems.map((item: Record<string, unknown>) => normalizeComparisonOffer(item)).filter(hasRetailerHref),
  );

  if (inferredCategory && allOffers.length > 0) {
    const { filtered, keptCount } = filterOffersByCategory(allOffers, inferredCategory);
    if (keptCount > 0) {
      return filtered;
    }
  }

  return allOffers;
}

async function fetchOffersByIds(ids: string[]): Promise<ComparisonOffer[]> {
  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const data = await fetchJson(`${API_BASE_URL}/v1/products/${encodeURIComponent(id)}`);
      const rawItem = (data?.product || data?.item || data) as Record<string, unknown>;
      return normalizeComparisonOffer(rawItem);
    }),
  );

  return sortComparisonOffers(
    settled
      .filter((result): result is PromiseFulfilledResult<ComparisonOffer> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(hasRetailerHref),
  );
}

async function loadComparisonOffers(query?: string, ids: string[] = [], country?: string): Promise<ComparisonOffer[]> {
  try {
    if (ids.length > 0) {
      const offersByIds = await fetchOffersByIds(ids);
      if (offersByIds.length > 0) return offersByIds;
    }

    if (query) {
      const offersByQuery = await fetchOffersByQuery(query, country);
      if (offersByQuery.length > 0) return offersByQuery;
    }
  } catch {
  }

  return [];
}

function offerToCompareProduct(offer: ComparisonOffer): CompareProduct {
  const freshness: DataFreshness = getFreshnessTier(offer.lastUpdated ?? '');
  return {
    id: offer.id,
    name: offer.name,
    imageUrl: offer.imageUrl,
    price: offer.price,
    currency: offer.currency,
    merchant: offer.merchant,
    availability: offer.availability,
    inStock: offer.inStock,
    href: offer.href,
    brand: offer.brand,
    category: offer.category,
    lastUpdated: offer.lastUpdated,
    dataFreshness: freshness,
    dealScore: undefined,
    percentVsAvg: undefined,
    specs: undefined,
    priceHistory: undefined,
    market: undefined,
  };
}

function ComparisonSearchForm({
  defaultQuery,
  defaultIds,
}: {
  defaultQuery?: string;
  defaultIds?: string;
}) {
  return (
    <form action="/compare" method="get" className="rounded-[28px] border border-white/20 bg-white/10 p-4 shadow-2xl shadow-slate-950/10 backdrop-blur">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label className="block">
          <span className="sr-only">Search products to compare</span>
          <input
            type="search"
            name="q"
            defaultValue={defaultQuery}
            placeholder="Search a product, like iphone 15 pro"
            className="w-full rounded-2xl border border-white/15 bg-white px-4 py-3 text-base text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-amber-300"
          />
        </label>
        <label className="block">
          <span className="sr-only">Optional product ids</span>
          <input
            type="text"
            name="ids"
            defaultValue={defaultIds}
            placeholder="Or paste ids: 123,456"
            className="w-full rounded-2xl border border-white/15 bg-white px-4 py-3 text-base text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-amber-300"
          />
        </label>
        <button
          type="submit"
          className="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300"
        >
          Compare now
        </button>
      </div>
      <p className="search-form-caption mt-3 text-sm text-[#CBD5E1]">
        Compare by search query or direct product IDs. We sort results by the cheapest available offer first.
      </p>
    </form>
  );
}

function ComparisonAnswerBlock({
  offers,
  intent,
}: {
  offers: ComparisonOffer[];
  intent: string;
}) {
  // BUY-74928 [OPENAI-CHANNEL]: same 40-60-word verdict block on the live /compare
  // surface as the intent pages. Built from the same `offers` array the visible
  // table renders. Skip when fewer than two distinct priced merchants — the
  // indexation directive (§1C) forbids inventing a "next retailer" or a delta.
  const machineDate = new Date();
  const isoDate = machineDate.toISOString();
  const checkedDateText = machineDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const byMerchant = new Map<string, { merchant: string; price: number; currency: string }>();
  for (const offer of offers) {
    if (offer.price === null || offer.price === undefined) continue;
    const numeric = Number(offer.price);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const merchantKey = stripMerchantTenantSuffix(offer.merchant).toLowerCase();
    if (!merchantKey) continue;
    const existing = byMerchant.get(merchantKey);
    if (!existing || numeric < existing.price) {
      byMerchant.set(merchantKey, {
        merchant: stripMerchantTenantSuffix(offer.merchant),
        price: numeric,
        currency: offer.currency || "USD",
      });
    }
  }
  const ranked = Array.from(byMerchant.values()).sort((a, b) => a.price - b.price);

  if (ranked.length < 2) return null;

  const cheapest = ranked[0];
  const next = ranked[1];
  const delta = next.price - cheapest.price;
  const retailerCount = ranked.length;
  const cheapestText = formatOfferPrice(cheapest.price, cheapest.currency);
  const nextText = formatOfferPrice(next.price, next.currency);
  const deltaText = formatOfferPrice(delta, cheapest.currency);

  const verdict = `The cheapest ${intent} today is ${cheapestText} at ${cheapest.merchant}, ${deltaText} less than ${next.merchant} (${nextText}).`;
  const trailing = `Prices checked ${checkedDateText} across ${retailerCount} retailer${retailerCount === 1 ? "" : "s"}.`;

  return (
    <section
      aria-label={`Quick answer for ${intent}`}
      data-answer-block="compare"
      data-answer-checked={isoDate}
      data-answer-retailers={retailerCount}
      className="border-b border-emerald-100 bg-emerald-50 px-4 py-6 sm:px-6"
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800">
          Quick answer
        </p>
        <p className="answer-block-verdict mt-3 text-2xl font-semibold leading-9 text-slate-900 sm:text-3xl">
          {verdict} {trailing}
        </p>
        <p className="answer-block-checked mt-3 text-sm text-slate-700">
          Prices checked{" "}
          <time dateTime={isoDate}>{checkedDateText}</time>
          {" "}across {retailerCount} retailer{retailerCount === 1 ? "" : "s"}.
        </p>
      </div>
    </section>
  );
}

function ComparisonSummary({
  offers,
  query,
  ids,
  fromSurface,
  country,
}: {
  offers: ComparisonOffer[];
  query?: string;
  ids: string[];
  fromSurface: string;
  country: string;
}) {
  const bestOffer = findBestOffer(offers);
  const pricedOffers = offers.filter((offer) => offer.price !== null);
  const highestOffer = pricedOffers[pricedOffers.length - 1] || null;
  const spread =
    bestOffer && highestOffer && bestOffer.price !== null && highestOffer.price !== null
      ? highestOffer.price - bestOffer.price
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="rounded-[28px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-100 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Best available price</p>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">
              {query ? `Results for "${query}"` : "Selected product comparison"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              The view below puts retailer, availability, pricing, and outbound affiliate links on one screen so users can act without jumping between result pages.
            </p>
          </div>
          <ComparisonShareButton
            title={query ? `BuyWhere compare: ${query}` : "BuyWhere product comparison"}
            productIds={ids}
            fromSurface={fromSurface}
            query={query}
            country={country}
          />
        </div>
        {bestOffer ? (
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-white/90 p-5 ring-1 ring-emerald-100">
            <div>
              <MerchantBadge merchant={bestOffer.merchant} />
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {formatOfferPrice(bestOffer.price, bestOffer.currency)}
              </p>
              <p className="mt-1 text-sm text-slate-600">{bestOffer.name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-emerald-700">Highest-intent path</p>
              <p className="mt-1 text-sm text-slate-600">
                {spread !== null
                  ? `Up to ${formatOfferPrice(spread, bestOffer.currency)} saved versus the highest visible offer.`
                  : "Price spread unavailable until more retailer prices are visible."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Retailers shown</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{offers.length}</p>
          <p className="mt-1 text-sm text-slate-600">Offers currently in the comparison set.</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Priced offers</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{pricedOffers.length}</p>
          <p className="mt-1 text-sm text-slate-600">Rows with a usable price for ranking and highlighting.</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Responsive output</p>
          <p className="mt-3 text-lg font-semibold text-slate-950">Table on desktop, cards on mobile</p>
          <p className="mt-1 text-sm text-slate-600">The same data is optimized for scan speed on both layouts.</p>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable({ offers }: { offers: ComparisonOffer[] }) {
  const bestOffer = findBestOffer(offers);
  const machineDate = new Date();
  const checkedDateText = machineDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const isoDate = machineDate.toISOString();

  return (
    <>
      {/* BUY-74926: visible "Prices checked <date>" line. AI crawlers that don't run
          JS (OAI-SearchBot, GPTBot, ClaudeBot) extract this plain-text date and pair
          it with the per-row prices below. Machine-readable ISO duplicate on <time>
          so downstream checkers can parse deterministically. */}
      <p className="mb-4 text-sm text-slate-600" data-ssr-prices-checked={isoDate}>
        Prices checked <time dateTime={isoDate}>{checkedDateText}</time>.{" "}
        {offers.length} retailer{offers.length === 1 ? "" : "s"} compared.
      </p>
      <div className="hidden overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm lg:block">
        <table className="min-w-full divide-y divide-slate-200">
          <caption className="sr-only">Retailer price comparison, checked {checkedDateText}.</caption>
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Retailer</th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Product</th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Availability</th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Price</th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {offers.map((offer) => {
              const isBest = bestOffer?.id === offer.id;

              return (
                <tr key={offer.id} className={isBest ? "bg-emerald-50/70" : "bg-white"}>
                  <td className="px-6 py-5 align-top">
                    <div className="space-y-2">
                      <MerchantBadge merchant={offer.merchant} />
                      {isBest ? (
                        <span className="inline-flex rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                          Best price
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-6 py-5 align-top">
                    <div className="flex items-start gap-4">
                      <div className="h-20 w-20 overflow-hidden rounded-2xl bg-slate-100">
                        {offer.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={offer.imageUrl} alt={offer.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-2xl text-slate-400">◎</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-base font-semibold text-slate-950">{offer.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
                          {offer.brand ? <span>{offer.brand}</span> : null}
                          {offer.category ? <span>{offer.category}</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 align-top">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                        offer.inStock === true
                          ? "bg-emerald-100 text-emerald-800"
                          : offer.inStock === false
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {offer.availability}
                    </span>
                  </td>
                  <td className="px-6 py-5 align-top" data-merchant={offer.merchant}>
                    <p className={`text-xl font-semibold ${isBest ? "text-emerald-700" : "text-slate-950"}`}>
                      <span data-price={offer.price ?? undefined}>{formatOfferPrice(offer.price, offer.currency)}</span>
                    </p>
                    {offer.lastUpdated ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Updated {new Date(offer.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-6 py-5 align-top">
                    <AffiliateLink
                      href={offer.href}
                      productId={offer.id}
                      platform={offer.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "_")}
                      productName={offer.name}
                      utmCampaign="compare_page"
                      className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                        isBest
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-slate-900 text-white hover:bg-slate-800"
                      }`}
                    >
                      Open retailer
                    </AffiliateLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:hidden">
        {offers.map((offer) => {
          const isBest = bestOffer?.id === offer.id;

          return (
            <article
              key={offer.id}
              className={`overflow-hidden rounded-[28px] border p-5 shadow-sm ${
                isBest ? "border-emerald-300 bg-emerald-50/70" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <MerchantBadge merchant={offer.merchant} />
                {isBest ? (
                  <span className="inline-flex rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                    Best price
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex gap-4">
                <div className="h-20 w-20 overflow-hidden rounded-2xl bg-slate-100">
                  {offer.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={offer.imageUrl} alt={offer.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl text-slate-400">◎</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-base font-semibold text-slate-950">{offer.name}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
                    {offer.brand ? <span>{offer.brand}</span> : null}
                    {offer.category ? <span>{offer.category}</span> : null}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 rounded-3xl bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">Availability</span>
                  <span className="text-sm font-medium text-slate-900">{offer.availability}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">Price</span>
                  <span className={`text-lg font-semibold ${isBest ? "text-emerald-700" : "text-slate-950"}`}>
                    {formatOfferPrice(offer.price, offer.currency)}
                  </span>
                </div>
              </div>
              <AffiliateLink
                href={offer.href}
                productId={offer.id}
                platform={offer.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "_")}
                productName={offer.name}
                utmCampaign="compare_page"
                className={`mt-4 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                  isBest ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                Open retailer
              </AffiliateLink>
            </article>
          );
        })}
      </div>
    </>
  );
}

function CategoryGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {PRODUCT_TAXONOMY.map((category) => (
        <Link
          key={category.id}
          href={`/compare/${category.slug}`}
          className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all p-6"
        >
          <div className="text-4xl mb-4">{category.icon}</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-indigo-600 transition-colors">
            {category.name}
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed">{category.description}</p>
          <div className="mt-4 text-sm font-medium text-indigo-600 group-hover:text-indigo-700">
            Compare prices →
          </div>
        </Link>
      ))}
    </div>
  );
}

export default async function CompareIndexPage({ searchParams }: ComparePageProps) {
  // BUY-67036: await the searchParams Promise (Next 15 style) so the
  // route resolver doesn't trip the legacy sync-searchParams code path
  // that throws 'The router state header was sent but could not be parsed.'
  // on RSC navigation re-render.
  let resolved: Awaited<ComparePageProps['searchParams']> = {};
  try {
    resolved = await searchParams;
  } catch {
    resolved = {};
  }
  const query = (resolved?.q ?? "").trim();
  // BUY-72773: `p` is the canonical share-link alias for a single product id;
  // accept it directly, fall back to legacy `ids`, and join both so URLs like
  // /compare?p=macbook-air-m3&from=blog-... still work alongside the older
  // /compare?ids=... form.
  const rawP = (resolved?.p ?? "").trim();
  const rawIds = resolved?.ids ?? "";
  const ids = parseIdsParam([rawP, rawIds].filter(Boolean).join(","));
  const fromSurface = (resolved?.from ?? "").trim().toLowerCase().slice(0, 64);
  const country = (resolved?.country_code ?? resolved?.country ?? "").trim().toLowerCase();
  const showComparison = query.length > 0 || ids.length > 0;
  // BUY-67036: belt-and-suspenders around loadComparisonOffers so that even
  // if the internal try/catch misses something during RSC re-render, the
  // route still returns 200 with the empty-state UI rather than 500.
  let offers: ComparisonOffer[] = [];
  if (showComparison) {
    try {
      offers = await loadComparisonOffers(query, ids, country);
    } catch {
      offers = [];
    }
  }
  const emptyStateTitle = query
    ? `No results found for “${query}”`
    : ids.length > 0
      ? "No results found for those product IDs"
      : "Try a product query to start comparing";
  const emptyStateDescription = query
    ? "We searched for that query but did not find comparable retailer offers. Try a broader product name, remove brand qualifiers, or paste direct product IDs."
    : ids.length > 0
      ? "We checked the requested product IDs but did not find retailer offers ready to compare. Check the IDs or try a natural-language product query."
      : "Enter a product name or paste product IDs to compare prices, availability, imagery, and affiliate destinations.";

  const compareProducts: CompareProduct[] = offers.map(offerToCompareProduct);

  // BUY-74926: per-Offer JSON-LD so AI crawlers get the same retailer/price/currency
  // data the visible table shows. Mirrors each row of ComparisonTable exactly.
  const compareOfferSchema = offers.length > 0
    ? {
        "@context": "https://schema.org",
        "@graph": offers
          .map((offer) => {
            if (offer.price === null || offer.price === undefined) return null;
            return {
              "@type": "Offer",
              name: offer.name,
              price: Number(offer.price).toFixed(2),
              priceCurrency: offer.currency || "USD",
              availability:
                offer.inStock === true
                  ? "https://schema.org/InStock"
                  : offer.inStock === false
                    ? "https://schema.org/OutOfStock"
                    : "https://schema.org/Discontinued",
              url: offer.href,
              seller: { "@type": "Organization", name: offer.merchant },
            };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null),
      }
    : null;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />
      {compareOfferSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(compareOfferSchema) }}
        />
      )}

      <main id="main-content" tabIndex={-1} className="flex-1">
        {/* BUY-74928: answer block FIRST in DOM order, before the hero / nav-
            heavy markup. Only renders on the live-offers surface (when there
            are priced offers); renders nothing on the empty / homepage. */}
        {(query || ids.length > 0) && offers.length >= 2 && (
          <ComparisonAnswerBlock
            offers={offers}
            intent={query || `product ${ids.join(", ")}`}
          />
        )}
        <section className="bg-gradient-to-br from-indigo-700 via-slate-900 to-sky-900 text-white py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-300">Comparison workspace</p>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold">
              Side-by-side retailer pricing at <span className="text-amber-300">/compare</span>
            </h1>
            <p className="mt-5 text-lg text-indigo-100">
              Search one product or paste explicit IDs to compare price, availability, imagery, and affiliate destinations without context switching.
            </p>
            <p className="hero-metadata mt-4 text-xs uppercase tracking-[0.22em] text-[#CBD5E1]">
              Last refreshed: June 18, 2026 · live data cached for 5 minutes
            </p>
          </div>
          <div className="mt-10">
            <ComparisonSearchForm defaultQuery={query} defaultIds={rawIds} />
          </div>
        </div>
      </section>

      <section className="py-16 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {showComparison ? (
            offers.length > 0 ? (
              <div className="space-y-8">
                <ComparisonSummary
                  offers={offers}
                  query={query || undefined}
                  ids={ids}
                  fromSurface={fromSurface}
                  country={country}
                />
                {ids.length > 1 ? (
                  <CompareProductsGrid
                    products={compareProducts}
                    title={`Comparing ${compareProducts.length} products`}
                    productIds={ids}
                    fromSurface={fromSurface}
                    query={query}
                    country={country}
                  />
                ) : (
                  <ComparisonTable offers={offers} />
                )}
              </div>
            ) : (
              <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
                <h2 className="text-2xl font-semibold text-slate-950">{emptyStateTitle}</h2>
                <p className="mt-3 text-sm text-slate-600">
                  {emptyStateDescription}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-12">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Built for intent-rich traffic</p>
                  <h2 className="mt-4 text-3xl font-semibold text-slate-950">A comparison view that reduces bounce before the affiliate click</h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
                    Use a natural-language product query like <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">/compare?q=iphone+15+pro</code>, or pin a specific set of offers with <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">/compare?ids=product_id_1,product_id_2</code>.
                  </p>
                </div>
                <div className="rounded-[32px] border border-amber-200 bg-amber-50 p-8 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">What the page shows</p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-700">
                    <li>Retailer badges and outbound affiliate actions</li>
                    <li>Best price highlighted in green</li>
                    <li>Availability and image context beside price</li>
                    <li>Mobile cards and desktop table from one route</li>
                  </ul>
                </div>
              </div>

              <CategoryGrid />
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
            Related category guides
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900">
            Editorial refreshes for high-intent categories
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
            Each guide below pulls live retailer pricing through BuyWhere&apos;s catalog and was last refreshed on June 18, 2026 to give GSC a fresh recrawl signal.
          </p>
          <ul className="mt-6 grid gap-3 text-sm text-indigo-700 sm:grid-cols-3">
            <li>
              <Link
                href="/blog/best-laptop-deals-singapore"
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium hover:border-indigo-200 hover:bg-indigo-50"
              >
                Best laptop deals in Singapore →
              </Link>
            </li>
            <li>
              <Link
                href="/blog/cheapest-iphone-singapore-2026"
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium hover:border-indigo-200 hover:bg-indigo-50"
              >
                Cheapest iPhone in Singapore 2026 →
              </Link>
            </li>
            <li>
              <Link
                href="/blog/best-gaming-laptops-us-2026"
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium hover:border-indigo-200 hover:bg-indigo-50"
              >
                Best gaming laptops in the US (2026) →
              </Link>
            </li>
          </ul>
        </div>
      </section>

      </main>

      <Footer />
    </div>
  );
}
