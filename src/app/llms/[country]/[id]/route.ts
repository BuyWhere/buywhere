// BUY-70312: crawlable per-product llms.txt surface.
//
// GET /llms/<cc>/<id>.txt → text/plain; charset=utf-8
//
// Mirrors the inline <script type="text/llms.txt"> block emitted by the PDP
// (src/app/products/**/[productId]/page.tsx) so the two surfaces stay
// byte-comparable for the same product.

import {
  renderProductLlmsSnippet,
  type ProductAvailability,
} from "@/lib/llms-snippets";

export const dynamic = "force-dynamic";

// Same region→currency map the PDP pages hold. Keep in sync with
// REGION_CONFIG in src/app/products/[region]/[slug]/[productId]/page.tsx.
const COUNTRY_CURRENCY: Record<string, string> = {
  us: "USD",
  sg: "SGD",
  my: "MYR",
  th: "THB",
  id: "IDR",
  ph: "PHP",
  vn: "VND",
};

const API_INTERNAL_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  "https://api.buywhere.ai"
).replace(/\/$/, "");
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

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
}

function slugifyMerchant(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchProduct(productId: string): Promise<ApiProductItem | null> {
  if (!API_KEY) return null;
  try {
    const res = await fetch(
      `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(productId)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as ApiProductItem | { data?: ApiProductItem[] };
    const item = Array.isArray((payload as { data?: ApiProductItem[] }).data)
      ? (payload as { data: ApiProductItem[] }).data[0]
      : (payload as ApiProductItem);
    return item?.id ? item : null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ country: string; id: string }> },
) {
  const { country, id } = await params;
  const cc = country.toLowerCase();
  const currency = COUNTRY_CURRENCY[cc];
  if (!currency) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Accept both /llms/<cc>/<id> and /llms/<cc>/<id>.txt
  const productId = id.replace(/\.txt$/i, "");
  if (!/^[A-Za-z0-9_-]+$/.test(productId)) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const item = await fetchProduct(productId);
  if (!item) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const title = item.name ?? item.title ?? `Product ${productId}`;
  const priceValue =
    typeof item.price === "object" && item.price !== null
      ? item.price.amount
      : (item.price as number | undefined);
  const price = priceValue != null ? Number(priceValue) : null;
  const merchantName = item.merchant ?? item.merchant_name ?? null;
  const availability: ProductAvailability = price != null ? "local" : "unknown";

  const body = renderProductLlmsSnippet({
    country: cc,
    productId,
    title,
    description: item.description ?? null,
    currency,
    price,
    availability,
    brand: item.brand ?? "",
    category: item.category ?? "",
    merchantSlug: slugifyMerchant(merchantName),
    merchantName,
    url: `https://buywhere.ai/products/${cc}/${slugifyMerchant(merchantName) || "p"}/${productId}/`,
    imageUrl: item.image_url ?? "",
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
