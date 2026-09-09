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

function htmlPage(title: string, description: string, jsonld: object | object[], bodyHtml: string): string {
  const scripts = Array.isArray(jsonld)
    ? jsonld.map(j => `<script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n</script>`).join('\n')
    : `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
${scripts}
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
  h1{font-size:1.6rem;margin-bottom:.2em}
  .product-card{border:1px solid #e5e5e5;border-radius:8px;padding:14px;margin:10px 0}
  .price{font-weight:700;color:#0a7c59}
  .meta{color:#666;font-size:.9em}
  nav a{color:#0969da;text-decoration:none;font-size:.95em}
  nav span{color:#999;margin:0 4px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:16px}
  .card{border:1px solid #e5e5e5;border-radius:8px;padding:12px}
  .card img{max-width:100%;height:160px;object-fit:contain;border-radius:4px}
  .card a{color:inherit;text-decoration:none;font-weight:600}
  .subcat{display:inline-block;background:#f0f4f8;border-radius:4px;padding:4px 10px;margin:4px;font-size:.9em}
  .subcat a{color:#0969da;text-decoration:none}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// GET /c/:slug — public category page with ItemList + BreadcrumbList JSON-LD
router.get('/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params;
  const limit = 24;
  const base = baseUrl(req);

  const slugResult = await db.query(
    `SELECT DISTINCT category_path[1] AS name FROM products
     WHERE currency = 'SGD' AND category_path IS NOT NULL
       AND LOWER(REGEXP_REPLACE(category_path[1], '[^a-zA-Z0-9]+', '-', 'g')) = $1
     LIMIT 1`,
    [slug]
  ).catch(() => null);

  if (!slugResult || slugResult.rows.length === 0) {
    res.status(404).send('<h1>Category not found</h1>');
    return;
  }

  const categoryName = slugResult.rows[0].name;

  let productsResult, subCatsResult;
  try {
    [productsResult, subCatsResult] = await Promise.all([
      db.query(
        `SELECT id, name AS title, price, currency, image_url, platform::text AS domain, product_url AS url,
                sku, mpn
         FROM products
         WHERE currency = 'SGD' AND category_path[1] = $1
         ORDER BY updated_at DESC LIMIT $2`,
        [categoryName, limit]
      ),
      db.query(
        `SELECT category_path[2] AS sub_name, COUNT(*) AS cnt
         FROM products
         WHERE currency = 'SGD' AND category_path[1] = $1
           AND array_length(category_path, 1) > 1
         GROUP BY category_path[2]
         ORDER BY cnt DESC LIMIT 10`,
        [categoryName]
      ),
    ]);
  } catch (_) {
    res.status(500).send('<h1>Server error</h1>');
    return;
  }

  const products: Array<{ id: string; title: string; price: string | null; currency: string; image_url: string | null; domain: string; url: string; sku: string | null; mpn: string | null }> = productsResult.rows;
  const subCats: Array<{ sub_name: string; cnt: string }> = subCatsResult?.rows || [];

  const categoryUrl = `${base}/c/${slug}`;

  // Schema.org ItemList
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${base}/#item-list`,
    name: `${categoryName} — BuyWhere`,
    description: `Browse ${products.length}+ ${categoryName} products from Singapore's top merchants.`,
    url: categoryUrl,
    numberOfItems: products.length,
    mainEntityOfPage: categoryUrl,
    itemListElement: products.map((p, i) => {
      const item: Record<string, unknown> = {
        '@type': 'ListItem',
        position: i + 1,
        url: `${base}/p/${p.id}`,
        name: p.title,
      };
      if (p.price) {
        item.item = {
          '@type': 'Product',
          name: p.title,
          image: p.image_url || undefined,
          url: `${base}/p/${p.id}`,
          ...(p.sku ? { sku: p.sku } : {}),
          ...(p.mpn ? { mpn: p.mpn } : {}),
          offers: {
            '@type': 'Offer',
            price: parseFloat(p.price),
            priceCurrency: p.currency || 'SGD',
            availability: 'https://schema.org/InStock',
            seller: { '@type': 'Organization', '@id': `${base}/#organization`, name: p.domain || 'BuyWhere' },
            url: p.url,
          },
        };
      }
      return item;
    }),
  };

  // Schema.org BreadcrumbList
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${base}/#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'BuyWhere', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: categoryName, item: categoryUrl },
    ],
  };

  const subCatHtml = subCats.length
    ? `<div style="margin:10px 0">${subCats
        .filter(s => s.sub_name)
        .map(
          s =>
            `<span class="subcat"><a href="/c/${encodeURIComponent(
              s.sub_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
            )}">${escHtml(s.sub_name)}</a> (${s.cnt})</span>`
        )
        .join('')}</div>`
    : '';

  const productCards = products
    .map(
      (p) =>
        `<div class="card">
  ${p.image_url ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" loading="lazy">` : ''}
  <p><a href="/p/${p.id}">${escHtml(p.title.slice(0, 80))}</a></p>
  ${p.price ? `<div class="price">${p.currency || 'SGD'} ${parseFloat(p.price).toFixed(2)}</div>` : ''}
  <div class="meta">${escHtml(p.domain || '')}</div>
</div>`
    )
    .join('');

  const body = `
<nav><a href="/">BuyWhere</a><span>›</span><span>${escHtml(categoryName)}</span></nav>
<h1>${escHtml(categoryName)}</h1>
<p class="meta">${products.length}${products.length === limit ? '+' : ''} products from Singapore's top merchants</p>
${subCatHtml}
<div class="grid">${productCards}</div>`;

  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.set('X-Robots-Tag', 'ai-index');
  res.type('text/html').send(
    htmlPage(
      `${categoryName} — Compare Prices | BuyWhere`,
      `Shop ${categoryName} in Singapore. Compare prices across Lazada, Shopee, Best Denki and more on BuyWhere.`,
      [itemList, breadcrumb],
      body
    )
  );
});

export default router;
