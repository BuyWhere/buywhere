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
# Preserve the auto-generated standalone server.js as
# `.next-deploy-original/server.js` so our server.js can delegate to it
# (the auto-generated entry handles the __NEXT_PRIVATE_STANDALONE_CONFIG
# setup correctly, which is what makes Next skip its config-file load).
RUN mkdir -p .next-deploy-original && cp ./server.js ./.next-deploy-original/server.js
COPY --from=builder --chown=node:node /app/.next-deploy/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/content ./content
COPY --from=builder /app/docs ./docs
# Replace the auto-generated standalone entry with our delegating wrapper.
COPY server.js ./server.js
# Preload module that monkey-patches http.createServer at process startup so
# the HTTP listener created later (by Next's startServer, called from our
# delegating server.js → auto-generated server.js) automatically strips the
# Next-Router-State-Tree header on /search and /compare requests.
COPY preload-rsc-strip.cjs ./preload-rsc-strip.cjs
ENV NODE_OPTIONS="--require /app/preload-rsc-strip.cjs"
RUN mkdir -p .next-deploy && ln -s ../.next/static .next-deploy/static

EXPOSE 3000
CMD ["node", "server.js"]
