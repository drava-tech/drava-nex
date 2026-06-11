# Tech Stack & Libraries Used

This document details the core technologies, libraries, and frameworks utilized across the CMS platform.

---

## 1. Core Language & Build Runtime
* **Node.js**: The Javascript runtime executing the servers and build commands.
* **TypeScript**: Strict compile-time type-safety implemented workspace-wide using the shared base rules in `tsconfig.base.json`.
* **pnpm Workspaces**: Package manager orchestrating dependency resolution and symlinking across local packages.
* **Turborepo**: Build system caching tasks and managing pipeline build/execution order.

---

## 2. Database & Data Mapping
* **PostgreSQL (v18)**: Relational database storing all schemas and records (screens, templates, experiences, content, rules).
* **Drizzle ORM**: TypeScript-first Object-Relational Mapper providing compile-time safe database queries, schemas, and relations.
* **drizzle-kit**: Companion CLI tool managing schema introspection, migrations generation, and database updates.
* **pg (node-postgres)**: PostgreSQL client driver powering the query connection pool.

---

## 3. Applications & Gateways
* **Hono**: Ultrafast lightweight web framework running the REST API server and WebSocket endpoint inside `apps/api`.
* **Next.js (v15)**: Full-stack React framework running:
  - **`apps/cms`**: The admin control dashboard.
  - **`apps/screens`**: The edge device player.
* **@hono/node-server**: Adapter to host Hono apps inside standard Node runtimes.

---

## 4. Message Broker & IoT Integration
* **Mosquitto (Eclipse)**: Light message broker using the **MQTT** protocol to send/receive real-time telemetry from edge displays.
* **mqtt**: Node client connecting `apps/api` to Mosquitto.

---

## 5. Reverse Proxy & Networking
* **NGINX**: Reverse proxy routing external web traffic to corresponding application ports.
