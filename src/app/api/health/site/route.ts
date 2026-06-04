/**
 * GET /api/health/site
 *
 * Content-level site health check (BUY-11436).
 * Verifies that the buywhere.ai frontend renders correctly, not just HTTP 200.
 *
 * Checks:
 *   1. Homepage returns 200 with expected keyword ("BuyWhere")
 *   2. Key static assets (CSS + JS chunks) referenced in the page return 200
 *   3. At least one stable public asset (logo, manifest) is reachable
 *
 * Response: 200 with JSON body when all checks pass.
 *           503 when any critical check fails (triggers UptimeRobot keyword alert).
 *
 * Add this URL to UptimeRobot as a keyword monitor checking for `"status":"ok"`.
 * Any static asset 404 will cause the response to contain `"status":"degraded"`
 * or `"status":"down"` instead, triggering an alert.
 */

import { NextResponse } from "next/server";

const BASE_URL = process.env.SITE_HEALTH_BASE_URL || "https://buywhere.ai";
const TIMEOUT_MS = 8000;
const KEYWORD = "BuyWhere";

// Stable assets that must always be accessible (not hash-versioned)
const STABLE_ASSETS = [
  "/logo.png",
  "/manifest.json",
  "/favicon.svg",
];

// Maximum number of dynamic asset URLs to probe per check
const MAX_ASSET_PROBES = 3;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

function extractStaticAssets(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const patterns = [
    /href="(\/_next\/static\/css\/[^"]+\.css)"/g,
    /src="(\/_next\/static\/chunks\/[^"]+\.js)"/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      urls.push(`${baseUrl}${match[1]}`);
      if (urls.length >= MAX_ASSET_PROBES * patterns.length) break;
    }
  }
  return urls.slice(0, MAX_ASSET_PROBES);
}

interface CheckResult {
  check: string;
  status: "ok" | "fail";
  detail?: string;
  latency_ms?: number;
}

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const checks: CheckResult[] = [];
  let overallStatus: "ok" | "degraded" | "down" = "ok";

  // ── Check 1: Homepage loads with expected keyword ────────────────────────
  let homepageHtml = "";
  const t0 = Date.now();
  try {
    const resp = await fetchWithTimeout(BASE_URL, TIMEOUT_MS);
    const latency = Date.now() - t0;
    if (!resp.ok) {
      checks.push({ check: "homepage_status", status: "fail", detail: `HTTP ${resp.status}`, latency_ms: latency });
      overallStatus = "down";
    } else {
      homepageHtml = await resp.text();
      const hasKeyword = homepageHtml.includes(KEYWORD);
      checks.push({
        check: "homepage_keyword",
        status: hasKeyword ? "ok" : "fail",
        detail: hasKeyword ? `Keyword "${KEYWORD}" present` : `Keyword "${KEYWORD}" NOT FOUND — page may be blank or broken`,
        latency_ms: latency,
      });
      if (!hasKeyword) overallStatus = "down";
    }
  } catch (err) {
    checks.push({
      check: "homepage_status",
      status: "fail",
      detail: `Fetch failed: ${(err as Error).message}`,
      latency_ms: Date.now() - t0,
    });
    overallStatus = "down";
  }

  // ── Check 2: Dynamic static assets from the page ─────────────────────────
  if (homepageHtml) {
    const assetUrls = extractStaticAssets(homepageHtml, BASE_URL);
    let assetFails = 0;
    for (const url of assetUrls) {
      const t1 = Date.now();
      try {
        const resp = await fetchWithTimeout(url, TIMEOUT_MS);
        const latency = Date.now() - t1;
        const ok = resp.ok;
        checks.push({
          check: "static_asset",
          status: ok ? "ok" : "fail",
          detail: ok ? url : `${url} → HTTP ${resp.status}`,
          latency_ms: latency,
        });
        if (!ok) assetFails++;
      } catch (err) {
        checks.push({
          check: "static_asset",
          status: "fail",
          detail: `${url} → fetch failed: ${(err as Error).message}`,
        });
        assetFails++;
      }
    }
    if (assetFails > 0 && overallStatus === "ok") {
      overallStatus = "degraded";
    }
    if (assetFails === assetUrls.length && assetUrls.length > 0) {
      overallStatus = "down";
    }
  }

  // ── Check 3: Stable assets (logo, manifest, favicon) ─────────────────────
  let stableAssetFails = 0;
  for (const path of STABLE_ASSETS) {
    const url = `${BASE_URL}${path}`;
    const t2 = Date.now();
    try {
      const resp = await fetchWithTimeout(url, TIMEOUT_MS);
      const latency = Date.now() - t2;
      const ok = resp.ok;
      checks.push({
        check: "stable_asset",
        status: ok ? "ok" : "fail",
        detail: ok ? url : `${url} → HTTP ${resp.status}`,
        latency_ms: latency,
      });
      if (!ok) stableAssetFails++;
    } catch (err) {
      checks.push({
        check: "stable_asset",
        status: "fail",
        detail: `${url} → fetch failed: ${(err as Error).message}`,
      });
      stableAssetFails++;
    }
  }
  if (stableAssetFails > 0 && overallStatus === "ok") {
    overallStatus = "degraded";
  }

  const httpStatus = overallStatus === "ok" ? 200 : overallStatus === "degraded" ? 200 : 503;

  return NextResponse.json(
    {
      status: overallStatus,
      ts: new Date().toISOString(),
      site: BASE_URL,
      checks,
      summary: {
        total: checks.length,
        ok: checks.filter((c) => c.status === "ok").length,
        fail: checks.filter((c) => c.status === "fail").length,
      },
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
