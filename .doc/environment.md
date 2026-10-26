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
| `CMS_PORT` | `3000` | Next.js CMS listen port — serves the admin dashboard **and** `/display` |

### Next.js Public URLs (baked in at build time)
| Variable | Docker value | Local dev value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` (relative) | `http://localhost:4000/api` |
| `NEXT_PUBLIC_WS_URL` | `/ws` (relative) | `ws://localhost:4000/ws` |
| `NEXT_PUBLIC_WS_GATEWAY_URL` | `/ws` (relative) | `ws://localhost:4000/ws` |
| `NEXT_PUBLIC_SCREENS_URL` | `/display` (relative) | `/display` — override only to point at a different origin (`apps/cms/src/lib/screen-url.ts`) |

Docker bakes **relative** paths so one build works for any host/IP; clients resolve them against
`window.location`. These are `NEXT_PUBLIC_*` — embedded into the JS bundle at `docker compose
build` time, so changing them needs a rebuild.

### Real-time, Internal & Auth
| Variable | Example | Notes |
|---|---|---|
| `BROADCAST_SECRET` | `<32-byte hex>` | Shared secret the CMS sends (`x-broadcast-secret`) when POSTing to the API `/api/internal/broadcast`; must match on both sides |
| `INTERNAL_API_URL` | `http://api:4000` | Server-side base URL the CMS uses to reach the API by service name (`http://localhost:4000` in local dev) |
| `CORS_ORIGIN` | `https://ec-cms,https://192.168.1.250` | Comma-separated allowed origins for the API. Defaults to **only** `http://localhost:3000` when unset |
| `BETTER_AUTH_URL` | `https://ec-cms` | Base URL for better-auth — becomes both `baseURL` and the first entry of `trustedOrigins` (`apps/cms/src/lib/auth.ts`) |
| `BETTER_AUTH_SECRET` | `<hex>` | Session signing secret (each dev generates their own) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `https://192.168.1.250,https://ec-cms` | Additional trusted origins, comma-separated — list every origin a device will use |

> **The auth origins must be `https://` on a LAN deployment.** Nginx 301-redirects `/` and
> `/api/auth/*` to https, and better-auth issues `Secure` / `__Secure-` cookies that browsers
> silently drop over plain http. An `http://` value here produces a login that appears to
> succeed and then bounces straight back to `/login`. `.env.example` ships `http://localhost`,
> which is correct for **local dev only** — it must be changed for the deployed host.
> See [`device-setup.md`](./device-setup.md) §4.3.

### MQTT Broker
| Variable | Docker value | Local dev value |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://mosquitto:1883` | `mqtt://localhost:1883` |
| `MQTT_HOST` | `mosquitto` | `localhost` |
| `MQTT_PORT` | `1883` | `1883` |
| `MQTT_WS_PORT` | `9001` | `9001` |

### File Storage
| Variable | Value | Notes |
|---|---|---|
| `UPLOAD_DIR` | `/data/uploads` | Container path — bind-mounted from `E:\EC\cms-platform-data\uploads` |
| `LOG_DIR` | `/data/logs` | Container path — bind-mounted from `E:\EC\cms-platform-data\logs` |

### Greet on arrival

