"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
function baseUrl(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'buywhere.ai';
    return `${proto}://${host}`;
}
// Shared Link headers for agent discoverability
function setLinkHeaders(res) {
    res.set('Link', [
        '</.well-known/api-catalog>; rel="api-catalog"',
        '</.well-known/mcp.json>; rel="mcp-server-manifest"',
        '</openapi.json>; rel="describedby"',
    ].join(', '));
}
function homepageMarkdown(base, locale) {
    const isSG = locale === 'en_SG';
    const regionLabel = isSG ? 'Singapore' : 'United States';
    const regionMerchants = isSG
        ? 'Lazada, Shopee, Best Denki, and more'
        : 'Amazon, Best Buy, Walmart, and more';
    return `# BuyWhere — AI-Native Product Catalog & Price Comparison

**Region:** ${regionLabel} | **Currency:** ${isSG ? 'SGD' : 'USD'}

## What is BuyWhere?

BuyWhere is a structured product catalog and price comparison API for AI agents. Real-time pricing and availability from ${regionMerchants}.

## Quick Start

\`\`\`bash
# Search products
GET ${base}/v1/products/search?q=laptop&country_code=${isSG ? 'SG' : 'US'}&limit=5

# MCP (Model Context Protocol)
POST ${base}/mcp
Content-Type: application/json
Authorization: Bearer bw_live_xxx
\`\`\`

## Key Features

- **MCP-native** — Connect any MCP-compatible AI agent in seconds. No SDK required — point at \`/mcp\` and go.
- **Structured for LLMs** — Schema.org-compatible JSON responses with prices, availability, and merchant data.
- **${regionLabel} coverage** — 2M+ products across ${regionMerchants}. Updated daily.
- **Sub-100ms p99** — Hosted in ${isSG ? 'Singapore (ap-southeast-1)' : 'US East'} for low-latency agent workflows.

## Documentation

- MCP guide: ${base}/docs/guides/mcp
- API reference: ${base}/openapi.json
- MCP endpoint: ${base}/mcp

## merchants

${regionMerchants}

## Status

- Homepage: ${base}/
- US edition: ${base}/us/
- robots.txt: ${base}/robots.txt
- llms.txt: ${base}/llms.txt

---
&copy; 2024 BuyWhere · https://buywhere.ai
`;
}
function homepageHtml(base, locale) {
    const isSG = locale === 'en_SG';
    const canonicalPath = isSG ? '/' : '/us/';
    const regionLabel = isSG ? 'Singapore' : 'United States';
    const regionCurrency = isSG ? 'SGD' : 'USD';
    const regionMerchants = isSG
        ? 'Lazada, Shopee, Best Denki, and more'
        : 'Amazon, Best Buy, Walmart, and more';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuyWhere — AI-Native Product Catalog &amp; Price Comparison</title>
<meta name="description" content="BuyWhere is a structured product catalog and price comparison API for AI agents. Real-time ${regionCurrency} pricing from ${regionMerchants}.">
<meta property="og:title" content="BuyWhere — AI-Native Product Catalog" />
<meta property="og:description" content="Real-time product pricing and availability for AI agents. ${regionLabel} coverage." />
<meta property="og:type" content="website" />
<meta property="og:url" content="${base}${canonicalPath}" />
<meta property="og:locale" content="${locale}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate" hreflang="en-sg" href="${base}/" />
<link rel="alternate" hreflang="en-us" href="${base}/us/" />
<link rel="alternate" hreflang="x-default" href="${base}/" />
${!isSG ? `<link rel="canonical" href="${base}/us/" />` : ''}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "${base}/#website",
  "name": "BuyWhere",
  "url": "${base}/",
  "description": "AI-native product catalog and price comparison API",
  "inLanguage": "en",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "${base}/search?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
</script>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#1a1a1a;line-height:1.6}
  header{background:#0a7c59;color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
  header a{color:#fff;text-decoration:none;font-weight:700;font-size:1.25rem}
  header nav a{color:rgba(255,255,255,.85);text-decoration:none;margin-left:20px;font-size:.95rem}
  .hero{max-width:900px;margin:60px auto;padding:0 24px;text-align:center}
  .hero h1{font-size:2.5rem;margin-bottom:.4em;line-height:1.2}
  .hero p{font-size:1.15rem;color:#444;max-width:600px;margin:0 auto 32px}
  .badge{display:inline-block;background:#e8f5f1;color:#0a7c59;border-radius:20px;padding:4px 14px;font-size:.85rem;font-weight:600;margin-bottom:16px}
  .cta-group{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .cta{display:inline-block;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:1rem}
  .cta-primary{background:#0a7c59;color:#fff}
  .cta-secondary{background:#fff;color:#0a7c59;border:2px solid #0a7c59}
  .features{background:#f9fafb;padding:60px 24px}
  .features-inner{max-width:900px;margin:0 auto}
  .features h2{text-align:center;font-size:1.7rem;margin-bottom:40px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px}
  .card h3{margin-top:0;font-size:1.05rem;color:#0a7c59}
  .endpoints{max-width:900px;margin:60px auto;padding:0 24px}
  .endpoints h2{font-size:1.7rem;margin-bottom:24px}
  pre{background:#f6f8fa;border:1px solid #e5e5e5;border-radius:6px;padding:16px;overflow-x:auto;font-size:.9rem}
  code{font-family:"SFMono-Regular",Consolas,monospace}
  footer{background:#1a1a1a;color:#999;padding:32px 24px;text-align:center;font-size:.9rem}
  footer a{color:#aaa;text-decoration:none}
  .region-banner{background:#fff8e1;border-bottom:1px solid #f0d070;padding:8px 24px;text-align:center;font-size:.9rem}
  .demo-section{padding:40px 24px;max-width:900px;margin:0 auto}
  .demo-box{background:#fff;border:2px solid #0a7c59;border-radius:12px;overflow:hidden}
  .demo-header{background:#0a7c59;color:#fff;padding:14px 20px}
  .demo-header h3{margin:0;font-size:1.05rem}
  .demo-header p{margin:4px 0 0;opacity:.85;font-size:.85rem}
  .demo-form{padding:20px;display:flex;gap:8px;flex-wrap:wrap}
  .demo-form input{flex:1;min-width:200px;padding:10px 14px;border:1px solid #ccc;border-radius:6px;font-size:.95rem}
  .demo-form button{padding:10px 20px;background:#0a7c59;color:#fff;border:none;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer}
  .demo-form button:hover{background:#065c45}
  .demo-output{margin:0 20px 20px;border-radius:8px;overflow:hidden}
  .demo-output-header{padding:10px 14px;background:#f3f4f6;font-size:.8rem;color:#555;border-bottom:1px solid #e5e5e5}
  .demo-output pre{margin:0;padding:14px;background:#1a1a1a;color:#e8f5f1;font-size:.8rem;overflow-x:auto;max-height:300px;overflow-y:auto}
  .demo-empty{padding:20px;text-align:center;color:#888;font-size:.9rem}
  .demo-top-result{margin:0 20px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px}
  .demo-top-result .label{font-size:.75rem;font-weight:600;color:#0a7c59;text-transform:uppercase;letter-spacing:.05em}
  .demo-top-result .title{font-weight:600;margin:4px 0}
  .demo-top-result .meta{font-size:.85rem;color:#555}
  .demo-top-result .price{font-size:1.1rem;font-weight:700;color:#0a7c59}
  .demo-top-result a{color:#0a7c59;font-weight:600;text-decoration:none}
  .example-section{padding:48px 24px;max-width:900px;margin:0 auto;border-top:1px solid #e5e5e5}
  .example-section h2{font-size:1.4rem;margin-bottom:24px;color:#1a1a1a}
  .example-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
  .example-input{background:#f9fafb;border:1px solid #e5e5e5;border-radius:8px;padding:20px}
  .example-input h4{margin:0 0 12px;font-size:.9rem;color:#555;text-transform:uppercase;letter-spacing:.05em}
  .example-input-query{font-family:monospace;font-size:.95rem;background:#e8f5f1;padding:12px 16px;border-radius:6px;color:#0a7c59;font-weight:600}
  .example-json{background:#1a1a1a;border-radius:8px;padding:20px;overflow-x:auto}
  .example-json h4{margin:0 0 12px;font-size:.9rem;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.05em}
  .example-json pre{margin:0;font-size:.8rem;color:#e8f5f1;line-height:1.5}
  .example-json .key{color:#9cdcfe}
  .example-json .string{color:#ce9178}
  .example-json .number{color:#b5cea8}
  .example-json .boolean{color:#569cd6}
  .example-json .null{color:#569cd6}
  .example-results h4{margin:0 0 12px;font-size:.9rem;color:#555;text-transform:uppercase;letter-spacing:.05em}
  .example-product{border:1px solid #e5e5e5;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff}
  .example-product:last-child{margin-bottom:0}
  .example-product .ep-name{font-weight:600;font-size:.95rem;margin-bottom:4px}
  .example-product .ep-meta{font-size:.8rem;color:#666;margin-bottom:6px}
  .example-product .ep-price{font-weight:700;color:#0a7c59;font-size:1rem}
  .example-product .ep-link{font-size:.8rem;color:#0a7c59;text-decoration:none;margin-top:4px;display:inline-block}
  .example-arrow{text-align:center;color:#ccc;font-size:2rem;padding-top:80px}
  @media(max-width:700px){.example-grid{grid-template-columns:1fr}.example-arrow{display:none}}
  .how-it-works{background:#f9fafb;padding:60px 24px}
  .how-it-works-inner{max-width:900px;margin:0 auto}
  .how-it-works h2{text-align:center;font-size:1.7rem;margin-bottom:8px}
  .how-it-works-subtitle{text-align:center;color:#666;font-size:1rem;margin-bottom:48px;margin-top:8px}
  .flow-steps{display:flex;align-items:flex-start;justify-content:center;gap:0}
  .flow-step{flex:1;max-width:180px;text-align:center}
  .flow-icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
  .flow-icon-user{background:#e8f5f1;color:#0a7c59}
  .flow-icon-api{background:#e0effe;color:#0066cc}
  .flow-icon-data{background:#fef3c7;color:#d97706}
  .flow-icon-cart{background:#fce7f3;color:#be185d}
  .flow-number{display:none}
  .flow-step h3{font-size:.95rem;margin:0 0 6px;color:#1a1a1a}
  .flow-step p{font-size:.8rem;color:#666;margin:0;line-height:1.4}
  .flow-arrow{display:flex;align-items:center;padding-top:16px;flex-shrink:0}
  @media(max-width:700px){
    .flow-steps{flex-direction:column;align-items:center;gap:16px}
    .flow-arrow{transform:rotate(90deg);padding:0}
    .flow-step{max-width:260px}
  }
</style>
</head>
<body>
${!isSG ? `<div class="region-banner">Viewing US edition — <a href="/">Switch to Singapore (SG)</a></div>` : ''}
<header>
  <a href="/">BuyWhere</a>
  <nav>
    <a href="/docs/guides/mcp">MCP Docs</a>
    <a href="/v1/products">API</a>
    ${isSG ? `<a href="/us/">🇺🇸 US</a>` : `<a href="/">🇸🇬 SG</a>`}
  </nav>
</header>

<main>
  <div class="hero">
    <div class="badge">${regionLabel} Edition</div>
    <h1>The product catalog built for AI agents</h1>
    <p>Real-time pricing and availability from ${regionMerchants}. Query with MCP or REST. Structured for LLMs.</p>
    <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-bottom:32px;font-size:.9rem;color:#555">
      <span>⚡ API key in under 60 seconds</span>
      <span>🚫 No sales call</span>
      <span>🔌 Works with API or MCP</span>
    </div>
    <div class="cta-group">
      <a class="cta cta-primary" href="/developers/">Start free</a>
      <a class="cta cta-secondary" href="/docs/">Read the docs</a>
    </div>

    <div class="demo-section">
      <div class="demo-box">
        <div class="demo-header">
          <h3>Simulate an agent query</h3>
          <p>See how BuyWhere returns decision-ready product data for an AI agent</p>
        </div>
        <div class="demo-form">
          <input type="text" id="demo-query" placeholder="e.g. best laptop for coding under 2000 SGD" value="best laptop for coding under 2000 SGD" />
          <button onclick="runDemo()">Query</button>
        </div>
        <div id="demo-output" class="demo-output" style="display:none">
          <div class="demo-output-header" id="demo-output-header"></div>
          <pre id="demo-output-pre"></pre>
        </div>
        <div id="demo-empty" class="demo-empty" style="display:none">No results found. Try a different query.</div>
        <div id="demo-top-result" class="demo-top-result" style="display:none">
          <div class="label">Top Agent Pick</div>
          <div class="title" id="demo-result-title"></div>
          <div class="meta" id="demo-result-meta"></div>
          <div class="price" id="demo-result-price"></div>
          <a id="demo-result-link" href="#" target="_blank">View product →</a>
        </div>
      </div>
    </div>
  </div>

  <div class="how-it-works">
    <div class="how-it-works-inner">
      <h2>How it works</h2>
      <p class="how-it-works-subtitle">The moment an AI agent needs a product — BuyWhere delivers.</p>
      <div class="flow-steps">
        <div class="flow-step">
          <div class="flow-icon flow-icon-user">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="flow-number">1</div>
          <h3>User asks AI agent</h3>
          <p>"Find me the best laptop under $2,000 SGD for coding"</p>
        </div>
        <div class="flow-arrow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a7c59" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>
        <div class="flow-step">
          <div class="flow-icon flow-icon-api">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          <div class="flow-number">2</div>
          <h3>Agent calls BuyWhere</h3>
          <p>Query sent via MCP or REST — returns in under 100ms</p>
        </div>
        <div class="flow-arrow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a7c59" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>
        <div class="flow-step">
          <div class="flow-icon flow-icon-data">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
          </div>
          <div class="flow-number">3</div>
          <h3>Structured results</h3>
          <p>Ranked products, live prices, availability, and merchant links</p>
        </div>
        <div class="flow-arrow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a7c59" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>
        <div class="flow-step">
          <div class="flow-icon flow-icon-cart">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="9" cy="21" r="1"/>
              <circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
          </div>
          <div class="flow-number">4</div>
          <h3>User purchases</h3>
          <p>Redirected to merchant store to complete purchase</p>
        </div>
      </div>
    </div>
  </div>

  <div class="example-section">
    <h2>See how it works</h2>
    <div class="example-grid">
      <div>
        <div class="example-input">
          <h4>1 · Agent query</h4>
          <div class="example-input-query">best laptop for coding under 2000 SGD</div>
        </div>
        <div style="height:12px"></div>
        <div class="example-json">
          <h4>2 · Structured JSON response</h4>
          <pre id="example-json-output"></pre>
        </div>
      </div>
      <div class="example-results">
        <h4>3 · Ranked results</h4>
        <div id="example-products"></div>
      </div>
    </div>
  </div>

  <div class="features">
    <div class="features-inner">
      <h2>Why BuyWhere?</h2>
      <div class="grid">
        <div class="card">
          <h3>MCP-native</h3>
          <p>Connect any MCP-compatible AI agent in seconds. No SDK required — point at <code>/mcp</code> and go.</p>
        </div>
        <div class="card">
          <h3>Structured for LLMs</h3>
          <p>Schema.org-compatible JSON responses with prices, availability, and merchant data in one call.</p>
        </div>
        <div class="card">
          <h3>${regionLabel} coverage</h3>
          <p>2M+ products across ${regionMerchants}. Updated daily with real-time price tracking.</p>
        </div>
        <div class="card">
          <h3>Sub-100ms p99</h3>
          <p>Hosted in ${isSG ? 'Singapore (ap-southeast-1)' : 'US East'} for low-latency agent workflows.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="endpoints">
    <h2>Quick start</h2>
    <pre><code># Search products
GET /v1/products/search?q=laptop&country_code=${isSG ? 'SG' : 'US'}&limit=5

# MCP (Model Context Protocol)
POST /mcp
Content-Type: application/json
Authorization: Bearer bw_live_xxx</code></pre>
    <p><a href="/docs/guides/mcp">Full MCP integration guide →</a></p>
  </div>
</main>

<footer>
  <p>&copy; 2024 BuyWhere · <a href="/robots.txt">robots.txt</a> · <a href="/llms.txt">llms.txt</a> · <a href="/sitemap.xml">sitemap</a></p>
  <p style="margin-top:8px"><a href="/">Singapore</a> · <a href="/us/">United States</a></p>
</footer>
<script>
function highlightJSON(obj) {
  const json = JSON.stringify(obj, null, 2);
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'key' : 'string';
      } else if (/true|false/.test(match)) {
        cls = 'boolean';
      } else if (/null/.test(match)) {
        cls = 'null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });
}

const exampleResponse = {
  "results": [
    {
      "id": "prod_8f3k2j1h",
      "source": "lazada_sg",
      "domain": "Lazada",
      "url": "https://www.lazada.sg/products/asus-vivobook-s14",
      "title": "ASUS Vivobook S14 S430UN-EB114T 14\" Laptop - Star Grey",
      "price": 1899.00,
      "currency": "SGD",
      "image_url": "https://example.com/vivobook-s14.jpg",
      "metadata": {"brand": "ASUS", "rating": 4.5}
    },
    {
      "id": "prod_7g4l3m2n",
      "source": "shopee_sg",
      "domain": "Shopee",
      "url": "https://shopee.sg/lenovo-ideapad-s340",
      "title": "Lenovo IdeaPad S340-14API 14\" Ryzen 5 Laptop",
      "price": 1599.00,
      "currency": "SGD",
      "image_url": "https://example.com/ideapad-s340.jpg",
      "metadata": {"brand": "Lenovo", "rating": 4.3}
    },
    {
      "id": "prod_6h5m4n3o",
      "source": "bestdenki_sg",
      "domain": "Best Denki",
      "url": "https://www.bestdenki.com.sg/hp-14s-dq5035tu",
      "title": "HP 14s-dq5035TU 14\" Core i5 Laptop - Silver",
      "price": 1799.00,
      "currency": "SGD",
      "image_url": "https://example.com/hp-14s.jpg",
      "metadata": {"brand": "HP", "rating": 4.4}
    }
  ],
  "total": 847,
  "meta": {
    "total": 847,
    "limit": 5,
    "offset": 0,
    "response_time_ms": 42
  },
  "demo": true
};

function initExampleSection() {
  const jsonEl = document.getElementById('example-json-output');
  const productsEl = document.getElementById('example-products');
  if (!jsonEl || !productsEl) return;

  jsonEl.innerHTML = highlightJSON(exampleResponse);

  exampleResponse.results.forEach(function(product) {
    const div = document.createElement('div');
    div.className = 'example-product';
    div.innerHTML =
      '<div class="ep-name">' + product.title + '</div>' +
      '<div class="ep-meta">' + product.metadata.brand + ' · ' + product.domain + ' · ' + product.currency + '</div>' +
      '<div class="ep-price">SGD ' + product.price.toFixed(2) + '</div>' +
      '<a class="ep-link" href="' + product.url + '" target="_blank">View product →</a>';
    productsEl.appendChild(div);
  });
}

document.addEventListener('DOMContentLoaded', initExampleSection);

async function runDemo() {
  const input = document.getElementById('demo-query');
  const q = input.value.trim();
  if (!q) return;

  const output = document.getElementById('demo-output');
  const empty = document.getElementById('demo-empty');
  const topResult = document.getElementById('demo-top-result');
  const pre = document.getElementById('demo-output-pre');
  const header = document.getElementById('demo-output-header');

  output.style.display = 'block';
  empty.style.display = 'none';
  topResult.style.display = 'none';
  pre.textContent = 'Loading...';
  header.textContent = 'Raw API response';

  try {
    const base = window.location.origin;
    const res = await fetch(base + '/v1/demo/search?q=' + encodeURIComponent(q) + '&limit=5');
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      output.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    pre.textContent = JSON.stringify(data, null, 2);

    const top = data.results[0];
    document.getElementById('demo-result-title').textContent = top.title;
    document.getElementById('demo-result-meta').textContent = (top.brand || top.domain || 'Unknown') + ' · ' + top.currency;
    document.getElementById('demo-result-price').textContent = top.price ? top.currency + ' ' + top.price.toFixed(2) : 'Price on request';
    document.getElementById('demo-result-link').href = top.url || '#';
    topResult.style.display = 'block';
  } catch (e) {
    pre.textContent = 'Error: ' + e.message;
  }
}

document.getElementById('demo-query').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') runDemo();
});
</script>
</body>
</html>`;
}
// GET / — homepage with en_SG locale
router.get('/', (req, res) => {
    const base = baseUrl(req);
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.set('X-Robots-Tag', 'ai-index');
    setLinkHeaders(res);
    if (req.accepts(['text/markdown', 'text/html']) === 'text/markdown') {
        res.type('text/markdown; charset=utf-8').send(homepageMarkdown(base, 'en_SG'));
    }
    else {
        res.type('text/html').send(homepageHtml(base, 'en_SG'));
    }
});
// GET /v1/demo/search — demo search endpoint that bypasses API key auth for interactive homepage demo
router.get('/demo/search', async (req, res) => {
    const start = Date.now();
    const q = req.query.q || '';
    const countryCode = (req.query.country_code || 'SG').toUpperCase();
    const currency = countryCode === 'US' ? 'USD' : 'SGD';
    const limit = Math.min(parseInt(req.query.limit || '5'), 10);
    if (!q.trim()) {
        res.json({ results: [], total: 0, demo: true });
        return;
    }
    const conditions = ['currency = $1'];
    const params = [currency];
    let idx = 2;
    conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    params.push(q);
    idx++;
    conditions.push(`country_code = $${idx}`);
    params.push(countryCode);
    idx++;
    const whereClause = conditions.join(' AND ');
    const countQuery = `SELECT COUNT(*) FROM (SELECT 1 FROM products ${whereClause} LIMIT 501) _sub`;
    const dataQuery = `
      SELECT id, sku AS source_id, source AS domain, url,
             title, price, currency, image_url, metadata, updated_at,
             region, country_code
      FROM products
      ${whereClause}
      ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC, updated_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, 0);
    try {
        const [countResult, dataResult] = await Promise.all([
            config_1.db.query(countQuery, params.slice(0, idx - 1)),
            config_1.db.query(dataQuery, params),
        ]);
        const total = parseInt(countResult.rows[0].count, 10);
        const products = dataResult.rows.map((row) => ({
            id: row.id,
            source: row.source_id,
            domain: row.domain,
            url: row.url,
            title: row.title,
            price: row.price ? parseFloat(row.price) : null,
            currency: row.currency,
            image_url: row.image_url,
            metadata: row.metadata,
            region: row.region || null,
            country_code: row.country_code || null,
        }));
        const responseTimeMs = Date.now() - start;
        res.json({
            results: products,
            total,
            meta: { total, limit, offset: 0, response_time_ms: responseTimeMs },
            demo: true,
        });
    }
    catch (err) {
        console.error('[demo/search]', err);
        res.status(500).json({ error: 'Demo search failed' });
    }
});
// GET /us/ — US landing page with en_US locale
router.get('/us', (req, res) => {
    const base = baseUrl(req);
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.set('X-Robots-Tag', 'ai-index');
    setLinkHeaders(res);
    if (req.accepts(['text/markdown', 'text/html']) === 'text/markdown') {
        res.type('text/markdown; charset=utf-8').send(homepageMarkdown(base, 'en_US'));
    }
    else {
        res.type('text/html').send(homepageHtml(base, 'en_US'));
    }
});
exports.default = router;
