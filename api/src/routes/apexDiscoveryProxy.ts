import { Router, Request, Response } from 'express';

/**
 * BUY-74774: Proxy AEO/discovery surfaces on api.buywhere.ai to apex
 * (buywhere.ai). Each surface shrunk vs apex parity because the api host
 * (Express / Railway hikari) only registered inline stubs:
 *
 *   /.well-known/mcp.json         493B → 8063B  (full v2-first manifest on apex)
 *   /llms.txt                     820B → 4165B  (apex public/llms.txt body)
 *   /developers/sitemap-index.xml 242B/1 → 1269B/9 (apex sitemap-index listing)
 *   /sitemap-compare.xml          110B/0 → 192916B/958 (apex generate-on-demand)
 *
 * The previously-wired native /sitemap-compare.xml handler was DB-backed
 * against the api host's `comparison_pages` table (4 rows) which has nothing
 * to do with the apex PRODUCT_TAXONOMY-driven enumerator. Rather than
 * re-implement the canonical generator on the api host, proxy each path to
 * apex. Apex is the source of truth and serves all four surfaces correctly.
 *
 * Pattern lifted verbatim from sitemapProxy.ts (BUY-74662). The proxy
 * routes inherit the same cache hints and debug header convention.
 *
 * Latency: each request is one apex round-trip on the same Railway project
 * (intra-region, < 50ms P50). No upstream load implications — these are
 * crawler/discovery fetches, not customer-facing.
 *
 * Deployment note: this router is mounted via `app.use(apexDiscoveryProxyRouter)`
 * in server.ts. Express matches in registration order, so:
 *   - `/sitemap-compare.xml` proxy wins over the native sitemapCompareRouter
 *     (the native handler is still mounted AFTER the proxy for any future
 *     DB-backed recovery path; it's just unreachable today).
 *   - `/.well-known/mcp.json` falls through the wellknown router (which no
 *     longer defines this route) and reaches this proxy.
 *   - `/llms.txt` and `/developers/sitemap-index.xml` had no pre-existing
 *     conflict (the inline stubs were removed).
 */
const APEX_ORIGIN = 'https://buywhere.ai';
const PROXY_TIMEOUT_MS = 5000;

// Each entry: [express-path, apex-path, content-type override, cache-control].
// Cache-Control mirrors the original api host header so crawlers/CDNs see the
// same TTL semantics. Content-Type is preserved from upstream when present so
// the proxy can serve both `application/json` (mcp.json) and `text/plain`
// (llms.txt) without per-handler branching.
const PROXIED: Array<{
  apiPath: string;
  apexPath: string;
  cacheControl: string;
}> = [
  {
    apiPath: '/llms.txt',
    apexPath: '/llms.txt',
    cacheControl: 'public, max-age=86400',
  },
  {
    apiPath: '/.well-known/mcp.json',
    apexPath: '/.well-known/mcp.json',
    cacheControl: 'public, max-age=3600',
  },
  {
    apiPath: '/developers/sitemap-index.xml',
    apexPath: '/developers/sitemap-index.xml',
    cacheControl: 'public, max-age=3600, s-maxage=3600',
  },
  // BUY-74774: also bring /sitemap-compare.xml to apex parity. The native
  // handler is kept mounted but only for `/` path; we mount a parallel
  // route at the same path that takes precedence in the Express stack
  // (registered after sitemapCompareRouter would be too late, so this
  // proxy is registered BEFORE the native sitemapCompareRouter in server.ts
  // by routing through `app.get` order — see server.ts).
  {
    apiPath: '/sitemap-compare.xml',
    apexPath: '/sitemap-compare.xml',
    cacheControl: 'public, max-age=3600, s-maxage=86400',
  },
];

const router = Router();

for (const route of PROXIED) {
  router.get(route.apiPath, async (_req: Request, res: Response) => {
    const url = `${APEX_ORIGIN}${route.apexPath}`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        signal: ac.signal,
        headers: { Accept: 'application/json,application/xml,text/plain,*/*' },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        // Mirror apex status so we don't manufacture a false 200.
        res
          .status(upstream.status)
          .type('text/plain')
          .send(`upstream ${route.apexPath} returned ${upstream.status}`);
        return;
      }
      const body = await upstream.text();
      const ct =
        upstream.headers.get('content-type') || 'application/octet-stream';
      res.set('Content-Type', ct);
      res.set('Cache-Control', route.cacheControl);
      res.set('X-Apex-Discovery-Proxy', `apex->api:${route.apexPath}`);
      res.status(200).send(body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'upstream_unreachable';
      res.status(502).type('text/plain').send(
        `apex discovery proxy error: ${msg}`
      );
    } finally {
      clearTimeout(t);
    }
  });
}

export default router;
