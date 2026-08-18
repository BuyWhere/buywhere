import { NextRequest } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.buywhere.ai";

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<Response> {
  const pathSuffix = context.params.path.join("/");
  const targetUrl = new URL(`/v1/${pathSuffix}`, API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers = new Headers();
  for (const [key, value] of Array.from(request.headers.entries())) {
    if (
      key === "host" ||
      key === "connection" ||
      key.startsWith("x-forwarded")
    )
      continue;
    headers.set(key, value);
  }

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function HEAD(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<Response> {
  const pathSuffix = context.params.path.join("/");
  const targetUrl = new URL(`/v1/${pathSuffix}`, API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers = new Headers();
  for (const [key, value] of Array.from(request.headers.entries())) {
    if (
      key === "host" ||
      key === "connection" ||
      key.startsWith("x-forwarded")
    )
      continue;
    headers.set(key, value);
  }

  const response = await fetch(targetUrl.toString(), {
    method: "HEAD",
    headers,
  });

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<Response> {
  const pathSuffix = context.params.path.join("/");
  const targetUrl = new URL(`/v1/${pathSuffix}`, API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers = new Headers();
  for (const [key, value] of Array.from(request.headers.entries())) {
    if (
      key === "host" ||
      key === "connection" ||
      key.startsWith("x-forwarded")
    )
      continue;
    headers.set(key, value);
  }

  const response = await fetch(targetUrl.toString(), {
    method: "POST",
    headers,
    body: await request.arrayBuffer(),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
