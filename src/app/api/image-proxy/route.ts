// BUY-70187 (parent BUY-64057): server-side image proxy for
// hotlink-blocked merchant CDN hosts.
//
// Problem: products whose upstream image lives on a host in
// HOTLINK_BLOCKED_HOSTS (dlcdnwebimgs.asus.com, courts.com.sg, ...) serve
// HTML/403 to browsers even when the bytes are fetchable server-side with a
// browser-like UA. The SEO landing-page data layer used to drop these images
// to the branded SVG placeholder before any fetch was attempted.
//
// This route fetches allowlisted upstream URLs server-side with a
// browser-like User-Agent and streams the image bytes back. Callers rewrite
// blocked-host URLs through `/api/image-proxy?url=…` (see
// src/lib/hotlink-hosts.ts `viaImageProxy`); ProductGridImage's onError
// fallback still lands on the branded SVG when the proxy itself fails.
import { NextRequest, NextResponse } from "next/server";
import { HOTLINK_BLOCKED_HOSTS } from "@/lib/hotlink-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browser-like UA: the blocked CDNs run UA/referer bot checks and answer
// HTML error pages to curl-like agents.
const FETCH_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BuyWhereImageProxy/1.0";

const FETCH_TIMEOUT_MS = 6000;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "missing url parameter" }, { status: 400 });
  }

  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url parameter" }, { status: 400 });
  }
  if (upstream.protocol !== "https:" && upstream.protocol !== "http:") {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }
  // Strict allowlist: only the known hotlink-blocked hosts. This route must
  // never become an open proxy / SSRF relay.
  if (!HOTLINK_BLOCKED_HOSTS.has(upstream.hostname)) {
    return NextResponse.json({ error: "host not allowlisted" }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(upstream, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": FETCH_UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        // Referer tricks some CDNs' hotlink checks; harmless otherwise.
        Referer: `${upstream.protocol}//${upstream.hostname}/`,
      },
      cache: "no-store",
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    // 403/404/timeout upstream → 502 so the client onError path takes the
    // branded SVG fallback. A 200 with text/html is an Akamai-style bot page,
    // not an image — treat identically.
    if (!res.ok || !contentType.startsWith("image/") || !res.body) {
      return NextResponse.json(
        { error: "upstream fetch failed", status: res.status, contentType },
        { status: 502 },
      );
    }

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-BuyWhere-Image-Proxy": "1",
      },
    });
  } catch {
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
