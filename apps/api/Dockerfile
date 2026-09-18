# API image. Build from the repo root:
#   docker build -f apps/api/Dockerfile .
#
# Follows pnpm's Docker recipe: `pnpm fetch` needs only the lockfile, so the
# dependency layer stays cached until dependencies actually change.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# package.json first: its packageManager field pins pnpm for corepack. Without
# it corepack fetches the newest pnpm, which may not accept this lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter api build
# A self-contained folder with only the API's production dependencies. The
# @workspace/* packages are already bundled into dist by tsdown.
RUN pnpm --filter api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.mjs"]
