import { toSiteUrl } from "@/lib/site-url";
import { normalizeUSMerchantPrice, type USMerchantPrice, type USProductOfferApiItem } from "@/lib/us-products";
import { buildAffiliateRedirectFromProductId, buildAffiliateRedirectHref } from "@/lib/affiliate-redirect";

const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

// BUY-74926 — server-rendered, AI-crawler-visible price table for /products/us/<slug>.
// Renders a plain HTML <table> with retailer, price, currency and availability, plus a
// visible "Prices checked <Month D, YYYY>" line and a Product JSON-LD offers graph that
// matches the visible rows exactly. Lives outside the USProductDetail client island so
// crawlers that do not run JS (OAI-SearchBot, GPTBot, ClaudeBot) still see real prices.

export interface USProductSsrPriceTableProps {
  productName: string;
  productId: string;
  pagePath: string;
  description?: string;
  imageUrl?: string | null;
  brand?: string;
  category?: string;
  sku?: string;
  matches: USProductOfferApiItem[];
}

function formatPriceNumber(value: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    const symbol = currency === "USD" ? "$" : currency === "SGD" ? "S$" : "";
    return symbol ? `${symbol} ${formatted}` : `${formatted} ${currency}`;
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatCheckedDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function USProductSsrPriceTable({
  productName,
  productId,
  pagePath,
  description,
  imageUrl,
  brand,
  category,
  sku,
  matches,
}: USProductSsrPriceTableProps) {
  const rows: USMerchantPrice[] = matches
    .map(normalizeUSMerchantPrice)
    .filter((p): p is USMerchantPrice => Boolean(p));

  const machineDate = new Date();
  const checkedDateText = formatCheckedDate(machineDate);
  const isoDate = machineDate.toISOString();

  const pricedRows = rows.filter((r) => r.price !== null);

  if (pricedRows.length === 0) {
    return null;
  }

  const offersForSchema = pricedRows
    .map((row) => {
      const numericPrice = row.price != null ? Number(row.price) : NaN;
      if (!Number.isFinite(numericPrice)) return null;
      return {
        "@type": "Offer",
        price: numericPrice.toFixed(2),
        priceCurrency: "USD",
        availability: row.inStock ? IN_STOCK : OUT_OF_STOCK,
        url: row.url,
        seller: {
          "@type": "Organization",
          name: row.merchant,
        },
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  if (offersForSchema.length === 0) {
    return null;
  }

  const numericPrices = offersForSchema.map((o) => Number(o.price));
  const pageUrl = toSiteUrl(pagePath);
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${pageUrl}#product`,
    url: pageUrl,
    name: productName,
    description:
      description ?? `Compare current retailer pricing for ${productName} on BuyWhere.`,
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    ...(category ? { category } : {}),
    ...(sku ? { sku } : {}),
    offers: [
      ...offersForSchema,
      {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: Math.min(...numericPrices).toFixed(2),
        highPrice: Math.max(...numericPrices).toFixed(2),
        offerCount: offersForSchema.length,
        availability: IN_STOCK,
        sellers: pricedRows.map((r) => ({
          "@type": "Organization",
          name: r.merchant,
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <section
        aria-labelledby={`ssr-prices-${productId}`}
        data-ssr-prices="us-product"
        className="mx-auto max-w-4xl px-4 py-6 sm:px-6"
      >
        <h2 id={`ssr-prices-${productId}`} className="text-xl font-semibold text-gray-900 mb-3">
          Price comparison for {productName}
        </h2>
        <p
          className="mb-4 text-sm text-gray-600"
          data-ssr-prices-checked={isoDate}
        >
          Prices checked <time dateTime={isoDate}>{checkedDateText}</time>. BuyWhere compares
          {" "}{pricedRows.length} retailer{pricedRows.length === 1 ? "" : "s"} for this
          product across the United States.
        </p>
        <table className="min-w-full divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white text-left text-sm shadow-sm">
          <caption className="sr-only">
            Live price comparison for {productName}, checked {checkedDateText}.
          </caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Retailer</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Price</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Currency</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Availability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pricedRows.map((row) => {
              const numericPrice = row.price != null ? Number(row.price) : NaN;
              const displayPrice = Number.isFinite(numericPrice)
                ? formatPriceNumber(numericPrice, "USD")
                : "Price unavailable";
              // BUY-75417: prefer the row-level /r/… URL when the API gives us
              // one (mature catalog rows) and fall back to a /r/direct/{id}
              // built from the product id (newer / degraded rows that only
              // carry raw merchant URLs in `row.url`).
              const merchantHref =
                buildAffiliateRedirectHref(row.url) ??
                buildAffiliateRedirectFromProductId(productId, "us_table");
              return (
                <tr key={row.merchant}>
                  <th scope="row" className="px-4 py-3 font-medium text-gray-900">
                    <a
                      href={merchantHref}
                      target="_blank"
                      rel="nofollow sponsored noopener noreferrer"
                      data-affiliate-redirect="us-product-table"
                      className="text-indigo-600 hover:text-indigo-700 hover:underline"
                    >
                      {row.merchant}
                    </a>
                  </th>
                  <td className="px-4 py-3 text-gray-900" data-merchant={row.merchant}>
                    <span data-price={`${numericPrice}`}>{displayPrice}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">USD</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.inStock ? "In Stock" : "Out of Stock"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}