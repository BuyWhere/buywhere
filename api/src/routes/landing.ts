import { Router, Request, Response } from 'express';

const router = Router();

function baseUrl(req: Request): string {
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol).split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'buywhere.ai';
  return `${proto}://${host}`;
}

// Shared Link headers for agent discoverability
function setLinkHeaders(res: Response) {
  res.set('Link', [
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</.well-known/mcp.json>; rel="mcp-server-manifest"',
    '</openapi.json>; rel="describedby"',
  ].join(', '));
}

function homepageMarkdown(base: string, locale: 'en_SG' | 'en_US'): string {
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

function homepageHtml(base: string, locale: 'en_SG' | 'en_US'): string {
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
<link rel="alternate" hreflang="en-sg" href="${base}/" />
<link rel="alternate" hreflang="en-us" href="${base}/us/" />
<link rel="alternate" hreflang="x-default" href="${base}/" />
${!isSG ? `<link rel="canonical" href="${base}/us/" />` : ''}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "BuyWhere",
  "url": "${base}/",
  "description": "AI-native product catalog and price comparison API"
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
    <div class="cta-group">
      <a class="cta cta-primary" href="/docs/guides/mcp">Get started with MCP</a>
      <a class="cta cta-secondary" href="/v1/products?limit=5">Try the API</a>
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
</body>
</html>`;
}

// GET / — homepage with en_SG locale
router.get('/', (req: Request, res: Response) => {
  const base = baseUrl(req);
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.set('X-Robots-Tag', 'ai-index');
  setLinkHeaders(res);

  if (req.accepts(['text/markdown', 'text/html']) === 'text/markdown') {
    res.type('text/markdown; charset=utf-8').send(homepageMarkdown(base, 'en_SG'));
  } else {
    res.type('text/html').send(homepageHtml(base, 'en_SG'));
  }
});

// GET /us/ — US landing page with en_US locale
router.get('/us', (req: Request, res: Response) => {
  const base = baseUrl(req);
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.set('X-Robots-Tag', 'ai-index');
  setLinkHeaders(res);

  if (req.accepts(['text/markdown', 'text/html']) === 'text/markdown') {
    res.type('text/markdown; charset=utf-8').send(homepageMarkdown(base, 'en_US'));
  } else {
    res.type('text/html').send(homepageHtml(base, 'en_US'));
  }
});

export default router;
