FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build --no-lint

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next-deploy/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next-deploy/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/content ./content

EXPOSE 3000
CMD ["node", "server.js"]
