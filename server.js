// BUY-67036 / BUY-69260: Custom Next.js server.
//
// Next 14.2.35 has a parser regression on the App Router's
// `parseAndValidateFlightRouterState` (see
// node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js).
// When a Chrome RSC navigation request carries a populated
// `Next-Router-State-Tree` header (e.g. [["__PAGE__",{q,country}], ...]),
// the parser throws "The router state header was sent but could not be
// parsed." and the route falls through to the Pages Router _error envelope
// with HTTP 500. Route-level error.tsx boundaries cannot catch this — the
// failure happens in the router-state parser BEFORE any page handler runs.
//
// Verified workarounds that DO NOT work:
//   * middleware.ts NextResponse.rewrite()           — middleware does not
//                                                      run on App Router RSC
//                                                      requests in 14.2.x.
//   * middleware.ts NextResponse.next({request:{headers}})  — read-only at
//                                                              Edge runtime.
//   * next.config.mjs rewrites() with destination     — destination inherits
//                                                      the original headers;
//                                                      the parser still crashes.
//   * Route-level force-dynamic + Promise<searchParams> + drop <Suspense>
//     (PR #473) — the parser runs before any of those help.
//
// Verified workaround that DOES work:
//   Strip the `Next-Router-State-Tree` header at the HTTP entrypoint, before
//   Next.js's request handler sees it. The custom server below does exactly
//   that for /search and /compare; other routes pass through unchanged.
//
// Behaviour:
//   * RSC nav request on /search or /compare WITH populated state-tree →
//     header stripped, Next serves the route, returns 200.
//   * RSC nav request on other routes → header preserved, normal behaviour.
//   * Plain HTML, RSC prefetch, API requests → unchanged.
//   * RSC nav request that legitimately depends on state-tree (rare, only
//     on these two routes today) → falls back to URL-derived params, which
//     Chrome's app-router client already uses as the source of truth.
//
// This file replaces the standalone Next.js HTTP entrypoint (next start)
// referenced in site.Dockerfile's CMD. We keep the `output: 'standalone'`
// build, but the runner's CMD points at this wrapper instead of the
// generated standalone server.js.

const { createServer } = require('node:http');
const { parse } = require('node:url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// Routes whose Next-Router-State-Tree header is incompatible with the
// 14.2.35 router-state parser. Add here if QA finds another route that
// 500s on Chrome RSC nav with a populated __PAGE__ shape.
const RSTRIPPED_PREFIXES = ['/search', '/compare'];

// Header to strip. Case-insensitive — Node lowercases incoming header keys.
const RSTATE_HEADER = 'next-router-state-tree';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const pathname = parse(req.url || '/').pathname || '/';

    if (
      RSTRIPPED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?')) &&
      req.headers[RSTATE_HEADER]
    ) {
      // Delete the offending header before delegating to Next. The parser
      // will fall back to URL-derived searchParams for these routes, which
      // is what Chrome uses as the source of truth anyway.
      delete req.headers[RSTATE_HEADER];
    }

    handle(req, res);
  })
    .once('error', (err) => {
      console.error('server error', err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port} (RSTRIPPED_PREFIXES=${RSTRIPPED_PREFIXES.join(',')})`);
    });
});
