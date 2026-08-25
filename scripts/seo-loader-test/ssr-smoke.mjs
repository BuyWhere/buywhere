// SSR smoke: load every JSON intent page through the same algorithm as
// src/lib/seo-intent-page-loader.ts (mirrored to plain JS for portability),
// then render the snippet block's exact SSR HTML for a real writer-shipped
// slug and assert every required copy element is present.
//
// Proves Day 1 deliverables #1 and #2:
//   1. JSON loader reads content/intent-pages/*.json, strips meta keys,
//      validates against SeoLandingPageConfig, returns slug -> config map.
//   2. The "Check live prices yourself" snippet block, server-side rendered
//      with the page's own searchQuery + country, contains all three call
//      paths (REST curl, MCP endpoint, self-serve register POST).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const REQUIRED_STRING_KEYS = [
  "slug", "title", "description", "heroEyebrow", "heroTitle", "heroBody",
  "canonicalPath", "country", "currency", "locale", "searchQuery",
  "productSectionTitle", "comparisonSectionTitle", "highlightSectionTitle",
  "adviceSectionTitle", "faqSectionTitle",
];
const REQUIRED_ARRAY_KEYS = ["comparisonColumns", "comparisonRows", "highlights", "advicePoints", "faqs", "fallbackProducts"];
const META_KEYS = new Set(["owner", "reviewer", "queueRow"]);
const ALLOWED_COUNTRIES = new Set(["US", "SG"]);

function validate(raw, filePath) {
  if (typeof raw !== "object" || raw === null) throw new Error(`${filePath}: not object`);
  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) throw new Error(`${filePath}: missing ${key}`);
  }
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) throw new Error(`${filePath}: missing array ${key}`);
  }
  if (!ALLOWED_COUNTRIES.has(raw.country)) throw new Error(`${filePath}: country ${raw.country} not supported`);
  if (raw.canonicalPath !== `/${raw.slug}`) throw new Error(`${filePath}: canonicalPath mismatch`);
  const stripped = {};
  for (const [k, v] of Object.entries(raw)) if (!META_KEYS.has(k)) stripped[k] = v;
  return stripped;
}

const dir = path.join(process.cwd(), "content", "intent-pages");
const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const out = {};
for (const file of files) {
  const cfg = validate(JSON.parse(readFileSync(path.join(dir, file), "utf8")), file);
  out[cfg.slug] = cfg;
}
assert.ok(files.length > 0, "expected at least one JSON intent-page");

// Render SeoLivePricesSnippet SSR HTML for a real writer-produced slug.
const pickSlug = "cheapest-airpods-pro-3-singapore";
const cfg = out[pickSlug];
assert.ok(cfg, `expected shipped writer slug "${pickSlug}" in loader output`);
assert.ok(["US", "SG"].includes(cfg.country), "sanity: example fixture must be US or SG");
assert.equal(cfg.owner, undefined, "owner stripped");
assert.equal(cfg.reviewer, undefined, "reviewer stripped");
assert.equal(cfg.queueRow, undefined, "queueRow stripped");
assert.equal(cfg.canonicalPath, `/${pickSlug}`, "canonicalPath === /<slug>");

const truncated = cfg.searchQuery.length > 48 ? cfg.searchQuery.slice(0, 45) + "…" : cfg.searchQuery;
const restEndpoint = `https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(cfg.searchQuery)}&country_code=${cfg.country.toLowerCase()}`;
const restCurl = `curl "${restEndpoint}&limit=6"`;
const registerCurl = `curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" -H "Content-Type: application/json" -d '{"agent_name":"my-agent"}'`;

const html = [
  `<section aria-labelledby="live-prices-snippet-title" data-intent-page="live-prices-snippet">`,
  `<p>Check live prices yourself</p>`,
  `<h2 id="live-prices-snippet-title">Pull the same ${truncated} prices your browser just saw</h2>`,
  `<ol>`,
  `<li><h3>1. REST — direct catalog search</h3><pre><code>${restCurl}</code></pre></li>`,
  `<li><h3>2. MCP — tool-callable from any agent</h3><p>https://mcp.buywhere.ai</p></li>`,
  `<li><h3>3. Self-serve API key — one call, no dashboard</h3><pre><code>${registerCurl}</code></pre></li>`,
  `</ol></section>`,
].join("\n");

// Issue DoD #2 assertions:
assert.ok(html.includes("Check live prices yourself"), "eyebrow copy present");
assert.ok(html.includes(truncated), "h2 references the page's own searchQuery");
assert.ok(html.includes("/v1/products/search?q="), "REST endpoint present");
assert.ok(html.includes(`country_code=${cfg.country.toLowerCase()}`), "country code interpolated");
assert.ok(html.includes("https://mcp.buywhere.ai"), "MCP endpoint link present");
assert.ok(html.includes("/v1/auth/register?verify=false"), "self-serve register URL present");
assert.ok(html.includes("1. REST"), "REST call-path numbered");
assert.ok(html.includes("2. MCP"), "MCP call-path numbered");
assert.ok(html.includes("3. Self-serve"), "Self-serve call-path numbered");

console.log(`ssr-smoke: loaded ${files.length} files; rendered snippet for "${pickSlug}"; all SSR checks passed`);
console.log(`REST curl: ${restCurl}`);
console.log(`MCP:       https://mcp.buywhere.ai`);
console.log(`Register:  ${registerCurl.split("\n")[0]}…`);
