# Tech Stack & Libraries Used

This document details the core technologies, libraries, and frameworks utilized across the CMS platform.

---

## 1. Core Language & Build Runtime

- **Node.js 20 (Alpine)**: Runtime for all server processes. Docker images use `node:20-alpine`.
- **TypeScript**: Strict compile-time type-safety workspace-wide via `tsconfig.base.json`.
- **pnpm 9**: Package manager orchestrating dependency resolution and workspace symlinking.
- **Turborepo**: Build pipeline manager — caches task outputs and enforces dependency order (`^build`).
- **corepack**: Used inside Docker to activate pnpm at the exact pinned version.

---

## 2. Database & Data Mapping

- **PostgreSQL 16 (Alpine)**: Relational database. Docker image: `postgres:16-alpine`.
- **Drizzle ORM**: TypeScript-first ORM for compile-safe queries, schemas, and relations.
- **drizzle-kit**: CLI tool for schema introspection, migration generation (`db:generate`), and push (`db:push`).
- **pg (node-postgres)**: PostgreSQL driver powering the connection pool in `@platform/db`.

---

## 3. Applications & Gateways

- **Hono**: Lightweight web framework running the REST API in `apps/api`, via the
  `@hono/node-server` adapter. CORS is configured from `CORS_ORIGIN`.
- **ws**: The WebSocket server powering the real-time gateway (`apps/api/src/ws/gateway.ts`) —
  per-screen rooms, content broadcast, and the live-stream binary relay. Attached to the same
  HTTP server via its `upgrade` handler on `/ws`.
- **Next.js 15**: Full-stack React framework for both CMS and Screens apps.
  - `output: 'standalone'` on both — minimal self-contained Docker images.
  - `outputFileTracingRoot` set to repo root so workspace packages are traced correctly.
  - `transpilePackages: ['@platform/ui']` on both apps.
  - Screens sets `basePath:/display` (via `NEXT_PUBLIC_SCREENS_BASE_PATH`) in production.
- **better-auth**: Authentication for the CMS (admin login, sessions, roles) — routes live in
  the CMS Next app under `/api/auth/*`.
- **WebCodecs / Canvas**: Browser APIs used by the screens to decode the live-stream feed —
  `VideoDecoder` for H.264, `createImageBitmap` for MJPEG — painted to a `<canvas>`.
- **sharp**: Image processing for media uploads/handling in the CMS.
- **tsx**: Dev-mode TypeScript runner for the API and the DB scripts/seeds.

---

## 4. Message Broker & IoT Integration

- **Eclipse Mosquitto 2**: MQTT broker. Docker image: `eclipse-mosquitto:2`.
  - Port 1883 — standard MQTT protocol
  - Port 9001 — MQTT over WebSocket (browser clients)
  - Both ports are internal-only in Docker (no host binding)
- **mqtt (npm)**: Node client used by `@platform/iot` to connect `apps/api` to Mosquitto.

---

## 5. Infrastructure & Containerisation

- **Docker / Docker Compose**: All 6 services run in Docker containers.
  - `postgres`, `mosquitto`, `api`, `cms`, `screens` — on `internal` network only
  - `nginx` — on both `internal` and `public` networks
- **Nginx Alpine**: Reverse proxy. Docker image: `nginx:alpine`. Only service with a host port binding (`80:80`).
  - Config: `infra/nginx/default.conf` (Docker mode, service names)
  - Config: `infra/nginx/nginx.conf` (local dev mode, `host.docker.internal`)
- **Two Docker networks:**
  - `internal` (`internal: true`) — isolated, no external internet access
  - `public` — nginx bridges host and internal services

---

## 6. Shared Packages

| Package | Purpose |
|---|---|
| `@platform/types` | Shared TypeScript type definitions (Screen, Content, Schedule, IoT types) |
| `@platform/db` | Drizzle client, schema, migrations, `checkDatabaseHealth()` |
| `@platform/iot` | MQTT device manager wrapper |
| `@platform/ui` | React component library (shadcn-style, Tailwind v4) |
| `@platform/config` | Shared ESLint + TypeScript base configs (JSON exports, no build) |
