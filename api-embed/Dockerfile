FROM node:20-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY api/package*.json ./
# Build needs typescript (a devDependency). Railway's builder sets NODE_ENV=production,
# which makes a bare `npm ci` omit devDependencies and break `npm run build` (tsc missing).
# Force-include dev deps for the build, then prune before shipping the runtime image.
RUN npm ci --include=dev

COPY api/tsconfig*.json ./
COPY api/src ./src
RUN npm run build

# Drop dev dependencies from the shipped image; only runtime deps are needed.
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/jobs/embedRunner.js"]
