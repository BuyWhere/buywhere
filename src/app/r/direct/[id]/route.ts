import { NextRequest, NextResponse } from "next/server";

/**
 * BUY-75418: Affiliate redirect handler for product-card outbound links.
 * Path: /r/direct/{id}?url={encodedMerchantUrl}
 * Returns a 302 redirect to the merchant URL. 302 is the standard affiliate
 * redirect status (not 301) because the destination for a given product id can
 * change as offers are refreshed.
 *
 * All /r/ URLs are disallowed in robots.txt; links carry rel="nofollow sponsored".
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params; // id is part of the canonical path; only the ?url query matters here
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "missing_url", message: "Merchant URL is required" },
      { status: 400 }
    );
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    return NextResponse.json(
      { error: "invalid_url", message: "Could not decode merchant URL" },
      { status: 400 }
    );
  }

  let target: URL;
  try {
    target = new URL(decodedUrl);
  } catch {
    return NextResponse.json(
      { error: "invalid_url", message: "Merchant URL is not valid" },
      { status: 400 }
    );
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { error: "invalid_url", message: "Only HTTP/HTTPS URLs are allowed" },
      { status: 400 }
    );
  }

  // Light click attribution: append a utm_source so merchants can identify
  // BuyWhere traffic, but keep the redirect fully server-side (no JS required).
  target.searchParams.set("utm_source", "buywhere");
  target.searchParams.set("utm_medium", "affiliate");
  target.searchParams.set("utm_campaign", "category-grid");

  const response = NextResponse.redirect(target.toString(), 302);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
