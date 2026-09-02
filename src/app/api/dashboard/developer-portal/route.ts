import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.buywhere.ai";

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

    const [profileResponse, usageResponse] = await Promise.all([
      fetch(`${API_BASE}/v1/developers/me`, {
        headers,
        cache: "no-store",
      }),
      fetch(`${API_BASE}/v1/developers/me/usage`, {
        headers,
        cache: "no-store",
      }),
    ]);

    if (!profileResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch developer profile" },
        { status: profileResponse.status }
      );
    }

    if (!usageResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch usage summary" },
        { status: usageResponse.status }
      );
    }

    const [profile, usage] = await Promise.all([
      profileResponse.json(),
      usageResponse.json(),
    ]);

    return NextResponse.json({
      ...profile,
      usage,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach API" },
      { status: 502 }
    );
  }
}
