FROM node:20-alpine AS builder
WORKDIR /app

# Copy root package files for npm install
COPY package*.json ./

# Copy Next.js source from src/ and root-level config files
COPY src/ ./src/
COPY next.config.mjs ./
COPY tailwind.config.ts ./
COPY postcss.config.mjs ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install --ignore-scripts

# Build Next.js (next.config.mjs sets distDir: '.next-deploy')
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/src
RUN npx next build --no-lint

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# next.config.mjs sets distDir: '.next-deploy', so build output is at /app/src/.next-deploy/
COPY --from=builder /app/src/.next-deploy/standalone ./
COPY --from=builder --chown=node:node /app/src/.next-deploy/static ./.next/static
COPY --from=builder /app/src/public ./public/
COPY --from=builder /app/content ./content/
COPY --from=builder /app/docs ./docs/
RUN mkdir -p .next-deploy && ln -s ../.next/static .next-deploy/static

EXPOSE 3000
CMD ["node", "server.js"]
