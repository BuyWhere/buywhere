import { NextRequest, NextResponse } from "next/server";
import { getDashboardApiBaseUrl } from "@/lib/dashboard-api";

const API_BASE = getDashboardApiBaseUrl();

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing unsubscribe token" }, { status: 400 });
  }

  const response = await fetch(
    `${API_BASE}/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );

  const rawText = await response.text();
  if (!rawText) {
    return new NextResponse(null, { status: response.status });
  }

  try {
    return NextResponse.json(JSON.parse(rawText), { status: response.status });
  } catch {
    return NextResponse.json({ message: rawText }, { status: response.status });
  }
}
