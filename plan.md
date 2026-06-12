# Plan: cms-platform Local Production-Ready Setup

## Context
The repo is an early-MVP monorepo for a digital signage / CMS / IoT platform. The code
structure, package wiring, and Drizzle schema are all in place. What's missing are the
glue pieces that make the whole stack actually run cleanly on a local Windows PC server:
correct Nginx routing, CORS in the API, env-var discipline, root-level convenience
scripts, and safe Docker Compose files that don't assume Postgres is in Docker.

---

## What Is Already Correct — Do NOT Touch
- pnpm workspace + Turborepo task graph
- `packages/db` Drizzle config, 8-table schema, migration file, `db:*` scripts in its `package.json`
- `packages/db/src/client.ts` DATABASE_URL loading from root `.env`
- All three app ports (cms:3000, screens:3001, api:4000)
- `apps/api` imports `@platform/db` (no duplicated DB logic)
- `apps/api` has `/api/health` with `SELECT 1` DB probe
- `apps/cms` has zero client-side DB imports (uses JSON-file approach)
- `apps/screens` has zero DB imports
- `infra/mosquitto/mosquitto.conf` — ports 1883 + 9001 configured
- `infra/scripts/bootstrap.sh`
- `.gitignore` base entries

---

## Changes Required (10 files, 1 new file)

### 1. `.env.example` — update with all required variables
Replace the file. Key fixes:
- `DATABASE_URL` → references `cms_db` and `cms_app`
- Add: `POSTGRES_HOST/PORT/DB/USER/PASSWORD`, `API_PORT`, `CMS_PORT`, `SCREENS_PORT`,
  `NEXT_PUBLIC_WS_URL`, `MQTT_HOST`, `MQTT_PORT`, `MQTT_WS_PORT`, `UPLOAD_DIR`, `LOG_DIR`
- Keep `NEXT_PUBLIC_WS_GATEWAY_URL` as an alias for backwards compat

### 2. `.gitignore` — append missing entries
Add: `postgres-data/`, `uploads/`, `logs/`, `backups/`, `*.backup`, `*.dump`, `*.sql.gz`
Do NOT add `*.sql` (would ignore tracked migration files in `packages/db/drizzle/`)

### 3. `infra/nginx/nginx.conf` — rewrite for path-based localhost routing
**Critical fix.** Current config uses Docker service names (`cms:3000`) and virtual
hostnames — neither works when Node apps run on Windows.
Replace with a single `server { server_name localhost; }` block:
- `location /api/` → `http://host.docker.internal:4000`
- `location /ws/` → `http://host.docker.internal:4000` + WebSocket upgrade headers
- `location /screens/` → `http://host.docker.internal:3001/` (trailing slash strips prefix)
- `location /` → `http://host.docker.internal:3000`
Add `events { worker_connections 1024; }` block (missing from current file — nginx fails without it)

### 4. `infra/docker/docker-compose.yml` — MODE B (Postgres in Docker)
Fix: credentials from env vars, correct DB name `cms_db`, host bind-mount volume
`../../postgres-data:/var/lib/postgresql/data`, Postgres healthcheck added,
Nginx no longer depends on Postgres.

### 5. `infra/docker/docker-compose.local.yml` — NEW FILE, MODE A (no Postgres)
Primary mode for Windows dev. Contains only `mosquitto` + `nginx`.
Both Docker containers reach Windows-hosted Node apps via `host.docker.internal`.

### 6. `packages/db/src/client.ts` — add `checkDatabaseHealth()` export
Append at bottom of file:
```ts
export async function checkDatabaseHealth(): Promise<boolean> {
  const client = await pool.connect();
  try { await client.query('SELECT 1'); return true; }
  finally { client.release(); }
}
```

### 7. `packages/db/src/index.ts` — re-export health check
Add: `export { checkDatabaseHealth } from "./client.js";`

### 8. `apps/api/src/index.ts` — five targeted edits
a. Import `cors` from `'hono/cors'` (built-in, no new dep)
b. Add `app.use('*', cors({ origin: ['http://localhost:3000','http://localhost:3001'], ... }))`
c. Early guard: if `!process.env['DATABASE_URL']` → log FATAL + `process.exit(1)`
d. MQTT URL: replace hardcoded `'mqtt://localhost:1883'` with
   `process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883'`
e. Extract health JSON logic into `buildHealthPayload()`, replace `/api/health` handler,
   add `/health` alias route (both return identical JSON — no redirects, probe-safe)
f. Update startup banner to show actual URLs and MQTT target

Health response shape (both `/health` and `/api/health`):
```json
{ "status": "ok", "api": "ok", "database": "ok", "timestamp": "..." }
```

### 9. `turbo.json` — add db task definitions
Add `db:generate`, `db:migrate`, `db:push` (all `cache:false`) and
`db:studio` (`cache:false`, `persistent:true`). Prevents "unknown task" errors.

### 10. `package.json` (root) — add missing scripts
```json
"db:generate":  "pnpm --filter @platform/db db:generate",
"db:migrate":   "pnpm --filter @platform/db db:migrate",
"db:push":      "pnpm --filter @platform/db db:push",
"db:studio":    "pnpm --filter @platform/db db:studio",
"infra:up":     "docker compose --env-file .env -f infra/docker/docker-compose.local.yml up -d",
"infra:down":   "docker compose -f infra/docker/docker-compose.local.yml down",
"infra:logs":   "docker compose -f infra/docker/docker-compose.local.yml logs -f",
"healthcheck":  "curl -sf http://localhost:4000/health || echo UNHEALTHY"
```
`infra:*` defaults to MODE A (local.yml). Use docker-compose.yml manually for MODE B.

---

## Execution Order
0. `E:\EC\cms-platform\.claude\plan.md` — copy this plan into the repo
1. `.env.example` + `.gitignore` (no deps)
2. `infra/nginx/nginx.conf` (needed by both compose files)
3. `infra/docker/docker-compose.yml` (update)
4. `infra/docker/docker-compose.local.yml` (create)
5. `packages/db/src/client.ts` → then `packages/db/src/index.ts`
6. `apps/api/src/index.ts` (all 5 edits)
7. `turbo.json` → then `package.json` (root)

---

## Verification

```powershell
# 1. Install & build
pnpm install
pnpm build

# 2. Push DB schema (Postgres must be running on Windows port 5432)
pnpm db:push

# 3. Start infra (Mosquitto + Nginx in Docker)
pnpm infra:up

# 4. Start all apps
pnpm dev

# 5. Test endpoints
curl http://localhost:4000/health          # direct API
curl http://localhost:4000/api/health      # direct API alias
curl http://localhost/api/health           # through Nginx
curl http://localhost/                     # CMS through Nginx

# 6. Port check (PowerShell)
netstat -ano | findstr :3000
netstat -ano | findstr :3001
netstat -ano | findstr :4000
netstat -ano | findstr :5432
netstat -ano | findstr :80

# 7. Root healthcheck script
pnpm healthcheck
```

---

## What Is NOT Changed
- `apps/cms` data flow (JSON-file approach) — architectural change, out of scope
- `apps/screens` — no changes needed
- `packages/iot` placeholder MQTT — out of scope
- `packages/db/drizzle.config.ts` — already correct
- `packages/db/drizzle/0000_tan_tempest.sql` — do not modify
- Individual app `.env` files — root `.env` is sufficient
