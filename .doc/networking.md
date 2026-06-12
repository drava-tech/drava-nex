# Networking, Ports & Routing Architecture

This document maps the network ports, Docker network topology, and proxy configurations across all platform services.

---

## 1. Port Registry

| Service | Port | Exposed to host | Context |
|---|---|---|---|
| **Nginx** | `80` | Yes — only public port | Sole entry point for all web traffic |
| **CMS (Next.js)** | `3000` | No — internal only | Admin dashboard |
| **Screens (Next.js)** | `3001` | No — internal only | Screen player app |
| **API (Hono)** | `4000` | No — internal only | REST + WebSocket + MQTT gateway |
| **PostgreSQL** | `5432` | No — internal only | Never reachable from host or internet |
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

Single `server_name localhost` block. Routes by **path**, not hostname:

| Path | Upstream | Notes |
|---|---|---|
| `/api/` | `api:4000` | REST API |
| `/health` | `api:4000` | Health check alias |
| `/ws/` | `api:4000` | WebSocket (upgrade headers + 3600s timeout) |
| `/screens/` | `screens:3001/` | Trailing slash strips prefix |
| `/` | `cms:3000` | CMS catch-all (must be last) |

Config: `client_max_body_size 500M`, full proxy headers on all locations.

**Local dev mode** (Windows-native Nginx, no Docker for apps): Uses `host.docker.internal` instead of service names. Config at `infra/nginx/nginx.conf`.

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

`apps/api/src/index.ts` allows origins:
- `http://localhost:3000` (CMS — local dev)
- `http://localhost:3001` (Screens — local dev)
- `http://localhost` (Nginx port 80 — Docker mode)

---

## 6. WebSocket Routing

WebSocket connections from browsers go through Nginx at `/ws/` with upgrade headers:
```nginx
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```
`NEXT_PUBLIC_WS_URL=ws://localhost/ws` is baked into CMS/Screens at build time.
