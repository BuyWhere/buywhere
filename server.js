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
// How: monkey-patch `http.createServer` so when the auto-generated
// `startServer` from `next/dist/server/lib/start-server` calls
// `http.createServer(listener)`, our wrapper intercepts the listener,
// wraps it to delete `next-router-state-tree` on /search and /compare,
// and then calls the original listener. This stays compatible with the
// `output: 'standalone'` build (same `next start` code path, same
// node_modules layout) and only adds the header-strip layer at the
// HTTP-entrypoint boundary.

const path = require('node:path');
const http = require('node:http');

// Routes whose Next-Router-State-Tree header is incompatible with the
// 14.2.35 router-state parser. Add here if QA finds another route that
// 500s on Chrome RSC nav with a populated __PAGE__ shape.
const RSTRIPPED_PREFIXES = ['/search', '/compare'];

// Header to strip. Case-insensitive — Node lowercases incoming header keys.
const RSTATE_HEADER = 'next-router-state-tree';

// Wrap http.createServer BEFORE requiring next so the patch is in place
// when startServer calls createServer internally.
const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(requestListener, options) {
  // If a requestListener was provided, wrap it. Otherwise return the
  // original (no-op) server, the caller can attach listeners later.
  if (typeof requestListener === 'function') {
    const wrapped = function wrappedRequestListener(req, res) {
      try {
        const url = req.url || '/';
        const pathname = url.split('?', 1)[0] || '/';
        if (
          RSTRIPPED_PREFIXES.some(
            (p) => pathname === p || pathname.startsWith(p + '/'),
          ) &&
          req.headers[RSTATE_HEADER]
        ) {
          delete req.headers[RSTATE_HEADER];
        }
      } catch (e) {
        // Never let the strip wrapper itself take down a request.
      }
      return requestListener.call(this, req, res);
    };
    return originalCreateServer(wrapped, options);
  }
  return originalCreateServer(requestListener, options);
};

// Now delegate to Next 14.2.35's standard `startServer`. The monkey-
// patched http.createServer above will wrap the listener that startServer
// installs, adding the header-strip layer transparently.
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
