import { NextRequest, NextResponse } from "next/server";
import { dashboardAuthError, getDashboardApiBaseUrl, resolveDashboardApiKey } from "@/lib/dashboard-api";

const API_BASE = getDashboardApiBaseUrl();

export async function POST(request: NextRequest) {
  const apiKey = resolveDashboardApiKey(request);

  if (!apiKey) {
    return dashboardAuthError();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const productId = Number(body?.productId);
    const webhookId = typeof body?.webhookId === "string" ? body.webhookId : null;
    const adminKey = process.env.ADMIN_API_KEY ?? process.env.BUYWHERE_ADMIN_API_KEY ?? "";

    if (adminKey && Number.isFinite(productId) && productId > 0) {
      const response = await fetch(`${API_BASE}/test/price-alert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
        },
        body: JSON.stringify({
          product_id: productId,
          old_price: Number(body?.oldPrice ?? 120),
          new_price: Number(body?.newPrice ?? 99),
          currency: typeof body?.currency === "string" ? body.currency : "USD",
        }),
        cache: "no-store",
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      return NextResponse.json(payload, { status: response.status });
    }

    if (!webhookId) {
      return NextResponse.json(
        { error: "Select a webhook to send a test event." },
        { status: 400 }
      );
    }

    const fallbackResponse = await fetch(`${API_BASE}/v1/webhooks/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ webhook_id: webhookId }),
      cache: "no-store",
    });

    const fallbackText = await fallbackResponse.text();
    const fallbackPayload = fallbackText ? JSON.parse(fallbackText) : null;

    return NextResponse.json(
      {
        ...fallbackPayload,
        message: fallbackPayload?.message ?? "Test webhook sent.",
        simulated_product_id: Number.isFinite(productId) ? productId : null,
      },
      { status: fallbackResponse.status }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to send test webhook" },
      { status: 502 }
    );
  }
}
