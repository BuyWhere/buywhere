#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://buywhere.ai";
const DEFAULT_PRODUCT_PATH = "/products/us/broadcloth-long-sleeve-shirt-1152920887995236468";
const BASELINE_PATHS = ["/compare/us", "/us"];

function normalizeBaseUrl(value) {
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function countMatches(pattern, value) {
  return (value.match(pattern) || []).length;
}

function stripChrome(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url) {
  const response = await fetch(url, { redirect: "follow" });
  const html = await response.text();
  return { response, html };
}

function assert(condition, message, details = undefined) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function checkPdp(baseUrl, productPath) {
  const url = `${baseUrl}${productPath}`;
  const { response, html } = await fetchHtml(url);
  const visibleText = stripChrome(html);
  const h1Count = countMatches(/<h1\b/gi, html);
  const jsonLdCount = countMatches(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/gi, html);
  const ogType = html.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;

  assert(response.status === 200, `PDP returned HTTP ${response.status}`, { url });
  assert(h1Count === 1, `PDP must render exactly one SSR <h1>; found ${h1Count}`, { url });
  assert(/<h1\b[^>]*>\s*Broadcloth Long Sleeve Shirt\s*<\/h1>/i.test(html), "PDP SSR <h1> must be the product name", { url });
  assert(jsonLdCount > 0, "PDP must render JSON-LD script blocks", { url });
  assert(/"@type"\s*:\s*"Product"/.test(html), "PDP JSON-LD must contain Product schema", { url });
  assert(visibleText.includes("Broadcloth Long Sleeve Shirt"), "Visible SSR text must include product name", { url });
  assert(
    /BuyWhere US catalog|Amazon|Walmart|Target|Best Buy/i.test(visibleText),
    "Visible SSR text must include merchant or accessible fallback",
    { url },
  );
  assert(ogType !== null, "PDP must render og:type metadata", { url });
  assert(ogImage && !/\/og-image\.png(?:$|[?#])/i.test(ogImage), "PDP og:image must be route-specific, not the generic homepage card", { url, ogImage });

  return { url, status: response.status, h1Count, jsonLdCount, ogType, ogImage };
}

async function checkBaseline(baseUrl, path) {
  const url = `${baseUrl}${path}`;
  const { response, html } = await fetchHtml(url);
  assert(response.status < 400, `Baseline ${path} returned HTTP ${response.status}`, { url });
  return {
    url,
    status: response.status,
    h1Count: countMatches(/<h1\b/gi, html),
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.BUYWHERE_SMOKE_BASE_URL || process.argv[2]);
  const productPath = process.env.BUYWHERE_SMOKE_PRODUCT_PATH || process.argv[3] || DEFAULT_PRODUCT_PATH;

  const pdp = await checkPdp(baseUrl, productPath);
  const baselines = [];
  for (const path of BASELINE_PATHS) {
    baselines.push(await checkBaseline(baseUrl, path));
  }

  console.log(JSON.stringify({ ok: true, pdp, baselines }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details ?? null }, null, 2));
  process.exit(1);
});
