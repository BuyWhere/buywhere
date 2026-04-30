import { NextRequest, NextResponse } from "next/server";
import { BILLING_TIER_UI, canonicalizeBillingTier, getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

function resolveApiKey(request: NextRequest) {
  return request.headers.get("x-api-key") ?? request.cookies.get("bw_dashboard_key")?.value ?? null;
}

export async function GET(request: NextRequest) {
  const apiKey = resolveApiKey(request);

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const response = await fetch(`${API_BASE}/v1/billing/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: "Failed to fetch subscription" },
        { status: response.status }
      );
    }

    const tier = canonicalizeBillingTier(data?.tier);

    return NextResponse.json({
      tier,
      plan_name: BILLING_TIER_UI[tier].label,
      subscription_status: data?.subscription_status ?? null,
      current_period_end: data?.current_period_end ?? null,
      requests_today: Number(data?.requests_today ?? 0),
      requests_limit: Number(data?.requests_limit ?? 0),
      requests_remaining: Number(data?.requests_remaining ?? 0),
      per_minute_limit: Number(data?.per_minute_limit ?? 0),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}
