FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gosu socat && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash paperclip || true

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc; exit 0

RUN npm prune --omit=dev

RUN printf '#!/bin/bash\nexec node --max-old-space-size=450 /app/dist/index.js\n' > /usr/local/bin/paperclipai && chmod +x /usr/local/bin/paperclipai

RUN mkdir -p /paperclip/instances/default/scripts && \
    printf '#!/bin/bash\necho "[bootstrap] skipped"\n' > /paperclip/instances/default/scripts/bootstrap-secrets.sh && \
    chmod +x /paperclip/instances/default/scripts/bootstrap-secrets.sh && \
    chown -R paperclip:paperclip /paperclip /home/paperclip

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--max-old-space-size=450", "dist/index.js"]
