import { Router, Request, Response } from 'express';
import { db } from '../config';

const router = Router();

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function baseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string || req.protocol).split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  return `${proto}://${host}`;
}

// GET /compare?ids=id1,id2,... — public comparison page
// Schema.org: AggregateOffer for summary, ItemList for the product set
router.get('/', async (req: Request, res: Response) => {
  const ids = ((req.query.ids as string) || '').split(',').filter(Boolean).slice(0, 10);

  if (ids.length < 2) {
    res.status(400).send('<h1>Provide at least 2 product IDs via ?ids=id1,id2</h1>');
    return;
  }

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const result = await db.query(
    `SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
            name AS title, price, original_price, currency, image_url,
            brand, description, category_path, rating, review_count,
            availability, updated_at
     FROM products WHERE id IN (${placeholders})`,
    ids
  ).catch(() => null);

  if (!result || result.rows.length === 0) {
    res.status(404).send('<h1>Products not found</h1>');
    return;
  }

  const products = result.rows;
  const base = baseUrl(req);
  const currency = products[0]?.currency || 'SGD';

  const prices = products
    .map((p) => (p.price ? parseFloat(p.price) : null))
    .filter((v): v is number => v !== null);

  const lowPrice = prices.length ? Math.min(...prices) : null;
  const highPrice = prices.length ? Math.max(...prices) : null;

  // Schema.org AggregateOffer — summarizes the price range across sellers
  const aggregateOffer: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'AggregateOffer',
    priceCurrency: currency,
    offerCount: products.length,
    offers: products.map((p) => {
      const offer: Record<string, unknown> = {
        '@type': 'Offer',
        priceCurrency: p.currency || 'SGD',
        availability:
          p.availability === 'out_of_stock'
            ? 'https://schema.org/OutOfStock'
            : p.availability === 'preorder'
            ? 'https://schema.org/PreOrder'
            : 'https://schema.org/InStock',
        url: p.url,
        seller: { '@type': 'Organization', name: p.domain || 'BuyWhere' },
      };
      if (p.price) offer.price = parseFloat(p.price);
      return offer;
    }),
  };
  if (lowPrice !== null) aggregateOffer.lowPrice = lowPrice;
  if (highPrice !== null) aggregateOffer.highPrice = highPrice;

  // Schema.org ItemList — the set of products being compared
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Compare: ${products.map((p) => p.title.split(' ').slice(0, 4).join(' ')).join(' vs ')} | BuyWhere`,
    url: `${base}/compare?ids=${ids.join(',')}`,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${base}/p/${p.id}`,
      name: p.title,
      item: {
        '@type': 'Product',
        name: p.title,
        image: p.image_url || undefined,
        url: `${base}/p/${p.id}`,
        ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
        ...(p.rating
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: parseFloat(p.rating),
                reviewCount: p.review_count || 1,
                bestRating: 5,
                worstRating: 1,
              },
            }
          : {}),
        offers: {
          '@type': 'Offer',
          priceCurrency: p.currency || 'SGD',
          availability:
            p.availability === 'out_of_stock'
              ? 'https://schema.org/OutOfStock'
              : 'https://schema.org/InStock',
          seller: { '@type': 'Organization', name: p.domain || 'BuyWhere' },
          url: p.url,
          ...(p.price ? { price: parseFloat(p.price) } : {}),
        },
      },
    })),
  };

  // Comparison table rows
  const tableRows = [
    ['Price', products.map((p) => (p.price ? `${p.currency || 'SGD'} ${parseFloat(p.price).toFixed(2)}` : 'N/A'))],
    ['Merchant', products.map((p) => p.domain || 'N/A')],
    ['Brand', products.map((p) => p.brand || 'N/A')],
    ['Rating', products.map((p) => (p.rating ? `${parseFloat(p.rating).toFixed(1)} ★` : 'N/A'))],
    ['Availability', products.map((p) => (p.availability === 'out_of_stock' ? 'Out of stock' : 'In stock'))],
  ] as [string, string[]][];

  const tableHtml = `
<table style="width:100%;border-collapse:collapse;margin-top:20px">
  <thead>
    <tr>
      <th style="border:1px solid #e5e5e5;padding:8px 12px;background:#f6f8fa;text-align:left">Feature</th>
      ${products.map((p) => `<th style="border:1px solid #e5e5e5;padding:8px 12px;background:#f6f8fa;text-align:left"><a href="/p/${p.id}" style="color:#0969da">${escHtml(p.title.slice(0, 50))}</a></th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${tableRows
      .map(
        ([label, vals]) =>
          `<tr>
      <td style="border:1px solid #e5e5e5;padding:8px 12px;font-weight:600">${label}</td>
      ${vals.map((v) => `<td style="border:1px solid #e5e5e5;padding:8px 12px">${escHtml(String(v))}</td>`).join('')}
    </tr>`
      )
      .join('')}
  </tbody>
</table>`;

  const imageRow = products
    .map(
      (p) => `<div style="flex:1;text-align:center;padding:12px">
  <img src="${p.image_url ? escHtml(p.image_url) : ''}" alt="${escHtml(p.title)}" style="max-width:150px;max-height:150px;object-fit:contain" loading="lazy">
  <p style="font-size:.9em;margin-top:8px"><a href="/p/${p.id}" style="color:#0969da">${escHtml(p.title.slice(0, 60))}</a></p>
  ${p.price ? `<div style="font-weight:700;color:#0a7c59">${p.currency || 'SGD'} ${parseFloat(p.price).toFixed(2)}</div>` : ''}
  <a href="/r/buywhere/${p.id}" rel="sponsored" style="display:inline-block;margin-top:8px;padding:8px 14px;background:#0a7c59;color:#fff;border-radius:6px;text-decoration:none;font-size:.9em">View deal</a>
</div>`
    )
    .join('');

  const title = `Compare ${products.map((p) => p.title.split(' ').slice(0, 3).join(' ')).join(' vs ')} — BuyWhere`;
  const description = `Compare prices and specs: ${products.map((p) => p.title).join(', ')}. Find the best deal in Singapore on BuyWhere.`;

  const scripts = [aggregateOffer, itemList]
    .map((j) => `<script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n</script>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
${scripts}
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
  h1{font-size:1.5rem}
  nav a{color:#0969da;text-decoration:none;font-size:.95em}
  nav span{color:#999;margin:0 4px}
</style>
</head>
<body>
<nav><a href="/">BuyWhere</a><span>›</span><span>Compare</span></nav>
<h1>Product Comparison</h1>
<div style="display:flex;gap:8px;flex-wrap:wrap">${imageRow}</div>
${tableHtml}
<p style="margin-top:20px;color:#555;font-size:.9em">Price comparison across Singapore merchants. Data updated regularly.</p>
</body>
</html>`;

  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.set('X-Robots-Tag', 'ai-index');
  res.type('text/html').send(html);
});

export default router;
