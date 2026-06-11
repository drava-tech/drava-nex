# Database Layer & Connection Setup

This document details the architecture of the database package, schema definitions, and migration workflows.

---

## 1. Database Client Package (`@platform/db`)
The database connection pool and client are wrapped inside the shared workspace package `packages/db`.

* **Connection Pool:** Uses the `pg` Pool client. It dynamically manages multiple simultaneous queries and releases connections back to the database.
* **Environment Resolution:** The connection string is resolved dynamically by reading the root workspace `.env` file via an automatic filesystem path crawler. If `DATABASE_URL` isn't preset in the shell, it locates:
  ```
  e:\EC\cms-platform\.env
  ```
  and loads the credentials.

---

## 2. Drizzle Schema & Table Layout
The database schemas are split into individual TypeScript files in `packages/db/src/schema/`:
* **`screens.ts`**: Displays metadata, connectivity states, and registered codes.
* **`templates.ts`**: Layout skeletons and component configuration.
* **`experiences.ts`**: The active templates that screens are displaying.
* **`contents.ts`**: Asset properties, raw settings data, and layout specs.
* **`screenAssignments.ts`**: Maps screens to content playlists.
* **`devices.ts`**: IoT sensor information and MQTT telemetry routes.
* **`rules.ts`**: Automated rule conditions and actions.
* **`assets.ts`**: File URLs and properties linked to content objects.

---

## 3. Configuration & Migration Setup
* **`drizzle.config.ts`**: Controls Drizzle Kit's migration settings:
  - **dialect**: `postgresql`
  - **schema**: Points to the compiled TypeScript schema outputs: `./dist/schema/index.js`
  - **out**: Folder where SQL files are written: `./drizzle`
* **Workflow:**
  1. Add/modify TypeScript tables in `packages/db/src/schema/`.
  2. Compile the database package using `pnpm build`.
  3. Generate the SQL script by running `pnpm --filter @platform/db db:generate`.
  4. Push the SQL statements to Postgres by running `pnpm --filter @platform/db db:migrate`.
