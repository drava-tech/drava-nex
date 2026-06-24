# Data Flow & Communication Mechanisms

This document describes how data is requested, fetched, and pushed throughout the platform layers.

---

## 1. REST API Requests (Next.js → Hono)

- **Browser calls** use Nginx-relative paths: `fetch('/api/screens')` → Nginx routes to `api:4000`
- **Server-side calls** (Next.js Server Actions) use direct container address: `http://api:4000/api/screens`
- The Hono router (`apps/api/src/index.ts`) handles the path and returns structured JSON

---

## 2. Database Queries (Hono → PostgreSQL via Drizzle)

Only `apps/api` imports `@platform/db` — CMS and Screens never touch the database directly.

```typescript
import { db, screens } from '@platform/db';
const result = await db.select().from(screens);
```

Flow:
1. Drizzle converts the query to native PostgreSQL SQL
2. `pg` pool sends it to `postgres:5432` (Docker) or `localhost:5432` (local dev)
3. PostgreSQL returns rows; Drizzle maps them back to TypeScript objects

---

## 3. Real-Time Telemetry (MQTT)

IoT sensors and edge displays publish to Mosquitto on topic-based channels:

1. Device publishes to `mqtt://mosquitto:1883` on topic e.g. `device/screen-001/telemetry`
2. `apps/api` (via `@platform/iot` — `MQTTDeviceManager`) is subscribed to relevant topics
3. Mosquitto forwards payload to the API gateway
4. API parses the event and evaluates rules

`MQTT_BROKER_URL=mqtt://mosquitto:1883` in Docker, `mqtt://localhost:1883` in local dev.

---

## 4. Real-Time CMS ↔ Screen Sync (WebSocket — implemented)

The WebSocket hub lives in `apps/api/src/ws/gateway.ts`. Endpoint: `ws://<host>/ws/`
(through Nginx) → `api:4000`. It keeps in-memory registries: **per-screen rooms**
(`screenRegistry`), **CMS browser clients** (`cmsRegistry`), and a last-content cache.

Message types (`@platform/types`): server→client `WELCOME` / `CONTENT_UPDATE` / `PING` /
`SCREEN_COMMAND`; client→server `REGISTER` / `CMS_REGISTER` / `CONTENT_CHANGE_REQUEST` /
`SCREEN_INTERACTION` / `PONG`; CMS `SCREEN_UPDATED` / `ACTIVE_SCREENS_LIST`.

1. A screen connects and sends `REGISTER {screenId}` → joins its room → gets `WELCOME`
   with current content (from cache, else read from the DB).
2. A CMS tab sends `CMS_REGISTER` → receives live `SCREEN_UPDATED` + online-screen lists.
3. On (re)connect the screen also re-fetches `/api/config/<screenId>` to converge on the
   authoritative DB content (covers missed broadcasts / API restarts).

## 5. CMS → Screen Content Push (Postgres is the source of truth)

The old `screens.json` / `contents.json` flat-file flow is **gone**. Flow now:

1. CMS server action (`apps/cms/src/actions/screen-actions.ts` → `assignExperience` /
   `assignMedia`) writes the assignment to PostgreSQL (`setScreenExperience`), the source of truth.
2. It derives the content (`getScreenContent`) and calls `broadcastWsContentDirect`
   (`apps/cms/src/lib/broadcast.ts`) → `POST http://api:4000/api/internal/broadcast` with the
   shared `x-broadcast-secret` (`BROADCAST_SECRET`).
3. The API `broadcast()` pushes `CONTENT_UPDATE` to the screen's room and `SCREEN_UPDATED` to
   CMS tabs. A touch-screen pick takes the reverse path (`CONTENT_CHANGE_REQUEST`).

## 5b. Live-Stream Binary Relay

The `live-stream` template streams video over the *same* WebSocket:
1. A publisher (Unity/AR-glasses app) connects to `/ws/`, sends a JSON
   `STREAM_PUBLISH {streamId, format}`, then pushes **binary** frames
   (`[type:1B][timestamp:8B][payload]` — H.264 NAL units or JPEG).
2. The gateway relays frames to every screen subscribed to that `streamId` and caches the
   config + last keyframe so late joiners start instantly; it emits `STREAM_STATUS {active}`.
3. The screen (`@platform/ui` `use-live-stream.ts`) decodes via **WebCodecs (H.264)** or
   `createImageBitmap` **(MJPEG)** and paints to a `<canvas>`. Video never touches the DB/HTTP.

---

## 6. Health Check Flow

`GET /health` and `GET /api/health` both return:

```json
{
  "status": "ok",
  "api": "ok",
  "database": "ok",
  "mqtt": "ok",
  "timestamp": "2026-..."
}
```

The `buildHealthPayload()` function in `apps/api/src/index.ts` runs `SELECT 1` via Drizzle and checks `mqttManager.isConnected()`.
