# Networking, Ports & Routing Architecture

This document maps the network ports, Docker network topology, and proxy configurations across all platform services.

---

## 1. Port Registry

| Service | Port | Exposed to host | Context |
|---|---|---|---|
| **Nginx** | `80` | Yes — sole public **web** entry | All HTTP/WS traffic (CMS, screens, API, gateway) |
| **CMS (Next.js)** | `3000` | No — internal only | Admin dashboard |
| **Screens (Next.js)** | `3001` | No — internal only | Screen player app (TV display, served under `/display`) |
| **API (Hono)** | `4000` | No — internal only | REST + WebSocket gateway + MQTT |
| **PostgreSQL** | `5432` | **Yes — `5432:5432`** | Published for drizzle-kit / seeds on the host (not the public web path) |
| **Mosquitto MQTT** | `1883` | No — internal only | MQTT protocol |
| **Mosquitto WS** | `9001` | No — internal only | WebSocket-based MQTT |

---

## 2. Docker Network Topology

Two Docker networks are defined in `infra/docker/docker-compose.yml`:

```
┌─────────────────────────────────────────────┐
│              internal network                │
│  (driver: bridge, internal: true)            │
│                                              │
│  postgres   mosquitto   api   cms   screens  │
│                                   │          │
│                               nginx          │
└───────────────────────────────┼─────────────┘
                                │ also on
┌───────────────────────────────┼─────────────┐
│              public network   │              │
│  (driver: bridge)             │              │
│                           nginx              │
│                           port 80            │
└─────────────────────────────────────────────┘
```

- `internal: true` — containers on this network cannot reach the external internet directly
- Only `nginx` sits on both networks — it receives traffic from the host and routes to internal services
- PostgreSQL and MQTT are completely unreachable from outside Docker

---

## 3. Nginx Routing (Docker mode — `infra/nginx/default.conf`)

Routes by **path**, not hostname. Order matters — more specific blocks come first:

| Location | Upstream | Notes |
|---|---|---|
| `^~ /api/auth/` | `cms:3000` | Auth/session — lives in the CMS Next app, **not** the API |
| `^~ /api/upload`, `^~ /api/media` | `cms:3000` | Uploads + media streaming — CMS-owned routes |
| `/api/` | `api:4000` | Hono REST API (everything else under `/api`) |
| `/health` | `api:4000` | Health alias |
| `= /ws`  and  `/ws/` | `api:4000` | WebSocket upgrade (headers + 3600s timeout). The **exact `= /ws`** block exists because app clients connect to `/ws` (no slash); without it Nginx 301-redirects and the WS handshake fails |
| `~* ^/display/_next/static/` | `screens:3001` | TV display hashed assets (cache-forever) |
| `~* ^/_next/static/` | `cms:3000` | CMS hashed assets |
| `/display` | `screens:3001` | Screen player (TV display). **Prefix is NOT stripped** — the screens app sets `basePath:/display`, so it serves under `/display` directly. Plain prefix so the `/display/_next/static/` regex still wins |
| `/` | `cms:3000` | CMS catch-all (must be last). Serves `/screens` (list) + `/screens/<id>` (control) |

Config: `client_max_body_size 500M`, full proxy headers on all locations. Nginx config is a
read-only volume mount → apply changes with `docker exec cms-nginx nginx -s reload` (no rebuild).
After recreating app containers, **restart Nginx** so it re-resolves their new IPs (otherwise 502).

**Local dev mode** (Windows-native Nginx, no Docker for apps): uses `host.docker.internal`
instead of service names. Config at `infra/nginx/nginx.conf`.

---

## 4. Internal Service Communication

In Docker, services reach each other by **service name**, not `localhost`:

| From → To | Address |
|---|---|
| API → PostgreSQL | `postgres:5432` |
| API → Mosquitto | `mqtt://mosquitto:1883` |
| CMS → API | `api:4000` (server-side) / `/api/` (browser, through Nginx) |
| Screens → API | `api:4000` (server-side) / `/api/` (browser, through Nginx) |
| Nginx → All apps | `cms:3000`, `screens:3001`, `api:4000` |

Browser-side requests from CMS/Screens always go through Nginx (`http://localhost/api/...`) — they never hit the API container directly.

---

## 5. CORS Configuration

`apps/api/src/index.ts` reads `CORS_ORIGIN` (comma-separated), defaulting to
`http://localhost:3000`, `http://localhost:3001`, `http://localhost`. For the office LAN, add
the host origin (e.g. `http://ec-cms`) to `CORS_ORIGIN` in the root `.env`.

---

## 6. WebSocket Routing

Browser/app and publisher WebSocket connections go through Nginx to the API gateway. Both
`/ws` and `/ws/` upgrade (see the route table) with:
```nginx
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```
`NEXT_PUBLIC_WS_GATEWAY_URL` (baked at build) defaults to `/ws`; clients resolve it against
`window.location` (`wss://` under HTTPS). The live-stream publisher connects to
`ws://<host>/ws/`. **Gotcha:** clients using the no-slash `/ws` only work because of the exact
`= /ws` Nginx block above — a bare `/ws` against only `location /ws/` 301-redirects and the
handshake dies (this silently broke all real-time sync until the exact block was added).

---

## 7. Production LAN Deployment

The stack runs on one host (e.g. `ec-cms`, LAN IP `192.168.1.250`); only Nginx is published (`80:80`). All
devices use one shared instance via relative `/api` and `/ws` URLs. Per-service server-side
calls use `INTERNAL_API_URL=http://api:4000` (set for **both** cms and screens). The screens
app is built with `NEXT_PUBLIC_SCREENS_BASE_PATH=/display` so its routes/assets live under
`/display` and match the Nginx routing.
