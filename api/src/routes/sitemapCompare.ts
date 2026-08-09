import { Router, Request, Response } from 'express';
import { db } from '../config';

const router = Router();

// GET /sitemap-compare.xml
// Auto-generated XML sitemap for published comparison pages.
// lastmod = MAX(price_history.recorded_at) across linked products, falling back to
// comparison_pages.updated_at if no price rows exist yet.
router.get('/', async (req: Request, res: Response) => {
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol).split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'buywhere.ai';
  const base = `${proto}://${host}`;

  // A DB failure must NOT be rendered as an empty <urlset>. An empty-but-200
  // sitemap tells crawlers "these URLs no longer exist" — an active deindexing
  // signal, and strictly worse than a 5xx, which crawlers simply retry.
  // BUY-67724: this endpoint served an empty urlset for 24+ hourly probes with
  // no way to distinguish "no published rows" from "database unreachable".
  let result;
  try {
    result = await db.query(
      `SELECT
         cp.slug,
         COALESCE(MAX(ph.recorded_at), cp.updated_at) AS lastmod
       FROM comparison_pages cp
       LEFT JOIN price_history ph ON ph.product_id = ANY(cp.product_ids)
       WHERE cp.status = 'published'
       GROUP BY cp.slug, cp.updated_at
       ORDER BY cp.slug`
    );
  } catch (err) {
    console.error('[sitemap-compare] DB query failed — serving 503 instead of an empty urlset', err);
    res.set('Cache-Control', 'no-store');
    res
      .status(503)
      .type('application/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?>\n<!-- sitemap temporarily unavailable -->');
    return;
  }

  const rows: Array<{ slug: string; lastmod: Date }> = result?.rows ?? [];

  // Zero published rows is legitimate, but still worth surfacing: it is the
  // difference between "nothing to index yet" and "we just dropped every URL".
  if (rows.length === 0) {
    console.warn('[sitemap-compare] 0 published comparison_pages rows — serving empty urlset');
  }

  const urlEntries = rows
    .map((row) => {
      const lastmod = row.lastmod
        ? new Date(row.lastmod).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      return [
        '  <url>',
        `    <loc>${base}/compare/${escapeXml(row.slug)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>daily</changefreq>',
        '    <priority>0.8</priority>',
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntries,
    '</urlset>',
  ].join('\n');

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.send(xml);
});

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
