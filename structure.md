# cms-platform — Root Structure

> **Event-Driven Digital Signage + CMS + IoT Platform**
> Stack: `pnpm` · `Turborepo` · `TypeScript` · `Next.js` · `Hono` · `MQTT` · `Drizzle ORM`

---

## What Lives Here

```
cms-platform/                 ← YOU ARE HERE
│
├── apps/                     → 3 runnable applications (servers)
├── packages/                 → 5 shared libraries (code shared between apps)
├── infra/                    → infrastructure configs (Docker, Nginx, MQTT, scripts)
│
├── package.json              → root workspace manifest + shared dev scripts
├── pnpm-workspace.yaml       → tells pnpm which folders are workspaces
├── turbo.json                → Turborepo build pipeline + task ordering
├── tsconfig.base.json        → strict TypeScript rules shared by ALL packages
├── .env.example              → template for all environment variables
├── .gitignore                → what git should never track
└── README.md                 → quick-start guide
```

---

## How the 3 Layers Connect

```
┌─────────────────────────────────────────────────────┐
│  apps/          (consume packages, talk to infra)   │
│    api  ──────► packages/iot, packages/db           │
│    cms  ──────► packages/ui, packages/db            │
│    screens ───► packages/ui, packages/iot           │
└─────────────────────────────────────────────────────┘
          │ imports from
          ▼
┌─────────────────────────────────────────────────────┐
│  packages/      (shared code, no servers)           │
│    types ─────► used by ALL other packages + apps   │
│    db    ─────► wraps PostgreSQL via Drizzle ORM    │
│    iot   ─────► wraps Mosquitto MQTT client         │
│    ui    ─────► shared React components             │
│    config ────► shared ESLint + TypeScript configs  │
└─────────────────────────────────────────────────────┘
          │ runs on
          ▼
┌─────────────────────────────────────────────────────┐
│  infra/         (Docker services, not Node.js)      │
│    docker    ─► PostgreSQL :5432 + Mosquitto :1883  │
│    nginx     ─► routes :80 → cms/screens/api ports  │
│    mosquitto ─► MQTT broker config                  │
│    scripts   ─► bootstrap + deploy helpers          │
└─────────────────────────────────────────────────────┘
```

---

## Core Concepts

- **Screen** — a physical display. One DB row (`screen` table), one display URL `…/display/<screenId>`
  (controlled from the CMS at `…/screens/<screenId>`), one assigned piece of content. Many screens run independently.
- **Experience** — a unit of content backed by a **code-defined template** (`portfolio`,
  `live-stream`). Per-experience content lives in `experience.templateContent` (JSONB).
- **Live Stream** — a template whose picture is pushed live from an external publisher
  (Unity/AR glasses) over the WebSocket gateway and decoded on the screen in real time.

## Full Data Flow (One Sentence Per Step)

1. **Admin** opens the CMS through Nginx (`/` → `apps/cms`) and assigns an experience to a screen.
2. **CMS server action** writes the assignment to PostgreSQL via `@platform/db` (source of truth),
   then `POST`s the derived content to `apps/api` `/api/internal/broadcast` (with `BROADCAST_SECRET`).
3. **API WebSocket hub** (`apps/api/src/ws/gateway.ts`) fans the update out to that screen's room
   as `CONTENT_UPDATE` and notifies CMS tabs as `SCREEN_UPDATED`.
4. **Screen player** (`apps/screens` `[screenId]`) receives it over its WebSocket and renders the
   new experience/template full-screen — sub-10ms, no reload.
5. **Live streams:** a publisher sends `STREAM_PUBLISH` + binary video frames over `/ws/`; the
   gateway relays them to every screen showing that `streamId`, which decodes (WebCodecs/MJPEG).
6. **IoT (secondary):** devices publish telemetry to Mosquitto `:1883`; `@platform/iot` inside
   `apps/api` consumes it (device status / future rule-driven content changes).

---

## Ports at a Glance

| Service | Port | Who runs it |
|---|---|---|
| `apps/cms` | 3000 | Node.js / Next.js |
| `apps/screens` | 3001 | Node.js / Next.js |
| `apps/api` | 4000 | Node.js / Hono |
| PostgreSQL | 5432 | Docker |
| Mosquitto MQTT | 1883 | Docker |
| Mosquitto WS | 9001 | Docker |
| Nginx | 80 | Docker |

---

## Commands

```bash
pnpm install          # install all workspace deps
pnpm dev              # start all 3 servers in parallel
pnpm build            # build all packages in dependency order
pnpm typecheck        # type-check the entire monorepo
```

---

## Go Deeper → Read `structure.md` Inside Each Folder

- [`apps/structure.md`](./apps/structure.md)
- [`packages/structure.md`](./packages/structure.md)
- [`infra/structure.md`](./infra/structure.md)
