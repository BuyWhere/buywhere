import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getSeoLandingFallbackProduct, type LandingProduct } from "@/lib/seo-landing-pages";
import { extractLegacyProductQuery } from "@/lib/legacy-product-redirect";
import { buildProductDetailGraph } from "@/lib/product-schema";
import { buildAffiliateRedirectUrl } from "@/lib/click-attribution";

// BUY-69630: call the API service directly via the Railway internal URL with
// the SSR-held API key. The Next.js site has a /api/* rewrite that proxies
// all /api/* to api.buywhere.ai/v1/* (next.config.mjs), which shadows the
// internal /api/products/[id] route handler. Calling the API service directly
// bypasses the rewrite and the SSR runtime already holds BUYWHERE_API_KEY.
const API_INTERNAL_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  "https://api.buywhere.ai"
).replace(/\/$/, "");
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

// Static us/sg directories take priority over this [region] catch-all.
// This page handles product detail pages for all other regions: my, th, id, ph, vn.
const REGION_CONFIG: Record<string, { currency: string; countryName: string }> = {
  my: { currency: "MYR", countryName: "Malaysia" },
  th: { currency: "THB", countryName: "Thailand" },
  id: { currency: "IDR", countryName: "Indonesia" },
  ph: { currency: "PHP", countryName: "Philippines" },
  vn: { currency: "VND", countryName: "Vietnam" },
};

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
  // Outbound CTA target. Prefer affiliate redirect, then click-through, then
  // generic buy/product URL. The SSR PDP renders a primary action button only
  // when one of these is present (see BUY-65451).
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

function mapApiProduct(item: ApiProductItem): ProductDetail {
  const priceValue =
    typeof item.price === "object" && item.price !== null
      ? item.price.amount
      : (item.price as number | undefined);
  return {
    id: item.id,
    name: item.name ?? item.title ?? undefined,
    title: item.title ?? item.name ?? undefined,
    price: priceValue != null ? Number(priceValue) : undefined,
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

function landingProductToDetail(product: LandingProduct): ProductDetail {
  return {
    id: product.id,
    name: product.name,
    description: `${product.name} is available from ${product.merchant}. Compare current pricing and merchant options on BuyWhere.`,
    price: product.price ?? undefined,
    image_url: product.imageUrl,
    category: product.category ?? undefined,
    brand: product.brand ?? undefined,
    merchant_name: product.merchant,
    affiliate_redirect_url: null,
    click_url: null,
    affiliate_url: null,
    buy_url: null,
    product_url: null,
  };
}

async function getProduct(productId: string): Promise<ProductDetail | null> {
  // BUY-69630: fetch the live catalog record directly from the internal API
  // service using the SSR-held API key. The site's /api/* rewrite shadows the
  // internal Next.js route handler, so SSR calls the API service directly.
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
      console.warn(`[products/region] internal API error for ${productId}:`, err);
    }
  }

  return null;
}

interface PageProps {
  params: Promise<{ region: string; slug: string; productId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { region, slug: merchantSlug, productId } = await params;

  const regionConfig = REGION_CONFIG[region];
  if (!regionConfig) {
    return { title: "Product Not Found" };
  }

  const apiProduct = await getProduct(productId);
  // BUY-69736: getSeoLandingFallbackProduct is now async (image repair probe).
  const fallbackProduct = apiProduct ? null : await getSeoLandingFallbackProduct(region, productId, merchantSlug);
  if (!apiProduct && !fallbackProduct) {
    return { title: "Product Not Found" };
  }

  const product = apiProduct ?? landingProductToDetail(fallbackProduct!);
  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName =
    product.merchant_name ??
    merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const canonicalUrl = `https://buywhere.ai/products/${region}/${merchantSlug}/${productId}/`;

  return {
    title: `${productName} — ${merchantName} | BuyWhere ${region.toUpperCase()}`,
    description: product.description
      ? product.description.slice(0, 160)
      : `Buy ${productName} from ${merchantName} in ${regionConfig.countryName}. Compare prices and find the best deals on BuyWhere.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${productName} — ${merchantName} | BuyWhere ${region.toUpperCase()}`,
      description: `Buy ${productName} from ${merchantName} in ${regionConfig.countryName}.`,
      url: canonicalUrl,
      type: "website",
      images: product.image_url
        ? [{ url: product.image_url, width: 800, height: 800, alt: productName }]
        : [{ url: "/og-image.png", width: 1200, height: 630, alt: productName }],
    },
  };
}

