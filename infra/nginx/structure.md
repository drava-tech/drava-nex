# infra/nginx — Nginx Reverse Proxy

> **Contains:** the Nginx config that makes `:80` the single public entry point.
> **Mounted into:** the `cms-nginx` container via a read-only volume.

---

## What Lives Here

```
infra/nginx/
├── default.conf   → Docker mode — upstreams are service names (api/cms/screens)
└── nginx.conf     → local-dev mode — upstreams are host.docker.internal
```

One `server` block. Routes by **path**, not hostname (so it works for any host/IP).

---

## What Nginx Does

```
LAN browser / TV / stream publisher
        │  :80
        ▼
      cms-nginx ──┬─ /api/auth|upload|media   → cms:3000   (CMS-owned API routes)
                  ├─ /api/ · /health · /ws · /ws/ → api:4000 (REST + WebSocket)
                  ├─ /display (+ /display/_next/static) → screens:3001 (basePath /display, TV)
                  └─ /                          → cms:3000   (catch-all, last; incl. /screens + /screens/<id>)
```

Key points:
- **Both `= /ws` and `/ws/` upgrade** to the API gateway. The exact `= /ws` block is required
  because the app clients connect to `/ws` (no slash) — without it Nginx 301-redirects and the
  WebSocket handshake fails (this silently broke all real-time sync once).
- The screens app uses `basePath:/display`, so `/display/...` is **proxied without stripping**.
  `/screens` and `/screens/<id>` are CMS routes (admin list + per-screen control).
- `client_max_body_size 500M`; all locations forward `Host` / `X-Forwarded-*` headers.

---

## Operating it

The config is a read-only volume mount:
- Apply changes: `docker exec cms-nginx nginx -t && docker exec cms-nginx nginx -s reload`.
- After recreating app containers (`infra:up`), **restart Nginx** (`docker restart cms-nginx`)
  so it re-resolves their new IPs — otherwise routes return `502`.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← loaded by | `infra/docker/docker-compose.yml` | volume mount into `cms-nginx` |
| → proxies | `cms:3000`, `screens:3001`, `api:4000` | HTTP + WebSocket reverse proxy |

See [`.doc/networking.md`](../../.doc/networking.md) for the full route table.
