FROM node:20-alpine

WORKDIR /app

COPY api/package.json ./
RUN npm install --production=false

COPY api/tsconfig.json ./
COPY api/src/ ./src/

RUN npm run build

# Remove dev deps after build so the runtime image stays lean.
RUN npm prune --production

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
