FROM node:20-alpine
WORKDIR /app

RUN printf '{"name":"buywhere-mcp","version":"1.0.0","type":"module"}' > package.json && npm install express cors --save

COPY mcp-server.js ./
COPY mcp-health-config.js ./

ENV NODE_ENV=production
ENV MCP_PORT=3002
EXPOSE 3002

CMD ["node", "mcp-server.js"]
