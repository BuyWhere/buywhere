import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.buywhere.ai";

export interface CatalogHealthData {
  status: "ok" | "degraded" | "down";
  product_count: number;
  category_count: number;
  retailer_count: number;
  last_sync_at: string;
  health_score: number;
  metrics: {
    coverage: number;
    freshness: number;
    completeness: number;
    error_rate: number;
  };
  alerts: Alert[];
  categories: CategoryHealth[];
  sync_history: SyncEvent[];
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "resolved";
  message: string;
  category?: string;
  affected_count: number;
  created_at: string;
}

export interface CategoryHealth {
  id: string;
  name: string;
  product_count: number;
  coverage: number;
  last_updated: string;
  status: "ok" | "warning" | "critical";
}

export interface SyncEvent {
  timestamp: string;
  events_count: number;
  products_added: number;
  products_updated: number;
  errors: number;
}

function generateMockData(): CatalogHealthData {
  const now = new Date();
  const categories: CategoryHealth[] = [
    { id: "electronics", name: "Electronics", product_count: 342891, coverage: 94, last_updated: new Date(now.getTime() - 2 * 60 * 1000).toISOString(), status: "ok" },
    { id: "home-living", name: "Home & Living", product_count: 198234, coverage: 87, last_updated: new Date(now.getTime() - 5 * 60 * 1000).toISOString(), status: "ok" },
    { id: "fashion", name: "Fashion", product_count: 267432, coverage: 91, last_updated: new Date(now.getTime() - 8 * 60 * 1000).toISOString(), status: "ok" },
    { id: "beauty-health", name: "Beauty & Health", product_count: 156782, coverage: 78, last_updated: new Date(now.getTime() - 12 * 60 * 1000).toISOString(), status: "warning" },
    { id: "sports-outdoors", name: "Sports & Outdoors", product_count: 89234, coverage: 62, last_updated: new Date(now.getTime() - 45 * 60 * 1000).toISOString(), status: "critical" },
    { id: "grocery", name: "Grocery", product_count: 124891, coverage: 71, last_updated: new Date(now.getTime() - 3 * 60 * 1000).toISOString(), status: "warning" },
    { id: "toys-games", name: "Toys & Games", product_count: 68429, coverage: 54, last_updated: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), status: "critical" },
  ];

  const sync_history: SyncEvent[] = [];
  for (let i = 0; i < 24; i++) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
    sync_history.push({
      timestamp: hour.toISOString(),
      events_count: Math.floor(Math.random() * 3000) + 500,
      products_added: Math.floor(Math.random() * 500) + 100,
      products_updated: Math.floor(Math.random() * 1500) + 200,
      errors: Math.floor(Math.random() * 5),
    });
  }

  const alerts: Alert[] = [
    { id: "1", severity: "critical", message: "23 products with missing prices", category: "Electronics", affected_count: 23, created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString() },
    { id: "2", severity: "warning", message: "142 products with stale images (>30 days)", category: "Home & Living", affected_count: 142, created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() },
    { id: "3", severity: "critical", message: "8 products unavailable at all retailers", category: "Fashion", affected_count: 8, created_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString() },
  ];

  return {
    status: "ok",
    product_count: 1247893,
    category_count: 7,
    retailer_count: 24,
    last_sync_at: new Date(now.getTime() - 3 * 60 * 1000).toISOString(),
    health_score: 78,
    metrics: {
      coverage: 82,
      freshness: 91,
      completeness: 71,
      error_rate: 3,
    },
    alerts,
    categories,
    sync_history,
  };
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${API_BASE}/v1/catalog/health`, {
      headers,
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      const data = generateMockData();
      return NextResponse.json(data);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    const data = generateMockData();
    return NextResponse.json(data);
  }
}