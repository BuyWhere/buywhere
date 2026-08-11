FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --production

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
