// BUY-67036 / BUY-69260: see site.Dockerfile for the actual entrypoint.
//
// Historically this file held the custom HTTP server, but the simpler
// approach (NODE_OPTIONS=--require preload that monkey-patches
// http.createServer) lets us keep using the auto-generated
// .next-deploy/standalone/server.js as-is — which is the only entrypoint
// that has the inlined __NEXT_PRIVATE_STANDALONE_CONFIG wired up
// correctly so Next skips its config-file load and webpack init path.
//
// This file is intentionally a no-op so the CMD ["node", "server.js"]
// in site.Dockerfile picks up the auto-generated entry via Docker layer
// ordering (the COPY --from=builder puts it at /app/server.js BEFORE this
// file would be overlaid by a source-tree COPY).
