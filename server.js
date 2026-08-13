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
// How: this file delegates to the auto-generated standalone server.js
// (copied to /app/.next-deploy-original/server.js by the Dockerfile so
// the auto-generated file isn't clobbered by my COPY). The actual
// header stripping happens in `preload-rsc-strip.cjs`, which is
// loaded via `--require` in NODE_OPTIONS BEFORE any other module is
// evaluated — so by the time `startServer` calls `http.createServer`,
// the monkey-patch is already in place. See site.Dockerfile for the
// wiring.

require('./.next-deploy-original/server.js');
