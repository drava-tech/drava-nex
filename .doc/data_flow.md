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

## 4. Live Interface Pushes (WebSocket — planned)

Endpoint: `ws://localhost/ws` (through Nginx) → `api:4000`

1. API dispatches a WebSocket command when content update rules trigger
2. Screen player receives the JSON message in real-time
3. React re-renders the screen layout without a page refresh

WebSocket upgrade is configured in Nginx (`proxy_read_timeout 3600s`). Implementation in `apps/api` is currently a placeholder.

---

## 5. CMS → Screen Config (current interim approach)

While the full API integration is being built, the CMS writes config directly to JSON files:
- `apps/cms/src/actions/` — Next.js Server Actions write to `apps/screens/public/config/`
- Screens reads `screens.json` and `contents.json` on load

This will be replaced by API calls once the CMS→API wiring phase is complete.

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
