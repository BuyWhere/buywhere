// BUY-67036 / BUY-69260: Custom Next.js server entrypoint.
//
// Replaces the auto-generated `.next-deploy/standalone/server.js`.
//
// Why: Next 14.2.35 has a parser regression in
// `parseAndValidateFlightRouterState` (app-page.runtime.prod.js). When
// Chrome's RSC navigation sends a populated `__PAGE__: {q, country}`
// shape, the parser throws "The router state header was sent but could
// not be parsed" and the route returns opaque HTTP 500 from the Pages
// Router _error envelope — the failure happens BEFORE any page handler
// runs, so route-level error.tsx cannot catch it. Verified live on
// Railway deploys f426a218 through 5b3f97935 (BUY-69260 attempts:
// middleware rewrite, middleware header strip, next.config rewrites,
// /rsc-rewrite/[slug] route) that NONE of those approaches work because
// they all run AFTER the parser has already failed. The only viable
// fix is to strip the offending header at the HTTP entrypoint, before
// Next sees the request.
//
// How: this file is just a thin shim around Next's standalone
// `startServer` from `next/dist/server/lib/start-server` (same API the
// auto-generated standalone server.js uses). The actual header stripping
// happens in `preload-rsc-strip.cjs`, which is loaded via `--require`
// in NODE_OPTIONS BEFORE any other module is evaluated — so by the
// time `startServer` calls `http.createServer`, the monkey-patch is
// already in place. See site.Dockerfile for the NODE_OPTIONS wiring.

const path = require('node:path');
const dir = path.join(__dirname);
process.env.NODE_ENV = 'production';
process.chdir(dir);

const { startServer } = require('next/dist/server/lib/start-server');

startServer({
  dir,
  isDev: false,
  port: parseInt(process.env.PORT, 10) || 3000,
  hostname: process.env.HOSTNAME || '0.0.0.0',
  allowRetry: false,
  keepAliveTimeout: undefined,
  selfSignedCertificate: undefined,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
