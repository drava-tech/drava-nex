# Project Context

## What this is

A digital signage CMS + IoT edge platform. Operators manage content and screen layouts via a web admin; screens (edge devices) pull and display that content; an API bridges the two and communicates with IoT devices over MQTT. Early MVP — some placeholder data and stubs still in place.

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

Only `apps/api` has a direct DB connection. The CMS currently writes JSON files, not API calls — this is a known MVP gap.

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

## Current MVP gaps (as of 2026-06-13)

- API returns hardcoded/demo data for several routes — real DB queries not yet wired
- WebSocket endpoint is a placeholder stub
- CMS writes layout/content data to JSON files instead of calling the API
- `AGENTS.md` and `CLAUDE.md` do not yet exist
