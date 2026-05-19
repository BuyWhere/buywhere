FROM node:20-slim

WORKDIR /app

# Install all deps (including devDependencies for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc; exit 0

# Remove devDependencies to slim the image
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--max-old-space-size=450", "dist/index.js"]
