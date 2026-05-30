# apps/api/src — API Source Code

> **Contains:** All TypeScript source for the Hono backend.
> Currently a single file. Will grow as routes are split into modules.

---

## What Lives Here

```
apps/api/src/              ← YOU ARE HERE
└── index.ts               → server entry point (the entire API lives here)
```

---

## File: `index.ts` — Line-by-Line Purpose

```
Line 1-4   │ IMPORTS
           │   Hono                  — HTTP router
           │   @hono/node-server     — binds Hono to a Node.js TCP port
           │   MQTTDeviceManager     — from @platform/iot
           │   Screen/Content/Schedule types — from @platform/types

Line 9-39  │ DEMO_SCREENS array
           │   3 hardcoded Screen objects
           │   Used by GET /api/screens until real DB is wired
           │   Types enforced: status must be 'online'|'offline'|'maintenance'

Line 41-69 │ DEMO_CONTENT array
           │   3 hardcoded Content objects (image, video, weather)
           │   Types enforced: type must be 'image'|'video'|'html'|'stream'|'weather'

Line 71-81 │ DEMO_SCHEDULES array
           │   1 schedule with cron: '0 8 * * MON-FRI'

Line 83-85 │ MQTT SETUP
           │   new MQTTDeviceManager('mqtt://localhost:1883')
           │   .connect() ← currently a console.info stub

Line 88-114│ ROUTES
           │   GET  /api/health           ← ping/health check
           │   GET  /api/screens          ← returns DEMO_SCREENS
           │   GET  /api/content          ← returns DEMO_CONTENT
           │   GET  /api/schedules        ← returns DEMO_SCHEDULES
           │   POST /api/rules/evaluate   ← rule engine placeholder

Line 116-161│ BOOTSTRAP (serve callback)
           │   binds to PORT env var (default 4000)
           │   prints startup banner with demo data summary
           │   prints screen statuses: 🟢 online / 🔴 offline / 🟡 maintenance
```

---

## Data Flow Through This File

```
[Startup]
  index.ts loads
    ├── DEMO arrays built in memory
    ├── MQTTDeviceManager initialized (stub connect)
    └── Hono app + server bound to :4000

[Runtime — REST]
  Incoming HTTP request
    ▼
  Hono router matches path
    ▼
  Handler function runs
    ├── reads from DEMO array (current)
    └── reads from @platform/db (future)
    ▼
  c.json(response) sent back to caller

[Runtime — MQTT, future]
  IoT message arrives on topic
    ▼
  MQTTDeviceManager.on('message')
    ▼
  normalizeTelemetry() or normalizeEvent()
    ▼
  Rule Engine evaluates
    ▼
  WebSocket broadcast to apps/screens
```

---

## What Gets Added Here in Future

```
src/
├── index.ts          ← stays as entry point + server bootstrap
├── routes/
│   ├── screens.ts    ← GET/POST/PATCH /api/screens
│   ├── content.ts    ← GET/POST /api/content
│   ├── playlists.ts  ← GET/POST /api/playlists
│   ├── schedules.ts  ← GET/POST /api/schedules
│   └── rules.ts      ← GET/POST /api/rules + evaluation
├── mqtt/
│   ├── subscriber.ts ← real MQTT subscription + message routing
│   └── publisher.ts  ← command publishing to devices
├── ws/
│   └── gateway.ts    ← WebSocket server + connection management
└── rules/
    └── engine.ts     ← rule evaluation logic
```

---

## Connects To

| Import | From | Used for |
|---|---|---|
| `MQTTDeviceManager` | `packages/iot/src/index.ts` | MQTT broker connection |
| `Screen`, `Content`, `Schedule` | `packages/types/src/index.ts` | Type-safe demo data |
| `serve` | `@hono/node-server` | Binds Hono to Node.js port |
