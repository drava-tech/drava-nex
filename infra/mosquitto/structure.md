# infra/mosquitto — MQTT Broker Configuration

> **Contains:** Eclipse Mosquitto MQTT broker config.
> **Mounted into:** the `mosquitto` Docker container via volume.
> **What it enables:** Real-time sub-50ms message routing between IoT devices and the platform API.

---

## What Lives Here

```
infra/mosquitto/           ← YOU ARE HERE
└── mosquitto.conf         → full broker configuration
```

---

## What Mosquitto Does

Mosquitto is the **message hub** — all IoT messages flow through it:

```
IoT Sensor / Device
  │  publish JSON payload
  │  to topic: platform/screens/screen-001/telemetry
  ▼
[Mosquitto Broker]
  │  routes to all matching subscribers
  ▼
apps/api → @platform/iot
  │  subscribed to: platform/screens/+/telemetry  (+ matches any screen ID)
  │  receives the message in ~5ms
  ▼
normalizeTelemetry() → DeviceTelemetry → Rule Engine → action taken
```

---

## File: `mosquitto.conf`

### TCP Listener (Port 1883)

```conf
listener 1883
allow_anonymous true
```

**Port 1883** — Standard MQTT port. Used by:
- `apps/api` via `@platform/iot` (Node.js TCP connection)
- IoT sensors and physical devices
- `mqtt` CLI tools for testing

**`allow_anonymous true`** — No username/password required.
> ⚠️ For production: set this to `false` and use a `password_file` with credentials.

---

### WebSocket Listener (Port 9001)

```conf
listener 9001
protocol websockets
allow_anonymous true
```

**Port 9001** — MQTT over WebSocket. Used by:
- Browser-based MQTT clients (future: `apps/screens` direct MQTT)
- Browser debugging tools (MQTT Explorer connecting via WS)

**Why browsers need a separate port?** Browsers cannot open raw TCP sockets. They can only do WebSocket connections. Mosquitto translates between WebSocket and MQTT protocol on port 9001.

```
Browser (apps/screens future):
  import mqtt from 'mqtt'
  const client = mqtt.connect('ws://localhost:9001')  ← WS protocol
  client.subscribe('platform/commands/screen-001')    ← receive commands
```

---

### Persistence

```conf
persistence true
persistence_location /mosquitto/data/
```

**`persistence true`** — Messages with QoS 1 or 2 are saved to disk. If Mosquitto restarts, retained messages and queued messages for offline clients are restored.

Without persistence: if the broker restarts, any messages sent to offline devices are lost. With persistence: offline devices receive queued messages when they reconnect.

The `persistence_location` is inside the Docker container at `/mosquitto/data/` — map this to a volume in production to survive container rebuilds.

---

### Logging

```conf
log_dest file /mosquitto/log/mosquitto.log
log_type all
log_timestamp true
```

**`log_type all`** — Logs every connection, subscription, publish, and disconnect.

**`log_timestamp true`** — Each log line has a timestamp.

**To view logs:**
```bash
docker exec -it platform-mosquitto tail -f /mosquitto/log/mosquitto.log
```

---

## MQTT Concepts Explained

| Term | Meaning |
|---|---|
| **Topic** | A path string like `platform/screens/screen-001/telemetry` — messages are published to and subscribed from topics |
| **Publish** | Sending a message to a topic (device → broker → subscribers) |
| **Subscribe** | Registering interest in a topic — you receive all messages published to it |
| **Wildcard `+`** | Single-level wildcard: `platform/+/telemetry` matches `platform/screen-001/telemetry` AND `platform/screen-002/telemetry` |
| **Wildcard `#`** | Multi-level wildcard: `platform/#` matches everything under `platform/` |
| **QoS 0** | Fire and forget — fastest, no delivery guarantee |
| **QoS 1** | At least once — broker confirms delivery |
| **QoS 2** | Exactly once — slowest but guaranteed no duplicates |

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← configured by | `infra/docker/docker-compose.yml` | volume mount |
| ← publishes to | IoT sensors + devices | TCP :1883 |
| → delivers to | `apps/api` → `@platform/iot` | TCP :1883 subscribe |
| → delivers to | Browser clients (future) | WebSocket :9001 |
| ← receives commands | `apps/api` → `@platform/iot` | `publishCommand()` → TCP :1883 |
