# The public entry point: nginx serving the built console (a static SPA) and
# proxying /api and /ws to the API. There is no Node process for the frontend.
# Build from the repo root:
#   docker build -f infra/nginx/Dockerfile .

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
# package.json first: its packageManager field pins pnpm for corepack. Without
# it corepack fetches the newest pnpm, which may not accept this lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter console build

FROM nginx:1.27-alpine
# *.template files are rendered with envsubst at container start (PUBLIC_HOST).
COPY infra/nginx/templates/ /etc/nginx/templates/
COPY --from=build /repo/apps/console/dist /usr/share/nginx/html
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -q --spider --header="Host: localhost" http://127.0.0.1/health || exit 1