Read by the **api** container only. In production set them in `.env.production` (the api service's `env_file`) — never in the compose `environment:` block, which overrides `env_file`. The template to copy is the "Greet on arrival" section of `.env.example`; behaviour, defaults and troubleshooting are in [greeting.md](./greeting.md), the rollout order in [greeting-rollout.md](./greeting-rollout.md).

| Variable | Default | Notes |
|---|---|---|
| `GREETING_ENABLED` | `false` | Master switch. Only `1`/`true`/`yes`/`on` enable it; a typo means off. Off = the system behaves exactly as before. |
| `GREETING_TZ` | `Asia/Kolkata` | IANA zone defining "today" and the part of day. Invalid → default + warning. |
| `GREET_UNKNOWN` | `screen` | Unnamed visitors: `screen` (welcome screen, silent) · `generic` ("Good afternoon. Welcome.") · `off`. |
| `GREETING_VOICE` | `screen` | `screen` (the TV speaks) · `off` (log only) · `travis` (stub). |
| `GREETING_VOICE_NAME` | unset | Prefer this `speechSynthesis` voice on the TV (exact or partial name). |
| `GREET_NAME_MODE` | `full` | `full` · `first` · `none`. Names are always cleaned and capped at 40 characters. |
| `GREET_BATCH_WINDOW_MS` | `3000` | 0–60000. People seen within the window are greeted in one line (0 = no grouping). |
| `GREET_MAX_NAMES` | `4` | 1–20. More names → "everyone". |
| `GREET_PRESENCE_WINDOW_SECONDS` | `120` | 1–86400. "In the room" for rename/merge greetings. |
| `GREET_ARRIVAL_FRESH_SECONDS` | `30` | 1–600. Maximum age of a sighting (the DB `last_seen` is allowed this + 30 s). |
| `GREET_AFTERNOON_HOUR` / `GREET_EVENING_HOUR` | `12` / `17` | Part-of-day boundaries; evening must be after afternoon. |
| `WELCOME_SCREEN_DURATION_SECONDS` | `20` | 1–3600. Then the screen returns to what it was showing. |
| `WELCOME_VIDEO_MUTED` | unset | Unset: muted while greetings are on, untouched while off. `true`/`false` force it. |
| `GREET_BUSY_SKIPS_DAY` | `all` | Busy-screen reasons that block the visitor for the rest of the day: `all` or `whiteboard`. |
| `GREETING_RETENTION_DAYS` | `30` | 1–3650. `visitor_greeting` rows older than this are purged daily. |

Invalid values never stop the API: each logs a `[greeting] …` warning and falls back to its default.

**Local dev:** these must reach the API through turbo, whose strict env mode drops undeclared shell variables. `apps/api/turbo.json` lists them for the `dev` task (production builds are unaffected). Add any new variable there as well.

### Obsolete — no longer read by any code

The TV player used to be a separate `screens` Next.js app on port `3001`. It is now a route
inside the CMS app (`apps/cms/src/app/display/[screenId]`), so these are dead — earlier versions
of this document listed them as live:

| Variable | Was | Still in `.env.example`? |
|---|---|---|
| `SCREEN_ID` | Per-instance screen identifier for the *removed* screens app | **Yes** — but do NOT delete: it was reused, see note below |
| `SCREENS_PORT` | Listen port of the removed screens app | No |
| `NEXT_PUBLIC_SCREENS_BASE_PATH` | `basePath` of the removed screens app | No |
| `CONFIG_DIR` | Mount path into the removed screens app's `public/config` | No |

> **`SCREEN_ID` is live again — do not delete it.** It was repurposed by the
> screen-agent (`apps/api/screen-agent/.env`), which hard-exits without it. Since
> that agent now runs hidden, deleting the variable would silently disable the
> CMS touchpad with no visible error — the reason would only appear in
> `apps/api/screen-agent/agent.log`. See `device-setup.md` § Screen PC helpers.

`NEXT_PUBLIC_SCREENS_URL` is **not** obsolete — it is still read by
`apps/cms/src/lib/screen-url.ts` and ships in `.env.example`.

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

- **Docker Compose services** — the `api` and `cms` services load `env_file: ../../.env.production`,
  and compose itself is invoked with `--env-file ../../.env` for `${VAR}` interpolation inside
  `docker-compose.yml`. Two different files: `.env` feeds the compose file, `.env.production`
  feeds the containers. Both are gitignored.
- **Next.js build-time vars** — `ARG NEXT_PUBLIC_API_URL` → `ENV NEXT_PUBLIC_API_URL=...` in
  Dockerfiles, also passed as `build.args` in `docker-compose.yml`. Because they're baked into
  the JS bundle, changing one needs a **rebuild**, not just a restart.
- **Local dev** — the `packages/db` client auto-crawls up to the repo root `.env` as a fallback if `DATABASE_URL` is not set in the process environment

---

## 4. Security Rules

- Never commit `.env` — it is in `.gitignore`
- Never put real passwords in `.env.example` — use `CHANGE_ME` placeholders
- PostgreSQL port `5432` **is** published to the host (`5432:5432`) for drizzle-kit/seeds — keep
  it behind the firewall; it is not reachable through the public web path (Nginx)
- MQTT ports `1883` and `9001` are never bound to the host — Docker internal only
- `BROADCAST_SECRET` and the `BETTER_AUTH_*` secrets must be real random values in production
  (not the `dev-secret` / `CHANGE_ME` defaults)
