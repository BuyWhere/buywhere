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

  // BUY-77000/BUY-81471: force no-store on the upstream fetch so the Next.js
  // Data Cache and any Railway hikari edge cannot replay a previously
  // captured 0-byte body for a stale Accept-Encoding/Origin partition.
  // /v1/products/search is per-request personalized; it must never be
  // served from a Next.js layer cache.
  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined,
    cache: 'no-store',
  });

  const responseHeaders = new Headers(response.headers);
  // BUY-81471: strip any upstream Cache-Control so the buywhere.ai edge
  // does not store a poisoned body for downstream requests with the
  // same Accept-Encoding/Origin partition.
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.delete('transfer-encoding');

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
    cache: 'no-store',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Cache-Control', 'no-store');

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
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
    cache: 'no-store',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
