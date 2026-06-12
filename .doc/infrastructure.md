# Infrastructure & Docker Setup

This document describes the full containerised deployment of the platform — how to build, start, and manage all services.

---

## 1. Service Inventory

Six Docker services defined in `infra/docker/docker-compose.yml`:

| Container | Image | Internal port | Host port |
|---|---|---|---|
| `cms-postgres` | `postgres:16-alpine` | `5432` | none — internal only |
| `cms-mosquitto` | `eclipse-mosquitto:2` | `1883`, `9001` | none — internal only |
| `cms-api` | built from `apps/api/Dockerfile` | `4000` | none — internal only |
| `cms-admin` | built from `apps/cms/Dockerfile` | `3000` | none — internal only |
| `cms-screens` | built from `apps/screens/Dockerfile` | `3001` | none — internal only |
| `cms-nginx` | `nginx:alpine` | `80` | **`80:80`** (sole public port) |

---

## 2. Startup Sequence

Services start in dependency order:
1. `postgres` starts first, with a `pg_isready` healthcheck
2. `mosquitto` starts in parallel with postgres
3. `api` waits for `postgres: service_healthy` and `mosquitto: service_started`
4. `cms` and `screens` wait for `api: service_started`
5. `nginx` waits for `cms`, `screens`, `api` all started

---

## 3. Management Scripts (root `package.json`)

```powershell
pnpm infra:build    # Build all three custom Docker images
pnpm infra:up       # Start all containers in detached mode
pnpm infra:down     # Stop and remove containers (data volumes preserved)
pnpm infra:logs     # Tail logs from all containers
pnpm infra:restart  # Restart all containers
pnpm healthcheck    # curl http://localhost/health
```

---

## 4. Dockerfiles

All three app Dockerfiles share the same two-stage pattern:

**Stage 1 — `builder`:**
1. Install pnpm via corepack
2. Copy all workspace `package.json` manifests (layer-cache friendly)
3. `pnpm install --frozen-lockfile`
4. Copy source files
5. `pnpm exec turbo run build --filter="@platform/<app>..."` (builds app + all workspace deps it needs)

**Stage 2 — `runner`:**
- **API:** Full workspace copy so `pnpm --filter @platform/db db:push` works inside the container for migrations
- **CMS / Screens:** Uses Next.js standalone output — copies only `/.next/standalone`, `/.next/static`, `/public`; no pnpm needed at runtime

`NEXT_PUBLIC_*` environment variables are injected via `ARG → ENV` in the CMS/Screens builder stage — they are baked in at image build time.

---

## 5. Persistent Data Directories

All persistent data lives outside the source repo at `E:\EC\cms-platform-data\`:

| Path | Purpose |
|---|---|
| `postgres-data/` | PostgreSQL data files (bind-mounted) |
| `mosquitto-data/` | MQTT message persistence |
| `uploads/` | User-uploaded files served by the API |
| `logs/` | App and Nginx access/error logs |
| `logs/mosquitto/` | Mosquitto log files |
| `logs/nginx/` | Nginx access/error logs |

These directories are created automatically by Docker on first run.

---

## 6. First-Boot Sequence

```powershell
# 1. Copy and fill in secrets
copy .env.example .env
notepad .env   # set POSTGRES_PASSWORD and update DATABASE_URL

# 2. Build images (~10-15 min first time)
pnpm infra:build

# 3. Start all services
pnpm infra:up

# 4. Push DB schema (first boot only — creates all 8 tables)
docker exec cms-api sh -c "pnpm --filter @platform/db db:push"

# 5. Verify
curl http://localhost/health
# Expected: {"status":"ok","api":"ok","database":"ok","mqtt":"ok",...}
```

---

## 7. Useful Operational Commands

```powershell
# See all running containers
docker ps

# Live logs for a single service
docker logs -f cms-api
docker logs -f cms-nginx

# Open a shell inside a container
docker exec -it cms-api sh
docker exec -it cms-postgres sh

# Connect to PostgreSQL (internal access only)
docker exec -it cms-postgres psql -U cms_app -d cms_db

# Rebuild a single service after code changes
docker compose -f infra/docker/docker-compose.yml build api
docker compose -f infra/docker/docker-compose.yml up -d --no-deps api

# Confirm port 5432 is NOT bound to host (security check)
netstat -ano | findstr :5432
# Should return nothing for 0.0.0.0:5432
```

---

## 8. Nginx Configuration Files

Two configs exist — use the correct one for each mode:

| File | Mode | Upstream addresses |
|---|---|---|
| `infra/nginx/default.conf` | Docker (all services in containers) | Docker service names: `api:4000`, `cms:3000`, `screens:3001` |
| `infra/nginx/nginx.conf` | Local dev (apps on Windows, only Nginx in Docker) | `host.docker.internal:4000/3000/3001` |

In Docker mode, `default.conf` is bind-mounted over the default Nginx config location.
