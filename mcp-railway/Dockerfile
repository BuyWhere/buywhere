FROM node:20-alpine

WORKDIR /app

COPY mcp-railway/package.json mcp-railway/package-lock.json ./
RUN npm ci

COPY mcp-railway/tsconfig.json ./
COPY mcp-railway/src/ ./src/

RUN npm run build
RUN npm prune --production

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
