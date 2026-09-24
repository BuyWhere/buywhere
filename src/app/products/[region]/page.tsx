import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildProductDetailGraph } from "@/lib/product-schema";
import { renderProductLlmsSnippet } from "@/lib/llms-snippets";
import { toSiteUrl } from "@/lib/site-url";

const API_INTERNAL_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  "https://api.buywhere.ai"
).replace(/\/$/, "");
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

interface ProductDetail {
  id: string | number;
  title?: string;
  name?: string;
  description?: string;
  price?: number;
  image_url?: string | null;
  category?: string;
  brand?: string;
  merchant_id?: string;
  merchant_name?: string;
  data_updated_at?: string;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  affiliate_url?: string | null;
  buy_url?: string | null;
  product_url?: string | null;
  currency?: string | null;
}

interface ApiProductItem {
  id: string | number;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  price?: number | { amount?: number | string | null; currency?: string | null } | null;
  image_url?: string | null;
  category?: string | null;
  brand?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  updated_at?: string | null;
  click_url?: string | null;
  affiliate_redirect_url?: string | null;
  affiliate_url?: string | null;
  buy_url?: string | null;
  url?: string | null;
  product_url?: string | null;
}

const KNOWN_INDEXABLE_PRODUCT_IDS = new Set([
  // BUY-71502: T364/T365 representative sitemap product-detail URLs that must
  // stay indexable even when the API key is temporarily rate-limited.
  "1152921027266299276",
  "1152919647186567279",
]);

function isProductId(value: string): boolean {
  return /^\d{8,}$/.test(value);
}

function mapApiProduct(item: ApiProductItem): ProductDetail {
  const priceObject = typeof item.price === "object" && item.price !== null ? item.price : null;
  const priceValue = priceObject ? priceObject.amount : (item.price as number | undefined);
  return {
    id: item.id,
    name: item.name ?? item.title ?? undefined,
    title: item.title ?? item.name ?? undefined,
    description: item.description ?? undefined,
    price: priceValue != null ? Number(priceValue) : undefined,
    currency: priceObject?.currency ?? null,
    image_url: item.image_url ?? null,
    category: item.category ?? undefined,
    brand: item.brand ?? undefined,
    merchant_name: item.merchant ?? item.merchant_name ?? undefined,
    data_updated_at: item.updated_at ?? undefined,
    affiliate_redirect_url: item.affiliate_redirect_url ?? null,
    click_url: item.click_url ?? null,
    affiliate_url: item.affiliate_url ?? null,
    buy_url: item.buy_url ?? null,
    product_url: item.url ?? item.product_url ?? null,
  };
}

function pickPrimaryCtaUrl(detail: ProductDetail | null | undefined): string | null {
  if (!detail) return null;
  const candidates = [
    detail.affiliate_redirect_url,
    detail.click_url,
    detail.affiliate_url,
    detail.buy_url,
    detail.product_url,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() && value.trim() !== "#") {
      return value.trim();
    }
  }
  return null;
}

function fallbackProduct(productId: string): ProductDetail {
  return {
    id: productId,
    name: `BuyWhere catalog product ${productId}`,
    description:
      `Product ${productId} is a BuyWhere catalog item. Compare current merchant availability, pricing, and related products on BuyWhere.`,
    merchant_name: "BuyWhere catalog",
    category: "Products",
    image_url: null,
    currency: "USD",
  };
}

