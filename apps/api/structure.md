# apps/api — Hono API Gateway

> **Package name:** `@platform/api`
> **Port:** `4000`
> **Protocols:** HTTP REST · WebSocket · MQTT (consumer + publisher)

---

## What Lives Here

```
apps/api/                  ← YOU ARE HERE
├── src/
│   └── index.ts           → ONLY source file — does everything
├── package.json           → dependencies + npm scripts
└── tsconfig.json          → TypeScript config (extends root base)
```

---

## What This App Does

This is the **central nervous system** of the platform.

```
                 ┌─────────────────────────────────────┐
                 │           apps/api :4000            │
                 │                                     │
  CMS dashboard ─┼─► GET /api/screens                  │
  Screen Player ─┼─► GET /api/screens/{id}/playlist    │
                 │                                     │
  IoT Sensor ────┼─► MQTT → MQTTDeviceManager          │
  (via Mosquitto)│         normalizeTelemetry()        │
                 │         normalizeEvent()             │
                 │         → Rule Engine evaluates     │
                 │         → WebSocket push to screens │
                 └─────────────────────────────────────┘
```

---

## File: `src/index.ts`

**Entry point — runs on `pnpm dev` or `node dist/index.js`**

| Section | What it does |
|---|---|
| Imports | Loads Hono, @hono/node-server, MQTTDeviceManager, type contracts |
| DEMO_SCREENS | In-memory array of 3 screen objects (replaces DB until wired) |
| DEMO_CONTENT | In-memory array of 3 content items |
| DEMO_SCHEDULES | In-memory array of 1 schedule |
| MQTT Setup | `new MQTTDeviceManager('mqtt://localhost:1883').connect()` |
| Routes | Registers 5 HTTP routes (see below) |
| `serve()` | Binds to PORT (default 4000), prints startup banner |

**HTTP Routes:**

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ status, timestamp, version }` |
| GET | `/api/screens` | Array of all screens |
| GET | `/api/content` | Array of all content items |
| GET | `/api/schedules` | Array of all schedules |
| POST | `/api/rules/evaluate` | Rule engine entry point (placeholder) |

**Data flow in `index.ts`:**

```
HTTP request arrives
    │
    ▼ Hono router matches path
    │
    ▼ Handler reads DEMO_* array (now) or @platform/db query (future)
    │
    ▼ c.json({ data })  →  HTTP response
```

**MQTT data flow (current vs future):**

```
CURRENT:
  mqttManager.connect()
    └── console.info("Connecting...") ← stub only, no real TCP

FUTURE:
  mqttManager.connect()
    └── mqtt.connect(brokerUrl)               ← opens real TCP socket
    └── client.subscribe('platform/+/telemetry')
    └── client.on('message', (topic, payload) => {
          const event = normalizeEvent(payload)  ← @platform/iot
          evaluateRule(event)                    ← rule engine
          wsServer.broadcast(screenId, cmd)      ← push to screens
        })
```

---

## File: `package.json`

```
name:    @platform/api
type:    module  (ESM — uses import/export, not require)
scripts:
  dev       → tsx watch src/index.ts   (hot-reload, no compile step)
  build     → tsc                      (compiles src/ → dist/)
  start     → node dist/index.js       (production run)
  typecheck → tsc --noEmit             (validate types only)
```

**Key dependencies:**

| Package | Why it's here |
|---|---|
| `hono` | HTTP routing framework |
| `@hono/node-server` | Wraps Hono's fetch handler into a Node.js TCP server |
| `tsx` | Runs TypeScript directly in dev mode |
| `@platform/types` | Type contracts for all request/response shapes |
| `@platform/db` | Future: read/write to PostgreSQL |
| `@platform/iot` | `MQTTDeviceManager` class for broker connection |

---

## File: `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",   ← compiled JS goes here
    "rootDir": "./src"    ← source TypeScript lives here
  },
  "include": ["src/**/*"]
}
```

TypeScript compiles `src/index.ts` → `dist/index.js`.
Production command `node dist/index.js` runs the compiled output.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → reads from | `packages/iot` | imports `MQTTDeviceManager` |
| → reads from | `packages/db` | imports `dbClient` / `schema` |
| → reads from | `packages/types` | imports all type contracts |
| ← called by | `apps/cms` | HTTP REST (fetch) |
| ← called by | `apps/screens` | HTTP REST + WebSocket |
| ← receives from | Mosquitto `:1883` | MQTT messages |
| → publishes to | Mosquitto `:1883` | Device commands |
