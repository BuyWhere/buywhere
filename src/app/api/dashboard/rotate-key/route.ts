import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    let keyId = typeof body?.keyId === "string" ? body.keyId : "";

    if (!keyId) {
      const keysResponse = await fetch(`${API_BASE}/v1/keys`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (keysResponse.ok) {
        const keysPayload = await keysResponse.json().catch(() => []);
        const keys = Array.isArray(keysPayload)
          ? keysPayload
          : Array.isArray(keysPayload?.keys)
            ? keysPayload.keys
            : [];

        const activeKey = keys.find((entry: { id?: string; is_active?: boolean }) => entry?.is_active)
          ?? keys[0];
        keyId = typeof activeKey?.id === "string" ? activeKey.id : "";
      }
    }

    if (!keyId) {
      return NextResponse.json(
        { error: "Unable to determine which key to rotate" },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE}/v1/keys/${encodeURIComponent(keyId)}/rotate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to rotate key" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const rawKey = data.raw_key ?? data.new_key;
    return NextResponse.json({
      raw_key: rawKey,
      tier: data.tier,
      message: data.message,
      old_key_expires_at: data.old_key_expires_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}
