import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

function resolveApiKey(request: NextRequest) {
  return request.headers.get("x-api-key") ?? request.cookies.get("bw_dashboard_key")?.value ?? null;
}

function normalizePlanId(value: string | null | undefined) {
  const planId = value?.toLowerCase();

  if (planId === "pro" || planId === "pro_monthly" || planId === "starter") {
    return "pro";
  }

  if (planId === "scale" || planId === "scale_monthly" || planId === "growth") {
    return "scale";
  }

  return null;
}

export async function POST(request: NextRequest) {
  const apiKey = resolveApiKey(request);

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const tier = normalizePlanId(body?.plan_id);

    if (!tier) {
      return NextResponse.json({ error: "Valid plan_id is required" }, { status: 400 });
    }

    const response = await fetch(`${API_BASE}/v1/billing/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tier }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: "Failed to create checkout session" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}
