"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// Availability mapping from DB value to Schema.org URL
function schemaAvailability(availability) {
    if (availability === 'out_of_stock')
        return 'https://schema.org/OutOfStock';
    if (availability === 'preorder')
        return 'https://schema.org/PreOrder';
    return 'https://schema.org/InStock';
}
// Derive the public base URL from the request
function baseUrl(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || '';
    return `${proto}://${host}`;
}
function htmlPage(title, description, jsonld, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
  h1{font-size:1.6rem;margin-bottom:.2em}
  .price{font-size:1.3rem;font-weight:700;color:#0a7c59}
  .merchant{color:#555;font-size:.95em}
  .product-img{max-width:220px;border-radius:8px;border:1px solid #e5e5e5}
  .product-card{border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin:12px 0;display:flex;gap:16px}
  .meta{color:#666;font-size:.9em}
  nav a{color:#0969da;text-decoration:none;font-size:.95em}
  nav span{color:#999;margin:0 4px}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
// GET /p/:id — public product page with Schema.org Product + Offer JSON-LD
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const result = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url,
            title, price, currency, image_url,
            brand, description, category_path, avg_rating AS rating, review_count,
            in_stock, metadata, updated_at, gtin, mpn
     FROM products WHERE id = $1`, [id]).catch(() => null);
    if (!result || result.rows.length === 0) {
        res.status(404).send('<h1>Product not found</h1>');
        return;
    }
    const p = result.rows[0];
    const price = p.price ? parseFloat(p.price) : null;
    const originalPrice = p.metadata?.original_price ? parseFloat(p.metadata.original_price) : null;
    const currency = p.currency || 'SGD';
    const availability = schemaAvailability(p.in_stock === false ? 'out_of_stock' : 'in_stock');
    const base = baseUrl(req);
    // Build Schema.org Product with Offer
    const offerBase = {
        '@type': 'Offer',
        priceCurrency: currency,
        availability,
        url: p.url,
        seller: {
            '@type': 'Organization',
            '@id': `${base}/#organization`,
            name: p.domain || 'BuyWhere',
        },
    };
    if (price !== null)
        offerBase.price = price;
    const jsonld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${base}/p/${p.id}`,
        name: p.title,
        url: `${base}/p/${p.id}`,
        mainEntityOfPage: `${base}/p/${p.id}`,
        offers: offerBase,
    };
    if (p.description)
        jsonld.description = p.description;
    if (p.image_url)
        jsonld.image = p.image_url;
    if (p.brand)
        jsonld.brand = { '@type': 'Brand', name: p.brand };
    if (p.source_id)
        jsonld.sku = p.source_id;
    if (p.mpn)
        jsonld.mpn = p.mpn;
    if (p.gtin)
        jsonld.gtin = p.gtin;
    if (p.category_path && p.category_path.length > 0)
        jsonld.category = p.category_path[0];
    if (p.rating) {
        jsonld.aggregateRating = {
            '@type': 'AggregateRating',
            ratingValue: parseFloat(p.rating),
            reviewCount: p.review_count || 1,
            bestRating: 5,
            worstRating: 1,
        };
    }
    const categoryPath = Array.isArray(p.category_path) ? p.category_path : [];
    const breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        '@id': `${base}/#breadcrumb`,
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'BuyWhere', item: `${base}/` },
            ...categoryPath.map((cat, i) => ({
                '@type': 'ListItem',
                position: i + 2,
                name: cat,
                item: `${base}/c/${encodeURIComponent(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`,
            })),
            { '@type': 'ListItem', position: categoryPath.length + 2, name: p.title },
        ],
    };
    const discount = price !== null && originalPrice !== null && originalPrice > price
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : null;
    const breadNav = [
        `<a href="/">BuyWhere</a>`,
        ...categoryPath.map((cat) => `<a href="/c/${encodeURIComponent(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escHtml(cat)}</a>`),
        `<span>${escHtml(p.title)}</span>`,
    ].join('<span>›</span>');
    const body = `
<nav>${breadNav}</nav>
<div style="display:flex;gap:24px;margin-top:20px">
  ${p.image_url ? `<img class="product-img" src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" loading="lazy">` : ''}
  <div>
    <h1>${escHtml(p.title)}</h1>
    ${p.brand ? `<div class="meta">Brand: <strong>${escHtml(p.brand)}</strong></div>` : ''}
    ${price !== null ? `<div class="price">${currency} ${price.toFixed(2)}${discount ? ` <span style="color:#e53e3e;font-size:.85em">-${discount}%</span>` : ''}</div>` : ''}
    ${originalPrice !== null && discount ? `<div class="meta" style="text-decoration:line-through">${currency} ${originalPrice.toFixed(2)}</div>` : ''}
    <div class="merchant">Sold by: ${escHtml(p.domain || 'merchant')}</div>
    ${p.availability === 'out_of_stock' ? '<div style="color:#e53e3e;font-weight:600">Out of stock</div>' : '<div style="color:#0a7c59">In stock</div>'}
    ${p.description ? `<p style="margin-top:12px">${escHtml(p.description.slice(0, 500))}</p>` : ''}
    ${p.url ? `<a href="/r/buywhere/${p.id}" rel="sponsored" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#0a7c59;color:#fff;border-radius:6px;text-decoration:none">View on ${escHtml(p.domain || 'merchant')}</a>` : ''}
  </div>
</div>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`;
    const pageTitle = `${p.title} — Price & Comparison | BuyWhere`;
    const metaDesc = `${p.title} at ${price !== null ? `${currency} ${price.toFixed(2)}` : 'best price'} from ${p.domain || 'Singapore merchants'}. Compare prices and deals on BuyWhere.`;
    // Perplexity / AI-crawler cache headers — allow bots to cache product pages
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.type('text/html').send(htmlPage(pageTitle, metaDesc, jsonld, body));
});
exports.default = router;
