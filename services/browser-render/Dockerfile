FROM node:20-slim

# Puppeteer's bundled Chromium needs these Debian shared libs to run at all —
# the standard Puppeteer-in-Docker dependency list (https://pptr.dev/troubleshooting).
# node:20-slim (Debian bookworm) rather than -alpine: Chromium needs glibc, not musl.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 \
    libnss3 libwayland-client0 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 xdg-utils wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deterministic path for the Chromium build Puppeteer downloads during install,
# so it lands somewhere we can chown below regardless of $HOME.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Chromium's sandbox needs a setuid helper this container doesn't have, which is
# why --no-sandbox is passed at launch (see src/server.ts) — but running the
# process itself as root is still unnecessary risk, so drop to a plain user.
RUN groupadd -r browser-render && useradd -r -g browser-render -m browser-render \
    && chown -R browser-render:browser-render /app
USER browser-render

# Internal health check only — never published to the host or the LAN; the
# control/frame traffic itself rides an outbound connection to the API's /ws
# gateway, not an inbound port on this service.
EXPOSE 8090
CMD ["node", "dist/server.js"]
