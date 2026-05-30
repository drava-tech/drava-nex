# infra/docker — Docker Compose Stack

> **Contains:** `docker-compose.yml` that spins up all platform backing services.
> **Run with:** `docker compose -f infra/docker/docker-compose.yml up -d`

---

## What Lives Here

```
infra/docker/              ← YOU ARE HERE
└── docker-compose.yml     → defines postgres + mosquitto + nginx containers
```

---

## File: `docker-compose.yml`

### Service 1: `postgres`

```yaml
image: postgres:16-alpine
container_name: platform-postgres
ports:
  - "5432:5432"
environment:
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: postgres
  POSTGRES_DB: cms_platform
volumes:
  - postgres_data:/var/lib/postgresql/data  ← data persists across restarts
restart: unless-stopped
```

**Purpose:** Relational database — stores all platform data.

**Who connects to it:**
```
apps/api → @platform/db → pg Pool → postgres:5432
  DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/cms_platform"
```

**What it stores (when schema is wired):**

| Table | Contains |
|---|---|
| `screens` | All registered display screens |
| `content` | Uploaded media items (images, videos, widgets) |
| `playlists` | Ordered sequences of content |
| `playlist_items` | Individual items with sequence + duration |
| `schedules` | When to play which playlist on which screen |
| `rules` | IoT trigger → action mappings |

---

### Service 2: `mosquitto`

```yaml
image: eclipse-mosquitto:2.0
container_name: platform-mosquitto
ports:
  - "1883:1883"   ← MQTT/TCP for server and device clients
  - "9001:9001"   ← MQTT/WebSocket for browser clients
volumes:
  - ../mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf
restart: unless-stopped
```

**Purpose:** MQTT message broker — routes all IoT messages between devices and the API.

**Data flow through this container:**

```
IoT Sensor
  │  publish to topic: platform/screens/screen-001/telemetry
  │  payload: { "deviceId": "s-001", "metrics": { "motionDetected": true } }
  ▼
[mosquitto container routes it]
  ▼
apps/api → @platform/iot (subscribed to platform/screens/+/telemetry)
  │  normalizeTelemetry(buffer) → DeviceTelemetry object
  ▼
Rule Engine evaluates → action taken
  ▼
publishCommand() → mosquitto routes back to device
```

---

### Service 3: `nginx`

```yaml
image: nginx:alpine
container_name: platform-nginx
ports:
  - "80:80"
volumes:
  - ../nginx/nginx.conf:/etc/nginx/nginx.conf:ro
depends_on:
  - postgres
  - mosquitto
restart: unless-stopped
```

**Purpose:** Public-facing reverse proxy — single entry point for all web traffic.

**Routing:**

| Domain | Goes to |
|---|---|
| `cms.platform.local` | `apps/cms :3000` |
| `screens.platform.local` | `apps/screens :3001` |
| `api.platform.local` | `apps/api :4000` (+ WebSocket upgrade) |

---

## Named Volumes

```yaml
volumes:
  postgres_data:   ← persists DB data between docker restarts
```

Without this, every `docker compose down` would wipe your database.

---

## Commands

```bash
# Start all services
docker compose -f infra/docker/docker-compose.yml up -d

# View running containers
docker compose -f infra/docker/docker-compose.yml ps

# View logs
docker compose -f infra/docker/docker-compose.yml logs -f mosquitto

# Stop all (keeps data)
docker compose -f infra/docker/docker-compose.yml stop

# Stop + destroy containers (keeps volume data)
docker compose -f infra/docker/docker-compose.yml down

# Stop + destroy EVERYTHING including the database
docker compose -f infra/docker/docker-compose.yml down -v
```

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← config from | `infra/mosquitto/mosquitto.conf` | volume-mounted into mosquitto container |
| ← config from | `infra/nginx/nginx.conf` | volume-mounted into nginx container |
| → serves | `apps/api` | PostgreSQL connection via `DATABASE_URL` |
| → serves | `apps/api` + `@platform/iot` | MQTT broker via `MQTT_BROKER_URL` |
| → routes to | `apps/cms`, `apps/screens`, `apps/api` | Nginx reverse proxy |
