FROM node:20-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY api/package*.json ./
RUN npm ci

COPY api/tsconfig*.json ./
COPY api/src ./src
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/jobs/embedRunner.js"]
