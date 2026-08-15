import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRIVATE_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i;
const PRIVATE_IPV4_RE = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

function isAllowedImageUrl(value: string | null): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const host = url.hostname.toLowerCase();
    if (PRIVATE_HOST_RE.test(host) || PRIVATE_IPV4_RE.test(host)) return null;

    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = isAllowedImageUrl(request.nextUrl.searchParams.get("url"));
  if (!url) {
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), {
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; BuyWhereImageProxy/1.0; +https://buywhere.ai)",
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 * 60 * 24 },
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "Image unavailable" }, { status: upstream.status });
    }

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Upstream response is not an image" }, { status: 415 });
    }

    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image proxy fetch failed" }, { status: 502 });
  }
}
