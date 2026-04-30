import { NextRequest, NextResponse } from "next/server";
import { getDashboardApiBaseUrl } from "@/lib/dashboard-api";

const API_BASE = getDashboardApiBaseUrl();

function resolveUserAuthToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.trim()) {
    return authorization;
  }

  const token = request.cookies.get("bw_auth_token")?.value;
  return token ? `Bearer ${token}` : null;
}

async function proxyUserAlerts(request: NextRequest, method: "GET" | "POST") {
  const authorization = resolveUserAuthToken(request);
  if (!authorization) {
    return NextResponse.json({ error: "User auth token required" }, { status: 401 });
  }

  const body = method === "POST" ? await request.text() : undefined;
  const response = await fetch(`${API_BASE}/api/auth/me/alerts`, {
    method,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
    cache: "no-store",
  });

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

export async function GET(request: NextRequest) {
  return proxyUserAlerts(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxyUserAlerts(request, "POST");
}
