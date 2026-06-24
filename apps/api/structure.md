# apps/api — Hono API + Realtime Gateway

> **Package name:** `@platform/api`
> **Port:** `4000` (internal; reached through Nginx at `/api` and `/ws`)
> **Protocols:** HTTP REST · WebSocket (content sync + live-stream relay) · MQTT consumer

---

## What Lives Here

```
apps/api/
├── src/
│   ├── index.ts          → REST routes + bootstrap (HTTP + WS server)
│   ├── ws/gateway.ts     → WebSocket hub (rooms, broadcast, stream relay)
│   └── middleware/auth.ts→ requireAuth session guard
├── Dockerfile            → two-stage build; runner keeps the workspace (for db:push)
├── package.json
└── tsconfig.json
```

See [`src/structure.md`](./src/structure.md) for the route table and gateway details.

---

## What This App Does

The platform's backend and **real-time hub**:

```
            ┌──────────────────────────────────────────────┐
            │                apps/api :4000                │
 CMS  ──────┼─► REST /api/* (experiences, screens, media)  │
            │   POST /api/internal/broadcast ──┐           │
 Screens ───┼─► REST /api/screens/:id/config   │           │
            │                                  ▼           │
 Publisher ─┼─► WS /ws  (STREAM_PUBLISH + binary frames)   │
            │        WS gateway: per-screen rooms,         │
            │        CONTENT_UPDATE push, stream relay ────┼─► Screens
 Devices ───┼─► MQTT (mosquitto:1883) → MQTTDeviceManager  │
            └──────────────────────────────────────────────┘
```

Postgres (via `@platform/db`) is the source of truth; the CMS triggers pushes, the gateway
delivers them. Only `apps/api` touches the database.

---

## Scripts

```
dev       → tsx watch src/index.ts
build     → tsc            (src/ → dist/)
start     → node dist/index.js
typecheck → tsc --noEmit
```

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → reads/writes | `@platform/db` | Postgres queries (the only app that does) |
| → consumes | Mosquitto `:1883` | MQTT device telemetry via `@platform/iot` |
| → imports | `@platform/types` | `Ws*Message`, `WsContent`, `BroadcastRequest` |
| ← called by | `apps/cms` | REST + `POST /api/internal/broadcast` (server-side) |
| ← connected by | `apps/screens` + stream publishers | WebSocket `/ws` |
| ← traffic from | Nginx `:80` | `/api/*`, `/health`, `/ws`, `/ws/` → `api:4000` |
