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

## Full Data Flow (One Sentence Per Step)

1. **Admin** opens browser → hits Nginx → forwarded to `apps/cms` (:3000)
2. **CMS page** calls `GET http://localhost:4000/api/screens` → `apps/api` responds with screen list
3. **API** reads that data from PostgreSQL via `packages/db` → returns JSON
4. **IoT sensor** publishes MQTT to Mosquitto `:1883` → `packages/iot` in `apps/api` receives it
5. **Rule engine** in `apps/api` evaluates the event → decides to change content
6. **WebSocket** push from `apps/api` → `apps/screens` receives it → switches playlist instantly
7. **Screen** player renders new content full-screen on the physical display

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
