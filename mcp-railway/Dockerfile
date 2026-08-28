FROM node:20-alpine

WORKDIR /app

# Install production deps only — dist/ is committed so no build step needed
COPY mcp-railway/package.json mcp-railway/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy committed dist + config (no build required)
COPY mcp-railway/dist/ ./dist/
COPY mcp-railway/dist/config.js ./dist/config.js
COPY mcp-railway/dist/config-no-redis.js ./dist/config-no-redis.js

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
