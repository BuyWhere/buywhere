FROM node:20-alpine

WORKDIR /app

# Build context is mcp-railway/ so paths are relative to that directory
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --production

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
