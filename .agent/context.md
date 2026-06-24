# Project Context

## What this is

A digital signage CMS + IoT edge platform. Operators author *experiences* (backed by
code-defined templates) and assign them to screens in a web admin; each screen renders its
assigned content full-screen and updates in real time over a WebSocket; the API bridges the two
(REST + WebSocket gateway) and talks to IoT devices over MQTT. Includes a **Live Stream**
template (a publisher pushes video over the gateway; screens decode it via WebCodecs/MJPEG) and
runs as a shared Docker stack on the office LAN behind Nginx.

## Apps and ports

| App | Package | Port | Purpose |
|---|---|---|---|
| CMS admin | `@platform/cms` | 3000 | Next.js 15 admin dashboard for operators |
| Screen player | `@platform/screens` | 3001 | Next.js 15 full-screen content player on edge devices |
| API gateway | `@platform/api` | 4000 | Hono 4 REST + WebSocket + MQTT bridge |

All three are routed through Nginx on port 80: `/` → CMS, `/api/` → API, `/screens/` → Screens player.

## Packages

| Package | Purpose |
|---|---|
| `@platform/db` | Drizzle ORM schema + Postgres connection (source of truth for all DB access) |
| `@platform/types` | Shared TypeScript type contracts — the canonical source; never duplicate types in apps |
| `@platform/iot` | MQTT client wrapper (`MQTTDeviceManager`) used by the API |
| `@platform/ui` | Shared React component library (Tailwind 4, CVA, clsx, tailwind-merge) |
| `@platform/config` | Shared ESLint and TypeScript config presets |

Only `apps/api` has a direct DB connection (Postgres is the single source of truth). The CMS
writes the DB via server actions, then pushes content to screens over the WebSocket (via
`POST /api/internal/broadcast`, guarded by `BROADCAST_SECRET`). `@platform/ui` also holds the
content **templates** (`portfolio`, `live-stream`) shared by the CMS and screens.

## Runtime modes

**Local dev (primary):**
```
pnpm infra:up    # starts Postgres, Mosquitto MQTT, Nginx via Docker
pnpm dev         # starts all 3 Node servers via Turborepo (hot reload)
```

**Full Docker (production-like):**
```
pnpm infra:build # builds and starts all services including the 3 apps in containers
```

## Key commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start all 3 servers with hot reload (Turborepo) |
| `pnpm build` | Build all packages in dependency order |
| `pnpm typecheck` | Full monorepo TypeScript check |
| `pnpm lint` | Lint all packages |
| `pnpm infra:up` | Start Docker infra (Postgres 16, Mosquitto, Nginx) |
| `pnpm infra:down` | Stop Docker infra |
| `pnpm infra:logs` | Stream Docker container logs |
| `pnpm db:push` | Apply schema to local DB (no migration file — use in dev only) |
| `pnpm db:generate` | Generate migration SQL from schema changes |
| `pnpm db:migrate` | Run pending migrations (use in production) |
| `pnpm db:studio` | Open Drizzle Studio GUI |
| `pnpm healthcheck` | `curl http://localhost/health` — tests full Nginx → API path |

## Health check

Two endpoints must both return `"status":"ok"`:
- `http://localhost:4000/health` — direct to API (no Nginx)
- `http://localhost/api/health` — through Nginx reverse proxy

If the second fails but the first succeeds, the problem is Nginx routing, not the API.

## Current state & known gaps (as of 2026-06)

- REST routes are DB-backed; the WebSocket gateway (per-screen rooms, content broadcast,
  live-stream binary relay) is fully implemented; CMS↔screen sync works in production.
- In production, app clients connect to `/ws` (no slash) — Nginx needs the exact `= /ws`
  upgrade block (already in `default.conf`), else the handshake 301s and sync silently breaks.
- **Live-stream smoothness:** the current MJPEG-over-WebSocket transport stutters over Wi-Fi;
  the planned fix is WebRTC via a media server (adaptive bitrate, loss-resilient).
- IoT/MQTT is connected but the rule engine is still basic (telemetry in; limited automation).