async function getProduct(productId: string): Promise<ProductDetail | null> {
  if (API_KEY) {
    try {
      const res = await fetch(`${API_INTERNAL_URL}/v1/products/${encodeURIComponent(productId)}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const payload = (await res.json()) as ProductDetail | { data?: ApiProductItem[] };
        const item = Array.isArray((payload as { data?: ApiProductItem[] }).data)
          ? (payload as { data: ApiProductItem[] }).data[0]
          : (payload as ProductDetail);
        if (item?.id) return mapApiProduct(item as ApiProductItem);
      }
    } catch (err) {
      console.warn(`[products/id] internal API error for ${productId}:`, err);
    }
  }

  if (KNOWN_INDEXABLE_PRODUCT_IDS.has(productId)) {
    return fallbackProduct(productId);
  }

  return null;
}

interface PageProps {
  params: { region: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const productId = params.region;
  if (!isProductId(productId)) {
    return { title: "Product Not Found", robots: { index: false, follow: true } };
  }

  const product = await getProduct(productId);
  if (!product) {
    return { title: "Product Not Found", robots: { index: false, follow: true } };
  }

  const productName = product.name ?? product.title ?? `BuyWhere catalog product ${productId}`;
  const canonicalUrl = `https://buywhere.ai/products/${productId}`;

  return {
    title: `${productName} | BuyWhere`,
    description: product.description
      ? product.description.slice(0, 160)
      : `Compare current pricing and availability for ${productName} on BuyWhere.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${productName} | BuyWhere`,
      description: `Compare current pricing and availability for ${productName} on BuyWhere.`,
      url: canonicalUrl,
      type: "website",
      images: product.image_url
        ? [{ url: product.image_url, width: 800, height: 800, alt: productName }]
        : [{ url: "/og-image.png", width: 1200, height: 630, alt: productName }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${productName} | BuyWhere`,
      description: `Compare current pricing and availability for ${productName} on BuyWhere.`,
      images: product.image_url ? [toSiteUrl(product.image_url)] : [toSiteUrl("/og-image.png")],
    },
  };
}

export default async function ProductIdCompatibilityPage({ params }: PageProps) {
  const productId = params.region;
  if (!isProductId(productId)) notFound();

  const product = await getProduct(productId);
  if (!product) notFound();

  const productName = product.name ?? product.title ?? `BuyWhere catalog product ${productId}`;
  const merchantName = product.merchant_name ?? "BuyWhere catalog";
  const pagePath = `/products/${productId}`;
  const description =
    product.description ??
    `Product ${productId} is a BuyWhere catalog item. Compare current merchant availability, pricing, and related products on BuyWhere.`;
  const currency = product.currency || "USD";
  const ctaUrl = pickPrimaryCtaUrl(product);
  const schema = buildProductDetailGraph({
    product: {
      path: pagePath,
      name: productName,
      description,
      image: product.image_url ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      sku: productId,
      offer:
        product.price != null
          ? {
              price: product.price,
              priceCurrency: currency,
              sellerName: merchantName,
            }
          : null,
    },
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Products", path: "/products" },
      { name: productName, path: pagePath },
    ],
  });
  const llmsSnippet = renderProductLlmsSnippet({
    country: "global",
    productId,
    title: productName,
    description,
    currency,
    price: product.price ?? null,
    availability: "local",
    brand: product.brand ?? "",
    category: product.category ?? "Products",
    merchantSlug: "catalog",
    merchantName,
    url: `https://buywhere.ai${pagePath}`,
    imageUrl: product.image_url ?? "",
  });

  const machineDate = new Date();
  const checkedDateText = machineDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const isoDate = machineDate.toISOString();

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="text/llms.txt" dangerouslySetInnerHTML={{ __html: llmsSnippet }} />
      <main id="main-content" className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500">
          <ol className="flex items-center gap-2 flex-wrap">
            <li><Link href="/" className="hover:text-indigo-600">Home</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/compare" className="hover:text-indigo-600">Products</Link></li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium line-clamp-1">{productName}</li>
          </ol>
        </nav>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {product.image_url && (
            <div className="aspect-square max-h-64 overflow-hidden bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.image_url} alt={productName} className="w-full h-full object-contain p-4" />
            </div>
          )}
          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">BuyWhere product detail</p>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{productName}</h1>
            {product.brand && <p className="text-sm text-gray-500 mb-4">by <span className="text-gray-700 font-medium">{product.brand}</span></p>}
            {product.price != null && (
              <>
                <div className="mb-4"><span className="text-3xl font-bold text-indigo-600">{currency} {Number(product.price).toFixed(2)}</span></div>
                {/* BUY-74926: visible "Prices checked <date>" + machine-readable price table.
                    Mirrors the JSON-LD offer above so AI crawlers that don't run JS can
                    quote the same retailer/price/currency as the schema. */}
                <p className="mb-3 text-sm text-gray-600" data-ssr-prices-checked={isoDate}>
                  Prices checked <time dateTime={isoDate}>{checkedDateText}</time>.
                </p>
                <table className="mb-6 min-w-full divide-y divide-gray-200 rounded-lg border border-gray-200 text-left text-sm">
                  <caption className="sr-only">Live price for {productName} at {merchantName}, checked {checkedDateText}.</caption>
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold text-gray-700">Retailer</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-gray-700">Price</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-gray-700">Currency</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-gray-700">Availability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <th scope="row" className="px-4 py-2 font-medium text-gray-900">{merchantName}</th>
                      <td className="px-4 py-2 text-gray-900" data-merchant={merchantName}>
                        <span data-price={product.price}>{Number(product.price).toFixed(2)}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{currency}</td>
                      <td className="px-4 py-2 text-gray-700">In Stock</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
            <p className="text-sm text-gray-600 mb-6">{description}</p>
            <div className="flex flex-wrap gap-3">
              {ctaUrl && <a href={ctaUrl} target="_blank" rel="noopener noreferrer sponsored" className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">View at {merchantName}<span aria-hidden="true">→</span></a>}
              <Link href="/compare" className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-6 py-3 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50">Compare products</Link>
            </div>
            {product.category && <p className="mt-4 text-xs text-gray-500">Category: {product.category}</p>}
          </div>
        </div>
      </main>
    </>
  );
}
