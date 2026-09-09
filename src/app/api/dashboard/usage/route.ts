import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const [usageResponse, analyticsResponse, billingResponse] = await Promise.all([
      fetch(`${API_BASE}/v1/usage?days=30`, { headers, cache: "no-store" }),
      fetch(`${API_BASE}/v1/analytics/usage`, { headers, cache: "no-store" }),
      fetch(`${API_BASE}/v1/billing/status`, { headers, cache: "no-store" }),
    ]);

    if (!usageResponse.ok && !analyticsResponse.ok && !billingResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch usage data" },
        { status: usageResponse.status || analyticsResponse.status || billingResponse.status }
      );
    }

    const usage = usageResponse.ok ? await usageResponse.json() : null;
    const analytics = analyticsResponse.ok ? await analyticsResponse.json() : null;
    const billing = billingResponse.ok ? await billingResponse.json() : null;
    const dailyUsage = Array.isArray(usage?.daily_usage) ? usage.daily_usage : [];
    const monthlyUsage = dailyUsage.reduce(
      (sum: number, day: { request_count?: number }) => sum + (day.request_count ?? 0),
      0
    );

    return NextResponse.json({
      ...analytics,
      ...usage,
      billing,
      tier: billing?.tier ?? usage?.tier ?? "free",
      limit: usage?.limit ?? billing?.requests_limit ?? 0,
      usage_today: usage?.usage_today ?? billing?.requests_today ?? analytics?.total_requests_today ?? 0,
      usage_remaining: usage?.usage_remaining ?? billing?.requests_remaining ?? 0,
      daily_usage: dailyUsage,
      total_requests_today: analytics?.total_requests_today ?? usage?.usage_today ?? billing?.requests_today ?? 0,
      total_requests_week: analytics?.total_requests_week ?? 0,
      total_requests_month: analytics?.total_requests_month ?? monthlyUsage,
      top_endpoints: Array.isArray(analytics?.top_endpoints) ? analytics.top_endpoints : [],
      top_products: Array.isArray(analytics?.top_products) ? analytics.top_products : [],
      avg_response_time_ms: analytics?.avg_response_time_ms ?? 0,
      rate_limit_hits: analytics?.rate_limit_hits ?? 0,
      rate_limit: {
        requests_per_minute: null,
        requests_per_day: billing?.requests_limit ?? usage?.limit ?? 0,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}
