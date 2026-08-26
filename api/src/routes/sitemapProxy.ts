import { Router, Request, Response } from 'express';

/**
 * BUY-74662: Proxy split-sitemap routes on api.buywhere.ai to apex
 * (buywhere.ai). The api host (Express / Railway hikari) never registered
 * the 9 split-sitemap routes structurally — it only wired
 * /sitemap-compare.xml and /sitemap.xml (1-entry index).
 *
 * Rather than re-implement 9 native routes with the same data sources as the
 * Next.js apex (heavier change), proxy each path to apex. Apex is canonical
 * and intact.
 *
 * List of splits proxied (basenames match the apex split-sitemap files per
 * Reach clarification 2026-08-25T05:30Z):
 *   -products, -blog, -merchants, -stores, -brands, -categories,
 *   -docs, -pages, -comparisons, -index
 *
 * Note: -faq is listed in the parent issue but apex does not serve it
 * (Next.js 404 page). We DO NOT proxy -faq — that would leak a 200 with a
 * Next.js HTML 404 body into our XML surface, which is worse than the
 * existing 404. -compare is wired natively on the api host (not proxied).
 */
const SPLIT_NAMES = [
  'products',
  'blog',
  'merchants',
  'stores',
  'brands',
  'categories',
  'docs',
  'pages',
  'comparisons',
  'index',
];

const APEX_ORIGIN = 'https://buywhere.ai';
// Short timeout — sitemap body is small and apex is on the same Railway project.
const PROXY_TIMEOUT_MS = 5000;

const router = Router();

for (const name of SPLIT_NAMES) {
  // Match the literal `/sitemap-<name>.xml` path. Using .get with a literal
  // string avoids any dynamic router confusion.
  router.get(`/sitemap-${name}.xml`, async (_req: Request, res: Response) => {
    const url = `${APEX_ORIGIN}/sitemap-${name}.xml`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        signal: ac.signal,
        headers: { Accept: 'application/xml,text/xml,*/*' },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        // Mirror apex status so we don't manufacture a false 200.
        res.status(upstream.status).type('text/plain').send(
          `upstream sitemap ${name} returned ${upstream.status}`
        );
        return;
      }
      const body = await upstream.text();
      const ct = upstream.headers.get('content-type') || 'application/xml; charset=utf-8';
      res.set('Content-Type', ct);
      // Same cache hints as the native sitemap-compare.xml handler.
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      res.set('X-Sitemap-Proxy', `apex->api:${name}`);
      res.status(200).send(body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'upstream_unreachable';
      res.status(502).type('text/plain').send(`sitemap proxy error: ${msg}`);
    } finally {
      clearTimeout(t);
    }
  });
}

export default router;