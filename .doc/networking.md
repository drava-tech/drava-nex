# Networking, Ports & Routing Architecture

This document maps the network ports, Docker network topology, and proxy configurations across all platform services.

---

## 1. Port Registry

| Service | Port | Exposed to host | Context |
|---|---|---|---|
| **Nginx** | `80`, `443` | Yes — sole public **web** entry | All HTTP/WS traffic (CMS, displays, API, gateway) |
| **CMS (Next.js)** | `3000` | No — internal only | Admin dashboard **and** the `/display` player |
| **API (Hono)** | `4000` | No — internal only | REST + WebSocket gateway + MQTT + `/media` file serving |
| **PostgreSQL** | `5432` | **Yes — `5432:5432`** | Published for drizzle-kit / seeds on the host (not the public web path) |
| **Mosquitto MQTT** | `1883` | **Yes — `1883:1883`** | Published so LAN smart devices can subscribe to retained door-state topics |
| **Mosquitto WS** | `9001` | No — internal only | WebSocket-based MQTT |
| **Vision inference** | `8000` | No — internal only | Optional (`vision-server` profile); proxied at `/vision/` |
| **Home Assistant** | `8123` | Yes (optional profile) | `home-assistant` profile only — Yale lock event source |

> There is **no separate screens app**. The TV player is a route inside the CMS Next.js app
> (`apps/cms/src/app/display/[screenId]`), so `/display` proxies to `cms:3000` like the rest of
> the dashboard. Earlier revisions of this platform had a `screens` service on `3001`; it is gone.

---

## 2. Docker Network Topology

Two Docker networks are defined in `infra/docker/docker-compose.yml`:

```
┌─────────────────────────────────────────────┐
│              internal network                │
│  (driver: bridge, internal: true)            │
│                                              │
│   postgres   mosquitto   api   cms           │
│                                 │            │
│                             nginx            │
└─────────────────────────────┼───────────────┘
                              │ also on
┌─────────────────────────────┼───────────────┐
│              public network │                │
│  (driver: bridge)           │                │
│                         nginx                │
│                      ports 80, 443           │
└─────────────────────────────────────────────┘
```

- `internal: true` — containers on this network cannot reach the external internet directly
- Only `nginx` bridges both networks for web traffic — it receives traffic from the host and
  routes to internal services
- `postgres` and `mosquitto` are also attached to `public`, but **only** so their host port
  bindings (`5432`, `1883`) resolve — `internal: true` blocks published ports otherwise
- `api` is on `public` too, because it needs outbound internet for the Tuya cloud IR API

---

## 3. Nginx Routing (Docker mode — `infra/nginx/default.conf`)

Three server blocks: a `default_server` that rejects unknown hosts, a `:80` block, and a `:443`
block. Both named blocks answer to `server_name ec-cms 192.168.1.250;`.

### 3.1 Host filtering

```nginx
server { listen 80 default_server; server_name _; return 444; }
```

Any request whose `Host` isn't `ec-cms` or `192.168.1.250` gets **444** — connection closed, no
response. Browsers render this as a generic "site can't be reached", indistinguishable from the
host being down. **If the host's LAN IP changes, add it to `server_name` in both named blocks.**

### 3.2 The http/https split

The `:80` block serves public routes directly and 301-redirects session-bearing ones to https:

| Location | `:80` behaviour | Upstream (both blocks) |
|---|---|---|
| `^~ /api/auth/` | **301 → https** | `api:4000` |
| `^~ /display` | served | `cms:3000` |
| `^~ /api/media` | served (`proxy_buffering off` for large video) | `api:4000` |
| `= /media`, `= /media/` | served | `cms:3000` (the Media Library **page**) |
| `^~ /media/` | served | `api:4000` (`mediaFilesRouter` — uploaded files) |
| `/api/` | served | `api:4000` |
| `/health` | served | `api:4000` |
| `= /ws` and `/ws/` | served (upgrade) | `api:4000` |
| `= /vision/ws`, `/vision/` | served | `vision-inference:8000` |
| `~* ^/_next/static/` | served (cache-forever) | `cms:3000` |
| `/` (catch-all) | **301 → https** | `cms:3000` |

Why: better-auth issues `Secure` / `__Secure-` cookies (its `baseURL` is https) which browsers
silently drop over plain http, causing a login loop. Displays stay on http because `/display` is
public (see the pass-through list in `apps/cms/src/middleware.ts`) and TVs shouldn't have to
trust a private CA. See [`device-setup.md`](./device-setup.md).

The `:443` block carries the same route set with no redirects, plus
`ssl_certificate /etc/nginx/certs/fullchain.pem`. **`infra/nginx/certs/` is gitignored** — it
must be generated per host with mkcert, or nginx won't start.

### 3.3 Gotchas

- The exact `= /ws` block exists because clients connect to `/ws` with no trailing slash; with
  only `location /ws/`, nginx 301-redirects and the WebSocket handshake dies silently.
- Don't add a manual redirect between `= /media` and `= /media/` — nginx's built-in
  directory-redirect behaviour turns it into an infinite loop (the config comments explain).
- `client_max_body_size 500M`, full proxy headers on all locations.
- The config is a read-only volume mount → apply changes with
  `docker exec cms-nginx nginx -s reload` (no rebuild). After **recreating** app containers,
  restart nginx so it re-resolves their new IPs (otherwise 502).

**Local dev mode** (Windows-native Nginx, no Docker for apps): uses `host.docker.internal`
instead of service names. Config at `infra/nginx/nginx.conf`.

---

## 4. Internal Service Communication

In Docker, services reach each other by **service name**, not `localhost`:

| From → To | Address |
|---|---|
| API → PostgreSQL | `postgres:5432` |
| API → Mosquitto | `mqtt://mosquitto:1883` |
| CMS → API | `api:4000` (server-side, via `INTERNAL_API_URL`) / `/api/` (browser, through Nginx) |
| Display page → API | `INTERNAL_API_URL` server-side (`resolveDisplayConfig()`), `/ws` in the browser |
| Nginx → apps | `cms:3000`, `api:4000` |

Browser-side requests always go through Nginx — they never hit the API container directly.

---

## 5. CORS Configuration

`apps/api/src/index.ts` reads `CORS_ORIGIN` (comma-separated), defaulting to just
`http://localhost:3000` when unset. For the office LAN, list **every origin a device will
actually use** — both the hostname and the IP, at the right scheme:

```
CORS_ORIGIN=https://ec-cms,https://192.168.1.250
```

The same applies to `BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`; a mismatch there produces
a login that loops back to `/login`. See [`environment.md`](./environment.md) §Auth.

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

The stack runs on one host (e.g. `ec-cms`, LAN IP `192.168.1.250`); Nginx publishes `80:80` and
`443:443` and is the only web entry point. All devices share one instance via relative `/api`
and `/ws` URLs, so a single build works for any hostname or IP. Server-side calls from the CMS
use `INTERNAL_API_URL=http://api:4000`.

Device-facing URLs:

| Device | URL |
|---|---|
| TV / display | `http://<host>/display/<screenId>` — **http**, public, no login |
| Admin / control tablet | `https://<host>/` — https forced, needs the mkcert CA trusted |

For the full per-device procedure (certificates, Chromium kiosk flags, the Frame Unlock
extension, troubleshooting), see [`device-setup.md`](./device-setup.md).
