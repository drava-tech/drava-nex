# Event-Driven Digital Signage, CMS, and IoT Platform

Welcome to the Experience Center Digital Signage and Content Management Platform. This is a production-grade monorepo setup powered by **pnpm**, **Turborepo**, and **TypeScript**.

## Architecture & System Topology

The platform integrates three main core domains:
1. **CMS**: React-based admin control panel for content curation, scheduling, and live device telemetry viewing.
2. **Screen Player**: Edge device renderer that reads playlists/templates and plays scheduled dynamic content.
3. **IoT and Messaging Gateway**: High-throughput message broker processing sensor events, evaluating edge rules, and publishing layout adjustments.

```mermaid
graph TD
    subgraph Apps [Applications]
        CMS["@platform/cms (Next.js Admin Console)"]
        Screens["@platform/screens (Next.js Screen Player)"]
        API["@platform/api (Hono REST & WS Gateway)"]
    end

    subgraph Packages [Shared Libraries]
        Types["@platform/types (Shared Contract)"]
        DB["@platform/db (Drizzle ORM Connection)"]
        UI["@platform/ui (Shared Component library)"]
        IoT["@platform/iot (MQTT Client Helpers)"]
        Config["@platform/config (Lints & Config presets)"]
    end

    subgraph Infrastructure [Deployment & Routing]
        Docker["Docker Compose (Postgres, Mosquitto)"]
        Nginx["NGINX Proxy Router"]
    end

    %% Dependency mappings
    CMS --> Types
    CMS --> DB
    CMS --> UI
    
    Screens --> Types
    Screens --> UI
    Screens --> IoT

    API --> Types
    API --> DB
    API --> IoT

    DB --> Types
    UI --> Types
    IoT --> Types
```

## Repository Structure

```
├── apps/
│   ├── api/             # Hono Backend, WebSocket & MQTT entry point
│   ├── cms/             # Next.js Admin CMS Dashboard
│   └── screens/         # Next.js Screen Player
├── packages/
│   ├── config/          # Shared eslint and tsconfigs
│   ├── db/              # Drizzle ORM setup location
│   ├── iot/             # MQTT helpers and event normalizers
│   ├── types/           # Shared TypeScript types
│   └── ui/              # Shared UI components
├── infra/
│   ├── docker/          # Compose stacks
│   ├── mosquitto/       # Mosquitto configs
│   ├── nginx/           # Routing and gateway configurations
│   └── scripts/         # Setup scripts
├── package.json         # Workspace root package manifest
├── turbo.json           # Turborepo orchestration config
├── pnpm-workspace.yaml  # Pnpm workspaces schema
└── tsconfig.base.json   # Root base typescript rules
```

## Running the Setup

### Prerequisites
- Node.js v20+
- pnpm v11+
- Docker & Docker Compose

### Get Started
1. Run `pnpm install` in the root of the project to bootstrap all package dependencies.
2. Create your environmental variables: `cp .env.example .env`.
3. Spin up the infrastructure components: `docker compose -f infra/docker/docker-compose.yml up -d`.
4. Run all services in development mode: `pnpm dev`.
5. Build all packages and applications: `pnpm build`.

## Team / Contributor Setup (shared host database)

If a host machine on your LAN is already running the platform (its Postgres holds
the shared data), you can develop against it **without installing or seeding your
own database**. You run the apps locally; only the database lives on the host.

**Prerequisites:** Node 20+, pnpm 9+ (`corepack enable`), and the host's LAN IP +
DB password (ask the host owner — the password is *not* stored in this repo).

```bash
# 1. Clone
git clone https://github.com/vamsi80/cms-platform.git
cd cms-platform

# 2. Create the three env files from the templates
cp .env.team.example          .env
cp apps/cms/.env.example       apps/cms/.env
cp apps/screens/.env.example   apps/screens/.env.local

# 3. Edit ONLY the root .env:
#    - set <HOST_IP>      → e.g. 192.168.1.250
#    - set <DB_PASSWORD>  → the password from the host owner
#    (apps/cms/.env: generate your own BETTER_AUTH_SECRET via `openssl rand -hex 32`)

# 4. Install and run
pnpm install
pnpm dev          # → http://localhost:3000  (CMS),  http://localhost:3001  (Screens)
```

Notes:
- The root `.env` is the single source of `DATABASE_URL` — `@platform/db` loads it
  automatically, so the per-app env files don't repeat the DB connection.
- **Do NOT run** `pnpm db:migrate`, `db:push`, or any seed script — the host owns
  the schema and shared data.
- MQTT is optional in dev; the host doesn't publish the broker on the LAN, so
  IoT/MQTT features stay "unavailable" locally unless you run your own broker.
- **Host owner**, for teammates to reach the DB, open the firewall for Postgres on
  the host (Administrator PowerShell):
  ```powershell
  New-NetFirewallRule -DisplayName "CMS Platform Postgres" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow
  ```
