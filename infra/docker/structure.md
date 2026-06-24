# infra/docker — Docker Compose Stack

> **Contains:** `docker-compose.yml` — the full production stack (all services).
> **Run with:** `pnpm infra:up` (= `docker compose --env-file .env -f infra/docker/docker-compose.yml up -d`)

---

## What Lives Here

```
infra/docker/
├── docker-compose.yml        → the full stack (6 services)
└── docker-compose.local.yml  → backing services only (for local-dev app runs)
```

---

## Services (6)

| Container | Image / build | Internal port | Host port |
|---|---|---|---|
| `cms-postgres` | `postgres:16-alpine` | 5432 | **5432:5432** (drizzle-kit/seeds) |
| `cms-mosquitto` | `eclipse-mosquitto:2` | 1883, 9001 | — internal |
| `cms-api` | `apps/api/Dockerfile` | 4000 | — internal |
| `cms-admin` | `apps/cms/Dockerfile` | 3000 | — internal |
| `cms-screens` | `apps/screens/Dockerfile` | 3001 | — internal |
| `cms-nginx` | `nginx:alpine` | 80 | **80:80** (sole public web port) |

Two networks: **`internal`** (`internal: true`, no outbound internet) holds everything;
**`public`** carries only `nginx` (and the published postgres port).

Startup order: `postgres` (healthcheck) + `mosquitto` → `api` → `cms` + `screens` → `nginx`.

---

## Data persistence (bind mounts, outside the repo)

Persistent data lives at `E:\EC\cms-platform-data\` (NOT named volumes):

```
postgres-data/   mosquitto-data/   uploads/   logs/{,/mosquitto,/nginx}
```

`docker compose down` keeps this data; the screens `public/config` dir is also bind-mounted
into api/cms/screens.

---

## What the database stores

`user/session/account/verification` (auth) · `experience` (`templateKey` + `templateContent`)
· `media_asset` · `screen`. See [`.doc/database.md`](../../.doc/database.md).

---

## Commands

```powershell
pnpm infra:build     # build api/cms/screens images
pnpm infra:up        # start the stack
docker restart cms-nginx   # after recreating app containers (re-resolve IPs)
pnpm infra:logs      # tail logs
pnpm infra:down      # stop + remove containers (bind-mounted data preserved)
pnpm healthcheck     # http://localhost/health
```

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← config | `infra/mosquitto/mosquitto.conf`, `infra/nginx/default.conf` | volume mounts |
| → runs | api / cms / screens / postgres / mosquitto / nginx | the containers |
| → routes | all web traffic | through `cms-nginx :80` |
