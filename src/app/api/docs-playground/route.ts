import { NextRequest, NextResponse } from "next/server";

const API_BASE =
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "https://api.buywhere.ai";

type PlaygroundRequest = {
  apiKey?: string;
  endpoint?: string;
  limit?: number;
  q?: string;
  source?: string;
  productId?: string;
};

function buildSearchDemoData(query: string, limit: number, source: string) {
  const normalizedQuery = query.trim() || "wireless headphones";
  const slug = normalizedQuery.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const items = Array.from({ length: limit }, (_, index) => {
    const itemNumber = index + 1;
    const price = (89 + itemNumber * 17.5).toFixed(2);
    const discount = 8 + itemNumber * 3;

    return {
      id: `${slug}-${itemNumber}`,
      name: `${toTitleCase(normalizedQuery)} ${itemNumber === 1 ? "Pro" : `Option ${itemNumber}`}`,
      source,
      merchant: itemNumber % 2 === 0 ? "Amazon US" : "Shopee SG",
      price,
      currency: source === "amazon_us" ? "USD" : "SGD",
      rating: Number((4.2 + itemNumber * 0.1).toFixed(1)),
      review_count: 180 + itemNumber * 73,
      confidence_score: Number((0.88 + itemNumber * 0.02).toFixed(2)),
      discount_pct: discount,
      buy_url: `https://buywhere.ai/redirect/${slug}-${itemNumber}`,
    };
  });

  return {
    total: 1247,
    limit,
    offset: 0,
    has_more: true,
    items,
  };
}

function buildDealsDemoData(limit: number, source: string) {
  return {
    total: 412,
    limit,
    items: Array.from({ length: limit }, (_, index) => ({
      id: `deal-${source}-${index + 1}`,
      title: `${source === "amazon_us" ? "Amazon" : "Marketplace"} deal ${index + 1}`,
      source,
      merchant: source === "amazon_us" ? "Amazon US" : "Shopee SG",
      original_price: (129 + index * 24).toFixed(2),
      sale_price: (99 + index * 18).toFixed(2),
      currency: source === "amazon_us" ? "USD" : "SGD",
      savings_pct: 18 + index * 4,
      expires_in_hours: 6 + index * 3,
    })),
  };
}

function buildCategoriesDemoData(limit: number) {
  const categories = [
    "Electronics",
    "Home & Kitchen",
    "Beauty",
    "Fashion",
    "Sports & Outdoors",
    "Groceries",
  ];

  return {
    total: categories.length,
    items: categories.slice(0, limit).map((name, index) => ({
      id: `category-${index + 1}`,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      product_count: 1400 + index * 320,
    })),
  };
}

function buildProductDemoData(productId: string, source: string) {
  return {
    id: productId || "demo-product-001",
    name: "Wireless Headphones Pro",
    description: "Premium wireless headphones with active noise cancellation.",
    source,
    merchant: source === "amazon_us" ? "Amazon US" : "Shopee SG",
    price: "106.50",
    original_price: "129.99",
    currency: source === "amazon_us" ? "USD" : "SGD",
    rating: 4.3,
    review_count: 253,
    category: "Electronics",
    brand: "AudioTech",
    availability: "in_stock",
    buy_url: "https://buywhere.ai/redirect/demo-product",
  };
}

function buildDemoResponse(endpoint: string, query: string, limit: number, source: string, productId?: string) {
  if (endpoint === "products") {
    return buildProductDemoData(productId || "", source);
  }

  if (endpoint === "deals") {
    return buildDealsDemoData(limit, source);
  }

  if (endpoint === "categories") {
    return buildCategoriesDemoData(limit);
  }

  return buildSearchDemoData(query, limit, source);
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export async function POST(request: NextRequest) {
  let body: PlaygroundRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const query = body.q?.trim() || "wireless headphones";
  const limit = Math.min(Math.max(Number(body.limit) || 3, 1), 6);
  const source = body.source?.trim() || "amazon_us";
  const endpoint = body.endpoint?.trim() || "search";
  const apiKey = body.apiKey?.trim();
  const productId = body.productId?.trim();
  const startedAt = Date.now();

  if (apiKey) {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      let upstreamPath = "/v1/search";

      if (endpoint === "deals") {
        upstreamPath = "/v1/deals";
        params.set("source", source);
      } else if (endpoint === "categories") {
        upstreamPath = "/v1/categories";
        params.delete("limit");
      } else if (endpoint === "products") {
        upstreamPath = `/v1/products/${productId || ""}`;
        params.delete("limit");
      } else {
        params.set("q", query);
        params.set("source", source);
      }

      const fetchUrl = params.toString() ? `${API_BASE}${upstreamPath}?${params.toString()}` : `${API_BASE}${upstreamPath}`;
      const response = await fetch(fetchUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        return NextResponse.json({
          meta: {
            endpoint: upstreamPath,
            latency_ms: Date.now() - startedAt,
            mode: "live",
            source: "buywhere-api",
          },
          request: {
            endpoint,
            limit,
            q: query,
            source,
          },
          response: data,
        });
      }

      return NextResponse.json({
        meta: {
          endpoint: upstreamPath,
          latency_ms: Date.now() - startedAt,
          mode: "demo-fallback",
          reason: "Live API request failed; showing deterministic demo data instead.",
          source: "portal-demo",
          upstream_status: response.status,
        },
        request: {
          endpoint,
          limit,
          q: query,
          source,
        },
        response: buildDemoResponse(endpoint, query, limit, source),
        upstream_error: data,
      });
    } catch {
      return NextResponse.json({
        meta: {
          endpoint: endpoint === "deals" ? "/v1/deals" : endpoint === "categories" ? "/v1/categories" : endpoint === "products" ? `/v1/products/${productId || ""}` : "/v1/search",
          latency_ms: Date.now() - startedAt,
          mode: "demo-fallback",
          reason: "BuyWhere API was unreachable; showing deterministic demo data instead.",
          source: "portal-demo",
        },
        request: {
          endpoint,
          limit,
          q: query,
          source,
        },
        response: buildDemoResponse(endpoint, query, limit, source, productId),
      });
    }
  }

  return NextResponse.json({
    meta: {
      endpoint: endpoint === "deals" ? "/v1/deals" : endpoint === "categories" ? "/v1/categories" : endpoint === "products" ? `/v1/products/${productId || ""}` : "/v1/search",
      latency_ms: Date.now() - startedAt,
      mode: "demo",
      reason: "Add an API key to send the request to the live API.",
      source: "portal-demo",
    },
    request: {
      endpoint,
      limit,
      q: query,
      source,
    },
    response: buildDemoResponse(endpoint, query, limit, source, productId),
  });
}
