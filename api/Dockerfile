FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gosu socat && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash paperclip || true

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
# BUY-32359: force fresh tsc build to pick up the monitoring export fix.
# BUY-45741: previously `npx tsc; exit 0` swallowed ALL compile errors, so a
# missing-module import (e.g. the BUY-45553 merge referencing non-existent
# lib/semanticSearch + lib/embeddingCache) built "successfully" but crash-looped
# at startup with `Cannot find module`. We still tolerate the pre-existing,
# runtime-harmless type errors (TS7016/TS7006 @types/express, @types/cors), but
# now FAIL the build on any unresolved-module error (TS2307) — the exact class
# that takes prod down. tsc still emits dist/ even when it exits non-zero.
RUN rm -rf dist && (npx tsc > /tmp/tsc.log 2>&1 || true); cat /tmp/tsc.log; \
    if grep -q "error TS2307" /tmp/tsc.log; then \
      echo "FATAL (BUY-45741): unresolved module import(s) — would crash at startup:"; \
      grep "error TS2307" /tmp/tsc.log; exit 1; \
    fi; \
    test -f dist/index.js || { echo "FATAL: tsc produced no dist/index.js"; exit 1; }

RUN npm prune --omit=dev

RUN printf '#!/bin/bash\nexec node --unhandled-rejections=warn --max-old-space-size=450 /app/dist/index.js\n' > /usr/local/bin/paperclipai && chmod +x /usr/local/bin/paperclipai

RUN mkdir -p /paperclip/instances/default/scripts && \
    printf '#!/bin/bash\necho "[bootstrap] skipped"\n' > /paperclip/instances/default/scripts/bootstrap-secrets.sh && \
    chmod +x /paperclip/instances/default/scripts/bootstrap-secrets.sh && \
    chown -R paperclip:paperclip /paperclip /home/paperclip /app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--unhandled-rejections=warn", "--max-old-space-size=450", "dist/index.js"]
