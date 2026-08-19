FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# BUY-67516: install devDeps explicitly so the `tsc` build step has typescript +
# @types/* even when Railway's build runs under NODE_ENV=production (which makes
# a bare `npm ci` skip devDependencies, leaving the build with no compiler and a
# cascade of FAILED deploys). `npm prune --production` below still strips them
# from the final runtime image.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --production

ENV NODE_ENV=production
ENV MCP_PORT=8081

EXPOSE 8081

CMD ["node", "dist/mcp-server.js"]
