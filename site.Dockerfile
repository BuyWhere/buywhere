FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build --no-lint

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# BUY-67036 / BUY-69260: replace the standalone Next.js HTTP entrypoint with
# a custom server that strips Next-Router-State-Tree on /search and /compare
# before Next sees the request. See server.js + preload-rsc-strip.cjs for the
# full rationale.
COPY --from=builder /app/.next-deploy/standalone ./
COPY --from=builder --chown=node:node /app/.next-deploy/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/content ./content
COPY --from=builder /app/docs ./docs
# Replace the auto-generated standalone entry with our custom server.js so
# the CMD below starts the strip-and-proxy variant instead of plain next start.
COPY server.js ./server.js
# Preload module that monkey-patches http.createServer at process startup so
# any HTTP listener created later (by Next's startServer) automatically strips
# the Next-Router-State-Tree header on /search and /compare requests.
COPY preload-rsc-strip.cjs ./preload-rsc-strip.cjs
ENV NODE_OPTIONS="--require /app/preload-rsc-strip.cjs"
RUN mkdir -p .next-deploy && ln -s ../.next/static .next-deploy/static

EXPOSE 3000
CMD ["node", "server.js"]
