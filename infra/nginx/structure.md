# infra/nginx — Nginx Reverse Proxy

> **Contains:** Nginx virtual host configuration routing public traffic to the right app.
> **Mounted into:** the `nginx` Docker container via volume.

---

## What Lives Here

```
infra/nginx/               ← YOU ARE HERE
└── nginx.conf             → 3 virtual host server blocks
```

---

## What Nginx Does in This Platform

Nginx sits in front of all 3 apps and acts as the single public entry point:

```
Internet / LAN
  │
  ▼
Nginx :80
  │
  ├── cms.platform.local     ──proxy──►  apps/cms :3000     (Next.js)
  ├── screens.platform.local ──proxy──►  apps/screens :3001 (Next.js)
  └── api.platform.local     ──proxy──►  apps/api :4000     (Hono + WebSocket)
```

Without Nginx, browsers would have to remember ports (`:3000`, `:3001`, `:4000`). With Nginx, they just use clean domain names on port 80.

---

## File: `nginx.conf`

### Server Block 1 — CMS Admin

```nginx
server {
    listen 80;
    server_name cms.platform.local;

    location / {
        proxy_pass http://cms:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Flow:**
```
Admin browser → http://cms.platform.local
  → Nginx matches server_name
  → proxy_pass http://cms:3000  (Docker service name or localhost)
  → Next.js apps/cms renders and responds
  → Nginx forwards response back to browser
```

**Why the `proxy_set_header` lines?** Next.js needs to know the original request IP and protocol (http/https) for security checks, logging, and rate limiting. Without these headers, Next.js thinks every request comes from Nginx's internal IP.

---

### Server Block 2 — Screen Player

```nginx
server {
    listen 80;
    server_name screens.platform.local;

    location / {
        proxy_pass http://screens:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Flow:**
```
Physical screen browser → http://screens.platform.local
  → Nginx matches server_name
  → proxy_pass http://screens:3001
  → Next.js apps/screens renders the player UI
```

---

### Server Block 3 — API Gateway (with WebSocket support)

```nginx
server {
    listen 80;
    server_name api.platform.local;

    location / {
        proxy_pass http://api:4000;
        proxy_http_version 1.1;                        ← REQUIRED for WebSocket
        proxy_set_header Upgrade $http_upgrade;        ← REQUIRED for WebSocket
        proxy_set_header Connection "upgrade";         ← REQUIRED for WebSocket
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Why the extra 3 lines for WebSocket?**

WebSocket connections start as HTTP 1.1 requests with an `Upgrade: websocket` header. By default, Nginx uses HTTP/1.0 and drops this header, closing the WebSocket immediately.

```
Browser sends:
  GET /ws HTTP/1.1
  Upgrade: websocket
  Connection: upgrade

Without proxy_http_version 1.1 + Upgrade headers:
  Nginx strips them → sends HTTP/1.0 to API → WebSocket dies

With the headers:
  Nginx forwards the upgrade → API upgrades connection → WebSocket lives
```

**Flow:**
```
apps/cms  → http://api.platform.local/api/screens  → REST response
apps/screens → ws://api.platform.local/ws         → WebSocket connection
  ← receives push events (playlist changes, commands)
```

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← loaded by | `infra/docker/docker-compose.yml` | volume mount into nginx container |
| → proxies to | `apps/cms :3000` | HTTP reverse proxy |
| → proxies to | `apps/screens :3001` | HTTP reverse proxy |
| → proxies to | `apps/api :4000` | HTTP + WebSocket reverse proxy |
