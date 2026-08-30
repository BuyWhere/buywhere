import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
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
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!API_KEY) {
    return NextResponse.json(
      { error: "missing_api_key", message: "API key not configured" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(`${API_BASE_URL}/v1/products/${encodeURIComponent(id)}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "product_not_found", message: "Product not found" },
        { status: 404 }
      );
    }

    // The backend API returns {data: [ProductDetail]} — unwrap to bare ProductDetail
    const json = await response.json() as { data?: ProductDetail[] };
    const data = json?.data?.[0];
    if (!data?.id) {
      return NextResponse.json(
        { error: "product_not_found", message: "Product not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error(`[api/products/${id}] fetch error:`, err);
    return NextResponse.json(
      { error: "fetch_failed", message: "Failed to fetch product" },
      { status: 502 }
    );
  }
}
