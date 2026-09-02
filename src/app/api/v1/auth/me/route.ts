import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/billing";

const API_BASE = getApiBaseUrl();

function resolveUserAuthToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.trim()) {
    return authorization;
  }

  const token = request.cookies.get("bw_auth_token")?.value;
  return token ? `Bearer ${token}` : null;
}

export async function GET(request: NextRequest) {
  const authorization = resolveUserAuthToken(request);
  if (!authorization) {
    return NextResponse.json({ error: "User auth token required" }, { status: 401 });
  }

  const response = await fetch(`${API_BASE}/v1/auth/me`, {
    method: "GET",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
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