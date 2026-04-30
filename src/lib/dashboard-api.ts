import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();
const DASHBOARD_COOKIE_NAME = "bw_dashboard_key";

export function resolveDashboardApiKey(request: NextRequest) {
  return request.headers.get("x-api-key") ?? request.cookies.get(DASHBOARD_COOKIE_NAME)?.value ?? null;
}

export function dashboardAuthError() {
  return NextResponse.json({ error: "API key required" }, { status: 401 });
}

export async function proxyDashboardApi(
  request: NextRequest,
  path: string,
  init: RequestInit = {}
) {
  const apiKey = resolveDashboardApiKey(request);

  if (!apiKey) {
    return dashboardAuthError();
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const rawText = await response.text();
  if (!rawText) {
    return new NextResponse(null, { status: response.status });
  }

  let data: unknown = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = { message: rawText };
  }

  return NextResponse.json(data, { status: response.status });
}

export function getDashboardApiBaseUrl() {
  return API_BASE;
}
