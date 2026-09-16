import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getSeoLandingFallbackProduct } from "@/lib/seo-landing-pages";
import { buildSGLegacyProductRedirect } from "@/lib/legacy-product-redirect";
import { buildProductDetailGraph } from "@/lib/product-schema";
import { buildAffiliateRedirectUrl } from "@/lib/click-attribution";
import {
  PDP_PRIMARY_CTA_CLASS,
  SsrProductDetailLayout,
} from "@/components/pdp/SsrProductDetailLayout";

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

// BUY-69736: getSeoLandingFallbackProduct is now async (image repair probe).
function landingProductToDetail(product: Awaited<ReturnType<typeof getSeoLandingFallbackProduct>>): ProductDetail | null {
  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    description: `${product.name} is available from ${product.merchant}. Compare current pricing and merchant options on BuyWhere.`,
    price: product.price ?? undefined,
    image_url: product.imageUrl,
    category: product.category ?? undefined,
    brand: product.brand ?? undefined,
    merchant_name: product.merchant,
    // The curated fallback list never ships an affiliate redirect, but when it
    // does, surface it as the primary CTA. See `withLiveProductDetailUrl` in
    // seo-landing-pages.ts.
    affiliate_redirect_url: null,
    click_url: null,
    affiliate_url: null,
    buy_url: null,
    product_url: null,
  };
}

async function getProduct(
  productId: string,
  merchantSlug: string
): Promise<ProductDetail | null> {
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
      console.warn(`[products/sg] internal API error for ${productId}:`, err);
    }
  }

  // Fallback to curated SEO landing page fallback products
  return landingProductToDetail(await getSeoLandingFallbackProduct("sg", productId, merchantSlug));
}

interface PageProps {
  params: { slug: string; productId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: merchantSlug, productId } = params;

  const product = await getProduct(productId, merchantSlug);
  if (!product) {
    return { title: "Product Not Found" };
  }

  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName = product.merchant_name ?? merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const canonicalUrl = `https://buywhere.ai/products/sg/${merchantSlug}/${productId}/`;

  return {
    title: `${productName} — ${merchantName} | BuyWhere SG`,
    description: product.description
      ? product.description.slice(0, 160)
      : `Buy ${productName} from ${merchantName} in Singapore. Compare prices and find the best deals on BuyWhere.`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${productName} — ${merchantName} | BuyWhere SG`,
      description: `Buy ${productName} from ${merchantName} in Singapore.`,
      url: canonicalUrl,
      type: "website",
      images: product.image_url
        ? [{ url: product.image_url, width: 800, height: 800, alt: productName }]
        : [{ url: "/og-image.png", width: 1200, height: 630, alt: productName }],
    },
  };
}

export default async function SGProductDetailPage({ params }: PageProps) {
  const { slug: merchantSlug, productId } = params;

  const product = await getProduct(productId, merchantSlug);
  if (!product) {
    // Live catalog results from `/api/products/search` may not have a curated
    // SEO fallback entry, and `/v1/products/{id}` does not always resolve them.
    // Bounce to a country-correct search page instead of a 404 so the card CTA
    // always lands somewhere useful.
    permanentRedirect(buildSGLegacyProductRedirect(merchantSlug));
  }

  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName =
    product.merchant_name ??
    merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // BUY-69663: shared JSON-LD graph replaces the duplicated inline Product +
  // Breadcrumb blocks — publisher-anchored @graph, ratings only from real data.
  const pagePath = `/products/sg/${merchantSlug}/${productId}/`;
  const schema = buildProductDetailGraph({
    product: {
      path: pagePath,
      name: productName,
      description:
        product.description ??
        `${productName} available from ${merchantName} in Singapore.`,
      image: product.image_url ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      sku: product.id != null ? String(product.id) : null,
      offer:
        product.price != null
          ? {
              price: product.price,
              priceCurrency: "SGD",
              sellerName: merchantName,
            }
          : null,
    },
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: `${merchantName} Products`, path: `/sg/${merchantSlug}/products/` },
      { name: productName, path: pagePath },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <SsrProductDetailLayout
        crumbs={[
          { href: "/", label: "Home" },
          { href: `/sg/${merchantSlug}/products/`, label: merchantName },
          { label: productName },
        ]}
        imageUrl={product.image_url}
        imageAlt={productName}
        title={productName}
        brand={product.brand}
        priceLabel={product.price != null ? `SGD ${Number(product.price).toFixed(2)}` : null}
        cta={(() => {
          const ctaUrl = pickPrimaryCtaUrl(product);
          const fallbackHref = `/sg/${merchantSlug}/products/`;
          const redirectHref = buildAffiliateRedirectUrl(
            product.id,
            `/products/sg/${merchantSlug}/${productId}`,
          );
          const targetUrl = redirectHref ?? ctaUrl ?? fallbackHref;
          const isExternal = redirectHref ? false : ctaUrl ? /^https?:\/\//i.test(ctaUrl) : false;
          return (
            <div className="mb-6">
              <a
                href={targetUrl}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer nofollow sponsored" }
                  : { rel: "nofollow sponsored" })}
                className={PDP_PRIMARY_CTA_CLASS}
              >
                {ctaUrl ? `View at ${merchantName}` : `View all from ${merchantName}`}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          );
        })()}
        availability={
          <p className="text-sm text-gray-600 mb-4">
            Available from{" "}
            <Link href={`/sg/${merchantSlug}/products/`} className="text-indigo-600 hover:underline">
              {merchantName}
            </Link>{" "}
            in Singapore.
          </p>
        }
        description={product.description}
        category={product.category}
      />
    </>
  );
}
