# infra/nginx — nexus's own router

> **Contains:** the nginx config that routes nexus's paths (api vs cms, TVs on http, uploads, websockets).
> **Mounted into:** the `cms-nginx` container (alias `nexus-web`) via read-only volumes.
> **Sits behind:** the shared edge Caddy in `E:\edge` (another repo), which owns the host ports.

---

## Two layers, two jobs

```
LAN (TVs, PCs, APK) ─┐
internet ─► Cloudflare ─► tunnel ─► (login gate) ┤
                                                 ▼
                      E:\edge  edge-caddy  — picks the PROJECT (host/port), client TLS, real client IP
                                                 │ :80 plain (TVs) / :443 TLS (edge-CA cert "nexus-web")
                                                 ▼
                      cms-nginx (this folder) — picks the PATH
                         ├─ /api/* · /media/<file> · /ws · /ws/ · /health → api:4000
                         ├─ /vision/*                                    → vision-inference:8000
                         └─ everything else (dashboard, /display, /media pages) → cms:3000
```

Path rules change with the app, so they live here; Caddy only knows hostnames.

## What lives here

```
infra/nginx/
├── default.conf             → http-level settings + the :80 and :443 servers (only their differences)
├── snippets/nexus-routes.conf → the routes both servers share (mounted at /etc/nginx/snippets)
└── nginx.conf               → old local-dev config (not used by docker-compose.local.yml)
```

- **:80** — plain http for TVs/kiosks: `/display`, `/media`, `/data-art-studio/`, `/ws` stay on http;
  `/api/auth/*` and the dashboard 301 to https (better-auth's Secure cookies need it).
- **:443** — everything, plus the sign-up block (`/api/auth/sign-up/*` → 403).
- **Unknown Host** → `444` on both ports. Known names: `ec-cms`, `192.168.1.250`, and on :443
  `nexus.drava.technology` (public) and `nexus-web` (the name Caddy dials).
- **Proxy headers are set once at http level.** Never add `proxy_set_header` inside a location:
  nginx then drops all the inherited ones for that location.
- **Real client IP** comes from Caddy only (`set_real_ip_from 172.30.0.10`), as a single-value
  `X-Forwarded-For`; it's passed upstream as `X-Real-IP` and `X-Forwarded-For`.
- **New CMS page under `/media/`?** It 404s from the API until it gets its own block in
  `snippets/nexus-routes.conf` (see the comment there).

## Operating it

- Config change: `docker exec cms-nginx nginx -t && docker exec cms-nginx nginx -s reload`.
- Recreated api/cms containers are picked up automatically (variable `proxy_pass` + Docker DNS);
  no nginx restart needed.
- Health check from the host must send a known Host: `curl -H "Host: ec-cms" http://localhost/health`
  goes through Caddy; inside the container, `wget --header="Host: ec-cms" http://127.0.0.1/health`.
- Certificate: `E:\edge\nexus\nexus-web.crt/.key` (edge CA, renew with
  `E:\edge\scripts\issue-cert.ps1 -Out nexus\nexus-web -Names nexus-web`, then `up -d nginx`
  and `docker restart edge-caddy`).

## Connects to

| Direction | Target | How |
|---|---|---|
| ← loaded by | `infra/docker/docker-compose.yml` | volume mounts into `cms-nginx` |
| ← reached from | `E:\edge` Caddy | `edge` network, alias `nexus-web` |
| → proxies | `api:4000`, `cms:3000`, `vision-inference:8000` | HTTP + WebSocket |
