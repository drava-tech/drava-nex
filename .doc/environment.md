# Environment Variables Reference

All configuration lives in a single `.env` file at the repo root (`e:\EC\cms-platform\.env`).

This file is **gitignored** — it must never be committed. Copy `.env.example` to create it.

---

## 1. Complete Variable Reference

### Node Environment
| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set to `development` for local dev runs |

### PostgreSQL
| Variable | Example | Notes |
|---|---|---|
| `POSTGRES_DB` | `cms_db` | Database name read by postgres container on first init |
| `POSTGRES_USER` | `cms_app` | Application database user |
| `POSTGRES_PASSWORD` | `CHANGE_ME` | Must be changed before first boot |
| `DATABASE_URL` | `postgresql://cms_app:CHANGE_ME@postgres:5432/cms_db` | Docker mode uses `postgres` service name; local dev uses `localhost` |

### Application Ports (used by compose if building without Nginx)
| Variable | Default | Notes |
|---|---|---|
| `API_PORT` | `4000` | Hono server listen port |
| `CMS_PORT` | `3000` | Next.js CMS listen port |
| `SCREENS_PORT` | `3001` | Next.js Screens listen port |

### Next.js Public URLs (baked in at build time)
| Variable | Docker value | Local dev value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost/api` | `http://localhost:4000/api` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost/ws` | `ws://localhost:4000/ws` |
| `NEXT_PUBLIC_WS_GATEWAY_URL` | `ws://localhost/ws` | `ws://localhost:4000/ws` |

These are `NEXT_PUBLIC_*` variables — they are embedded into the JavaScript bundle at `docker compose build` time. Changing them after build requires a rebuild.

### MQTT Broker
| Variable | Docker value | Local dev value |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://mosquitto:1883` | `mqtt://localhost:1883` |
| `MQTT_HOST` | `mosquitto` | `localhost` |
| `MQTT_PORT` | `1883` | `1883` |
| `MQTT_WS_PORT` | `9001` | `9001` |

### Screen Player
| Variable | Example | Notes |
|---|---|---|
| `SCREEN_ID` | `screen_experience_center_01` | Unique identifier for the screen instance |

### File Storage
| Variable | Value | Notes |
|---|---|---|
| `UPLOAD_DIR` | `/data/uploads` | Container path — bind-mounted from `E:\EC\cms-platform-data\uploads` |
| `LOG_DIR` | `/data/logs` | Container path — bind-mounted from `E:\EC\cms-platform-data\logs` |

---

## 2. Docker vs Local Dev: What Changes

When running **fully in Docker** (the standard production mode):
- `DATABASE_URL` — host is `postgres` (Docker service name)
- `MQTT_BROKER_URL` — host is `mosquitto` (Docker service name)
- `NEXT_PUBLIC_*` — use Nginx-relative paths (`/api`, `/ws`) — same for any domain

When running **local dev** (apps run on Windows, no Docker for app services):
- `DATABASE_URL` — change `postgres` to `localhost`
- `MQTT_BROKER_URL` — change `mosquitto` to `localhost`
- `NEXT_PUBLIC_*` — change to `http://localhost:4000/api` etc.

---

## 3. How Variables Are Injected

- **Docker Compose services** — all use `env_file: ../../.env` in `docker-compose.yml`
- **Next.js build-time vars** — `ARG NEXT_PUBLIC_API_URL` → `ENV NEXT_PUBLIC_API_URL=...` in Dockerfiles
- **Local dev** — the `packages/db` client auto-crawls up to the repo root `.env` as a fallback if `DATABASE_URL` is not set in the process environment

---

## 4. Security Rules

- Never commit `.env` — it is in `.gitignore`
- Never put real passwords in `.env.example` — use `CHANGE_ME` placeholders
- PostgreSQL port `5432` is never bound to the host — only accessible inside Docker via `postgres:5432`
- MQTT ports `1883` and `9001` are never bound to the host — Docker internal only
