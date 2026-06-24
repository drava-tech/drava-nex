# apps/api/src — API Source Code

> **Contains:** the Hono REST API, the WebSocket gateway, and the MQTT consumer.

---

## What Lives Here

```
apps/api/src/
├── index.ts            → server entry: env load, Hono routes, MQTT, HTTP+WS bootstrap
├── ws/
│   └── gateway.ts      → WebSocket hub — per-screen rooms, broadcast, live-stream relay
└── middleware/
    └── auth.ts         → requireAuth (validates the session for protected routes)
```

---

## `index.ts` — what it does

- Loads `DATABASE_URL` etc. from the root `.env` (crawls upward) and **exits** if it's missing.
- Configures CORS from `CORS_ENV`/`CORS_ORIGIN`.
- Starts the MQTT consumer: `new MQTTDeviceManager(MQTT_BROKER_URL).connect()` (`@platform/iot`).
- Registers REST routes, then creates a single Node HTTP server (`@hono/node-server`
  `createAdaptorServer`) and attaches the WebSocket gateway via an `upgrade` handler for `/ws`.

**REST routes:**

| Method · Path | Purpose |
|---|---|
| `GET /health`, `/api/health` | DB (`SELECT 1`) + MQTT status |
| `GET /api/me` | current session user (protected) |
| `GET /api/projects`, `/api/experiences` | experiences list |
| `GET /api/screens` | all screens (with their assigned content) |
| `GET /api/screens/active` | screenIds currently connected over WS |
| `GET /api/screens/:screenId/config` | a screen's current content (DB-authoritative) |
| `POST /api/internal/broadcast` | CMS→screens content push (guarded by `BROADCAST_SECRET`) |
| `POST /api/internal/command` | CMS→screen remote command (mute, reload, …) |
| `GET /ws/` | returns `426 Upgrade Required` (real clients send an upgrade) |

---

## `ws/gateway.ts` — the real-time hub

In-memory registries: `screenRegistry` (per-screen socket rooms), `cmsRegistry` (admin tabs),
`contentCache` (last content per screen), plus `streamPublishers` / `streamSubscribers` /
`streamCache` for live streams.

```
Screen  → REGISTER {screenId}              → joins room → WELCOME {content}
CMS tab → CMS_REGISTER                     → SCREEN_UPDATED + ACTIVE_SCREENS_LIST
broadcast(req)  (from /api/internal/broadcast) → CONTENT_UPDATE to the screen's room
Publisher → STREAM_PUBLISH {streamId,format} then BINARY frames
          → relayed to that stream's subscribers; STREAM_STATUS {active} emitted
```

Binary messages are media frames (never JSON-parsed); text messages are control JSON. A 30s
`PING`/`PONG` heartbeat prunes dead sockets.

---

## Connects To

| Import | From | Used for |
|---|---|---|
| `MQTTDeviceManager` | `@platform/iot` | MQTT broker connection |
| `db`, `getScreenContent`, `setScreenExperience`, … | `@platform/db` | DB reads/writes |
| `Ws*Message`, `WsContent`, `StreamFormat`, `BroadcastRequest` | `@platform/types` | wire contracts |
| `createAdaptorServer` | `@hono/node-server` | one HTTP server for REST + WS upgrade |
| `WebSocketServer` | `ws` | the WebSocket gateway |
