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
COPY packages/db/package.json    ./packages/db/
COPY packages/iot/package.json   ./packages/iot/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json    ./packages/ui/

RUN pnpm install --frozen-lockfile

# Copy source — invalidates build cache when code changes, not when deps change
COPY apps/cms  ./apps/cms
COPY packages  ./packages

# NEXT_PUBLIC_ vars are baked in at build time.
# Relative paths work through Nginx regardless of domain.
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL=/ws
ARG NEXT_PUBLIC_WS_GATEWAY_URL=/ws
ARG NEXT_PUBLIC_SCREENS_URL=/display
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_WS_GATEWAY_URL=${NEXT_PUBLIC_WS_GATEWAY_URL}
ENV NEXT_PUBLIC_SCREENS_URL=${NEXT_PUBLIC_SCREENS_URL}

# Build CMS and all workspace packages it depends on
RUN pnpm exec turbo run build --filter="@platform/cms..."

# ─── Stage 2: Runner (Next.js standalone) ────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output contains everything needed to run — no node_modules required
COPY --from=builder /app/apps/cms/.next/standalone ./
# Static assets are not included in standalone — copy separately
COPY --from=builder /app/apps/cms/.next/static     ./apps/cms/.next/static
# Public folder for static files (images, icons, etc.)
COPY --from=builder /app/apps/cms/public           ./apps/cms/public

EXPOSE 3000

CMD ["node", "apps/cms/server.js"]
