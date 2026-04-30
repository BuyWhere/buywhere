import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE}/v1/billing/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
