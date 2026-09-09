import { NextRequest, NextResponse } from "next/server";
import { dashboardAuthError, getDashboardApiBaseUrl, resolveDashboardApiKey } from "@/lib/dashboard-api";

const API_BASE = getDashboardApiBaseUrl();

interface WebhookRecord {
  id: string;
  url: string;
  event_types?: string[];
  events?: string[];
  active: boolean;
  product_ids?: number[];
  created_at: string;
}

interface WebhookDeliveryRecord {
  id: number;
  event_type: string;
  status: string;
  delivered_at?: string | null;
  created_at: string;
}

interface PriceAlertRecord {
  id: string;
  callback_url: string;
}

interface TriggeredAlertRecord {
  alert_id: string;
  product_id: number;
  product_title: string;
  triggered_at: string;
}

export async function GET(request: NextRequest) {
  const apiKey = resolveDashboardApiKey(request);

  if (!apiKey) {
    return dashboardAuthError();
  }

  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const [webhooksResponse, alertsResponse, historyResponse] = await Promise.all([
      fetch(`${API_BASE}/v1/webhooks`, { headers, cache: "no-store" }),
      fetch(`${API_BASE}/v1/alerts`, { headers, cache: "no-store" }),
      fetch(`${API_BASE}/v1/alerts/history?page=1`, { headers, cache: "no-store" }),
    ]);

    const [webhooksPayload, alertsPayload, historyPayload] = await Promise.all([
      webhooksResponse.ok ? webhooksResponse.json() : { webhooks: [] },
      alertsResponse.ok ? alertsResponse.json() : { alerts: [] },
      historyResponse.ok ? historyResponse.json() : { alerts: [] },
    ]);

    const rawWebhooks = Array.isArray(webhooksPayload?.webhooks)
      ? (webhooksPayload.webhooks as WebhookRecord[])
      : [];
    const rawAlerts = Array.isArray(alertsPayload?.alerts)
      ? (alertsPayload.alerts as PriceAlertRecord[])
      : [];
    const rawHistory = Array.isArray(historyPayload?.alerts)
      ? (historyPayload.alerts as TriggeredAlertRecord[])
      : [];

    const alertUrlById = new Map(rawAlerts.map((alert) => [alert.id, alert.callback_url]));

    const deliveryResponses = await Promise.all(
      rawWebhooks.map(async (webhook) => {
        const response = await fetch(
          `${API_BASE}/v1/webhooks/${encodeURIComponent(webhook.id)}/deliveries?limit=20`,
          { headers, cache: "no-store" }
        );

        const payload = response.ok ? await response.json() : { deliveries: [] };
        return {
          webhookId: webhook.id,
          deliveries: Array.isArray(payload?.deliveries)
            ? (payload.deliveries as WebhookDeliveryRecord[])
            : [],
        };
      })
    );

    const deliveriesByWebhookId = new Map(
      deliveryResponses.map((entry) => [entry.webhookId, entry.deliveries])
    );

    const webhooks = rawWebhooks.map((webhook) => {
      const deliveries = deliveriesByWebhookId.get(webhook.id) ?? [];
      const latestDelivery = deliveries[0];

      return {
        id: webhook.id,
        url: webhook.url,
        events: Array.isArray(webhook.events) && webhook.events.length > 0
          ? webhook.events
          : Array.isArray(webhook.event_types)
            ? webhook.event_types
            : [],
        productIds: Array.isArray(webhook.product_ids) ? webhook.product_ids : [],
        active: webhook.active,
        createdAt: webhook.created_at,
        lastTriggeredAt: latestDelivery?.delivered_at ?? latestDelivery?.created_at ?? null,
        lastDeliveryStatus: latestDelivery?.status ?? null,
      };
    });

    const history = rawHistory
      .slice(0, 20)
      .map((entry) => ({
        id: entry.alert_id,
        timestamp: entry.triggered_at,
        productId: entry.product_id,
        product: entry.product_title,
        eventType: "price_change",
        webhookUrl: alertUrlById.get(entry.alert_id) ?? "Unavailable",
        status: "delivered",
      }));

    return NextResponse.json({
      webhooks,
      history,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load alert subscriptions" },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const apiKey = resolveDashboardApiKey(request);

  if (!apiKey) {
    return dashboardAuthError();
  }

  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE}/v1/webhooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 502 }
    );
  }
}
