# Data Flow & Communication Mechanisms

This document describes how data is requested, fetched, and pushed throughout the platform layers.

---

## 1. REST API Requests (Next.js ⇄ Hono)
* **How it is called:** The admin dashboard (`apps/cms`) and screen player (`apps/screens`) make HTTP client calls to Hono backend endpoints.
* **Flow:**
  1. Frontend sends standard `fetch` call to `http://localhost:4000/api/screens` (or relative routes routed by Nginx).
  2. The Hono router (`apps/api/src/index.ts`) intercepts the path and executes the handler.
  3. API responds with structured JSON payload.

---

## 2. Database Queries (Hono ⇄ Postgres via Drizzle)
* **How it is called:** The API backend loads the shared `@platform/db` pool connection client.
* **Flow:**
  1. Hono initiates a query using Drizzle select statements:
     ```typescript
     import { db, screens } from '@platform/db';
     const result = await db.select().from(screens);
     ```
  2. Drizzle ORM converts this query to native PostgreSQL statements.
  3. The `pg` client execution pool sends the query on port `5432` to the running Postgres database.
  4. PostgreSQL responds with raw rows, which Drizzle compiles back into structured TypeScript objects.

---

## 3. Real-Time Telemetry and Messages (MQTT)
* **How it is called:** IoT sensors and Edge displays broadcast topic-based messages via MQTT.
* **Flow:**
  1. An IoT device publishes a payload to the broker (`mqtt://localhost:1883`) on a specific topic (e.g. `device/screen-001/telemetry`).
  2. The MQTT Client inside `apps/api` (wrapped in `@platform/iot`) is permanently subscribed to relevant topics.
  3. When Mosquitto receives a payload, it broadcasts it to the API gateway client.
  4. The gateway parses the event and executes local rules.

---

## 4. Live Interface Pushes (WebSocket)
* **How it is called:** The Hono API pushes instant commands to the Next.js screen players.
* **Flow:**
  1. When a content update trigger evaluates to true, Hono dispatches a WebSocket command.
  2. The connected Screen Player (`apps/screens`) receives the JSON message in real-time.
  3. React updates the screen layout instantly without requiring a page refresh.
