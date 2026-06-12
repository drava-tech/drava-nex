# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace manifests first — Docker caches this layer until a package.json changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/config/            ./packages/config/
COPY apps/api/package.json       ./apps/api/
COPY apps/cms/package.json       ./apps/cms/
COPY apps/screens/package.json   ./apps/screens/
COPY packages/db/package.json    ./packages/db/
COPY packages/iot/package.json   ./packages/iot/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json    ./packages/ui/

RUN pnpm install --frozen-lockfile

# Copy source — invalidates build cache when code changes, not when deps change
COPY apps/api  ./apps/api
COPY packages  ./packages

# Build API and all workspace packages it depends on
RUN pnpm exec turbo run build --filter="@platform/api..."

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app
ENV NODE_ENV=production

# Copy full workspace so drizzle-kit migrations work inside container:
#   docker exec cms-api sh -c "pnpm --filter @platform/db db:push"
COPY --from=builder /app/node_modules        ./node_modules
COPY --from=builder /app/package.json        ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/pnpm-lock.yaml      ./pnpm-lock.yaml
COPY --from=builder /app/apps/api            ./apps/api
COPY --from=builder /app/packages            ./packages

EXPOSE 4000

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