export default async function RegionProductDetailPage({ params }: PageProps) {
  const { region, slug: merchantSlug, productId } = await params;

  const regionConfig = REGION_CONFIG[region];
  if (!regionConfig) notFound();

  const apiProduct = await getProduct(productId);
  // BUY-69736: getSeoLandingFallbackProduct is now async (image repair probe).
  const fallbackProduct = apiProduct ? null : await getSeoLandingFallbackProduct(region, productId, merchantSlug);
  if (!apiProduct && !fallbackProduct) {
    notFound(); // SEO-GATE 4seen-0826 item 2: retired product -> real 404, not a 200 "Product Not Found" page
    // Unknown region-specific product id. Bounce to a search page derived from
    // the slug so the SEO landing-page card CTA still lands somewhere useful
    // instead of a 404.
    const query = extractLegacyProductQuery(merchantSlug);
    const params = new URLSearchParams({ country: region.toUpperCase() });
    if (query) params.set("q", query);
    permanentRedirect(`/search?${params.toString()}`);
  }

  const product = apiProduct ?? landingProductToDetail(fallbackProduct!);
  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName =
    product.merchant_name ??
    merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // BUY-69663: shared JSON-LD graph (Organization/WebSite publisher anchor +
  // Breadcrumb + Product with real-data-only rating rule) replaces the two
  // duplicated inline blocks. Answer engines resolve the full @graph, so the
  // publisher attribution now travels with every PDP.
  const pagePath = `/products/${region}/${merchantSlug}/${productId}/`;
  const schema = buildProductDetailGraph({
    product: {
      path: pagePath,
      name: productName,
      description:
        product.description ??
        `${productName} available from ${merchantName} in ${regionConfig.countryName}.`,
      image: product.image_url ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      sku: product.id != null ? String(product.id) : null,
      offer:
        product.price != null
          ? {
              price: product.price,
              priceCurrency: regionConfig.currency,
              sellerName: merchantName,
            }
          : null,
    },
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: `${merchantName} Products`, path: `/${region}/${merchantSlug}/products/` },
      { name: productName, path: pagePath },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
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
              <Link
                href={`/${region}/${merchantSlug}/products/`}
                className="hover:text-indigo-600"
              >
                {merchantName}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium line-clamp-1">{productName}</li>
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
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{productName}</h1>

            {product.brand && (
              <p className="text-sm text-gray-500 mb-4">
                by <span className="text-gray-700 font-medium">{product.brand}</span>
              </p>
            )}

            {product.price != null && (
              <div className="mb-4">
                <span className="text-3xl font-bold text-indigo-600">
                  {regionConfig.currency} {Number(product.price).toFixed(2)}
                </span>
              </div>
            )}

            {(() => {
              const ctaUrl = pickPrimaryCtaUrl(product);
              const fallbackHref = `/${region}/${merchantSlug}/products/`;
              // BUY-75417: route affiliate links through /r/direct/{id} so
              // AI crawlers see a followable server-rendered href instead of
              // an external domain they cannot follow.
              const redirectHref = buildAffiliateRedirectUrl(
                product.id,
                `/products/${region}/${merchantSlug}/${productId}`,
              );
              const targetUrl = redirectHref ?? ctaUrl ?? fallbackHref;
              const isExternal = redirectHref
                ? false
                : ctaUrl
                  ? /^https?:\/\//i.test(ctaUrl)
                  : false;
              // BUY-65451: PDP must ship a primary action button so SEO landing
              // cards don't dead-end on a detail page without an exit. Fall
              // back to the merchant listing on BuyWhere when no affiliate URL
              // is on the product record.
              return (
                <div className="mb-6">
                  <a
                    href={targetUrl}
                    {...(isExternal
                      ? {
                          target: "_blank",
                          rel: "noopener noreferrer nofollow sponsored",
                        }
                      : {
                          rel: "nofollow sponsored",
                        })}
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
              <Link
                href={`/${region}/${merchantSlug}/products/`}
                className="text-indigo-600 hover:underline"
              >
                {merchantName}
              </Link>{" "}
              in {regionConfig.countryName}.
            </p>

            {product.description && (
              <div className="prose prose-sm text-gray-700 mt-4">
                <p>{product.description}</p>
              </div>
            )}

            {product.category && (
              <p className="mt-4 text-xs text-gray-500">Category: {product.category}</p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
