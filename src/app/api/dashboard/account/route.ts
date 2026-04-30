import { NextRequest, NextResponse } from "next/server";

import { getApiBaseUrl } from "@/lib/billing";
import { getDeveloperPreferences, defaultPreferences } from "./preferences/store";

const API_BASE = getApiBaseUrl();

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key") ?? request.cookies.get("bw_dashboard_key")?.value;

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const response = await fetch(`${API_BASE}/v1/developers/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch developer profile" },
        { status: response.status }
      );
    }

    const profile = await response.json();
    const storedPrefs = getDeveloperPreferences(apiKey);

    return NextResponse.json({
      developer: {
        id: profile.id,
        email: profile.email,
        plan: profile.plan,
        created_at: profile.created_at,
      },
      notification_preferences: storedPrefs ?? defaultPreferences,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}