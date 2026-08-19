import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSeoLandingFallbackProduct } from "@/lib/seo-landing-pages";
import { buildProductDetailGraph } from "@/lib/product-schema";
import { renderProductLlmsSnippet } from "@/lib/llms-snippets";

// BUY-71642: Serve the short-alias PDP /p/{id} that the catalog API emits as
// click_url/url on search result cards. The canonical form is /products/us/{slug}/{id}.
// This page is the canonical alias; it must render the same content and emit a
// canonical URL pointing to the 2-segment form.

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
  merchant_slug?: string | null;
  data_updated_at?: string;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  affiliate_url?: string | null;
  buy_url?: string | null;
  product_url?: string | null;
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
  merchant_slug?: string | null;
  updated_at?: string | null;
  click_url?: string | null;
  affiliate_redirect_url?: string | null;
  affiliate_url?: string | null;
  buy_url?: string | null;
  url?: string | null;
  product_url?: string | null;
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
    image_url: item.image_url ?? null,
    category: item.category ?? undefined,
    brand: item.brand ?? undefined,
    merchant_name: item.merchant ?? item.merchant_name ?? undefined,
    merchant_slug: item.merchant_slug ?? null,
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
      // BUY-71642 gate #3: enforce HTTP status, not just JSON body content.
      // The /api/products/[id] route returns 404 for unknown ids, but that
      // status must propagate to the page render (not become a soft-200).
      if (!res.ok) {
        // Throw so we skip the fallback and let notFound() render the shell.
        // The middleware will convert this to a hard 404 before streaming.
        throw new Error(`product_fetch_${res.status}`);
      }
      const payload = (await res.json()) as ProductDetail | { data?: ApiProductItem[] };
      const item = Array.isArray((payload as { data?: ApiProductItem[] }).data)
        ? (payload as { data: ApiProductItem[] }).data[0]
        : (payload as ProductDetail);
      if (item?.id) return mapApiProduct(item as ApiProductItem);
    } catch (err) {
      console.warn(`[/p/${productId}] internal API error:`, err);
    }
  }

  // Fall back to curated SEO landing page products if the API is unavailable
  const fallback = await getSeoLandingFallbackProduct("us", productId, "catalog");
  if (!fallback) return null;
  return {
    id: fallback.id,
    name: fallback.name,
    description: `${fallback.name} is available from ${fallback.merchant}. Compare current pricing and merchant options on BuyWhere.`,
    price: fallback.price ?? undefined,
    image_url: fallback.imageUrl,
    category: fallback.category ?? undefined,
    brand: fallback.brand ?? undefined,
    merchant_name: fallback.merchant,
    merchant_slug: null,
    affiliate_redirect_url: null,
    click_url: null,
    affiliate_url: null,
    buy_url: null,
    product_url: null,
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

// BUY-71642: Belt-and-suspenders security guard on the id param.
// Next.js already enforces no /.., but we additionally reject any non-alphanumeric id
// to prevent path-traversal-adjacent edge cases and ensure a hard 404 for garbage ids.
const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  if (!VALID_ID_RE.test(id)) {
    return { title: "Product Not Found", robots: { index: false, follow: false } };
  }

  const product = await getProduct(id);
  if (!product) {
    return { title: "Product Not Found", robots: { index: false, follow: false } };
  }

  const productName = product.name ?? product.title ?? `Product ${id}`;
  const merchantSlug = product.merchant_slug ?? "catalog";
  // Canonical URL: 2-segment form
  const canonicalUrl = `https://buywhere.ai/products/us/${merchantSlug}/${id}/`;

  return {
    title: `${productName} — ${product.merchant_name ?? "BuyWhere US"} | BuyWhere US`,
    description: product.description
      ? product.description.slice(0, 160)
      : `Buy ${productName} from ${product.merchant_name ?? "BuyWhere"} in the US. Compare prices and find the best deals on BuyWhere.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${productName} — ${product.merchant_name ?? "BuyWhere US"} | BuyWhere US`,
      description: `Buy ${productName} from ${product.merchant_name ?? "BuyWhere"} in the US.`,
      url: canonicalUrl,
      type: "website",
      images: product.image_url
        ? [{ url: product.image_url, width: 800, height: 800, alt: productName }]
        : [{ url: "/og-image.png", width: 1200, height: 630, alt: productName }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${productName} — ${product.merchant_name ?? "BuyWhere US"} | BuyWhere US`,
      description: `Buy ${productName} from ${product.merchant_name ?? "BuyWhere"} in the US.`,
      images: product.image_url ? [product.image_url] : ["/og-image.png"],
    },
    // BUY-71642 gate #5: real PDP must be indexable (not noindex)
    robots: { index: true, follow: true },
  };
}

export default async function ShortAliasProductPage({ params }: PageProps) {
  const { id } = await params;

  // BUY-71642: belt-and-suspenders guard — reject ids with suspicious chars
  if (!VALID_ID_RE.test(id)) {
    notFound();
  }

  const product = await getProduct(id);
  if (!product) {
    // BUY-71642 gate #3: hard 404 for unknown ids (not 200-with-404-body)
    notFound();
  }

  const productName = product.name ?? product.title ?? `Product ${id}`;
  const merchantName = product.merchant_name ?? "BuyWhere";
  const merchantSlug = product.merchant_slug ?? "catalog";
  const pagePath = `/products/us/${merchantSlug}/${id}/`;
  const description =
    product.description ?? `${productName} available from ${merchantName} in the US.`;

  // BUY-71642 gate #5: Product + Offer JSON-LD
  const schema = buildProductDetailGraph({
    product: {
      path: pagePath,
      name: productName,
      description,
      image: product.image_url ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      sku: String(product.id),
      offer:
        product.price != null
          ? {
              price: product.price,
              priceCurrency: "USD",
              sellerName: merchantName,
            }
          : null,
    },
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: `${merchantName} Products`, path: `/us/${merchantSlug}/products/` },
      { name: productName, path: pagePath },
    ],
  });

  const llmsSnippet = renderProductLlmsSnippet({
    country: "us",
    productId: String(product.id),
    title: productName,
    description,
    currency: "USD",
    price: product.price ?? null,
    availability: "local",
    brand: product.brand ?? "",
    category: product.category ?? "",
    merchantSlug,
    merchantName,
    url: `https://buywhere.ai${pagePath}`,
    imageUrl: product.image_url ?? "",
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <script
        type="text/llms.txt"
        dangerouslySetInnerHTML={{ __html: llmsSnippet }}
      />
      <main id="main-content" className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500">
          <ol className="flex items-center gap-2 flex-wrap">
            <li>
              <Link href="/" className="hover:text-indigo-600">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/us" className="hover:text-indigo-600">
                US
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium line-clamp-1">
              {productName}
            </li>
          </ol>
        </nav>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {product.image_url && (
            <div className="aspect-square max-h-64 overflow-hidden bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.image_url}
                alt={productName}
                className="w-full h-full object-contain p-4"
              />
            </div>
          )}

          <div className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {productName}
            </h1>

            {product.brand && (
              <p className="text-sm text-gray-500 mb-4">
                by{" "}
                <span className="text-gray-700 font-medium">{product.brand}</span>
              </p>
            )}

            {product.price != null && (
              <div className="mb-4">
                <span className="text-3xl font-bold text-indigo-600">
                  ${Number(product.price).toFixed(2)}
                </span>
              </div>
            )}

            {(() => {
              const ctaUrl = pickPrimaryCtaUrl(product);
              const fallbackHref = `/us/${merchantSlug}/products/`;
              const targetUrl = ctaUrl ?? fallbackHref;
              const isExternal = ctaUrl
                ? /^https?:\/\//i.test(ctaUrl)
                : false;
              return (
                <div className="mb-6">
                  <a
                    href={targetUrl}
                    {...(isExternal
                      ? {
                          target: "_blank",
                          rel: "noopener noreferrer sponsored",
                        }
                      : {})}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {ctaUrl ? `View at ${merchantName}` : `View all from ${merchantName}`}
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
              );
            })()}

            <p className="text-sm text-gray-600 mb-4">
              Available from{" "}
              <span className="text-gray-700 font-medium">{merchantName}</span>{" "}
              in the United States.
            </p>

            {product.description && (
              <div className="prose prose-sm text-gray-700 mt-4">
                <p>{product.description}</p>
              </div>
            )}

            {product.category && (
              <p className="mt-4 text-xs text-gray-500">
                Category: {product.category}
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
