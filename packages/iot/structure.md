# packages/iot — MQTT Helpers & Device Abstractions

> **Package name:** `@platform/iot`
> **Purpose:** MQTT client helpers, device abstractions, event normalizers
> **Depends on:** `@platform/types` · `mqtt@^5.5`
> **Used by:** `apps/api` · `apps/screens` (future)

---

## What Lives Here

```
packages/iot/              ← YOU ARE HERE
├── src/
│   └── index.ts           → MQTTDeviceManager class (all IoT logic here)
├── package.json           → deps: mqtt, @platform/types
└── tsconfig.json          → compiles to dist/
```

---

## What This Package Does

`@platform/iot` is the **translator** between raw MQTT binary messages and typed TypeScript objects.

```
Physical Sensor
  │  publishes raw JSON buffer to Mosquitto broker
  ▼
Mosquitto Broker :1883
  │  routes to subscribers
  ▼
@platform/iot — MQTTDeviceManager
  │  normalizeTelemetry(buffer)  →  DeviceTelemetry  (structured metrics)
  │  normalizeEvent(buffer)      →  IoTEvent          (structured event)
  ▼
apps/api — Rule Engine
  │  evaluates conditions on the typed object
  ▼
WebSocket push → apps/screens switches content
```

The key idea: `apps/api` never touches raw MQTT buffers directly — it always gets a clean typed object back from this package.

---

## File: `src/index.ts`

### `class MQTTDeviceManager`

**Constructor**
```typescript
constructor(brokerUrl: string)
// Stores: this.brokerUrl = 'mqtt://localhost:1883'
// Does NOT open a connection yet
```

---

**`connect(): void`**
```
CURRENT STATE (stub):
  console.info(`Connecting to MQTT Broker at ${this.brokerUrl}`)
  ← only prints, no real TCP socket, no subscription

FUTURE STATE (real):
  import mqtt from 'mqtt'
  this.client = mqtt.connect(this.brokerUrl)
  this.client.on('connect', () => {
    this.client.subscribe('platform/screens/+/telemetry')
    this.client.subscribe('platform/screens/+/events')
    console.info('MQTT connected and subscribed')
  })
  this.client.on('message', (topic, payload) => {
    // fires in real-time, ~10-50ms after sensor publishes
    const event = this.normalizeEvent(payload)
    this.emit('iot:event', event)  // triggers rule engine in api
  })
  this.client.on('error', (err) => console.error('MQTT error:', err))
```

---

**`publishCommand(deviceId, command: DeviceCommand): void`**
```
CURRENT STATE (stub):
  console.info(`Publishing command ${command.action} to device ${deviceId}`)

FUTURE STATE:
  this.client.publish(
    `platform/commands/${deviceId}`,
    JSON.stringify(command)
  )
```

**When it's called:** After the rule engine decides an action. For example, "reboot screen-001" sends a DeviceCommand over MQTT to that specific device's command topic.

---

**`normalizeTelemetry(rawPayload: Buffer): DeviceTelemetry`**
```typescript
// WORKS NOW — no change needed in future
const parsed = JSON.parse(rawPayload.toString())
return {
  deviceId:  parsed.deviceId  || 'unknown',
  timestamp: parsed.timestamp || Date.now(),
  metrics:   parsed.metrics   || {}
}
```

**Input:** Raw `Buffer` from MQTT message (JSON-encoded)
**Output:** Typed `DeviceTelemetry` object
**Used by:** `apps/api` after receiving an MQTT message on the telemetry topic

---

**`normalizeEvent(rawPayload: Buffer): IoTEvent`**
```typescript
// WORKS NOW — no change needed in future
const parsed = JSON.parse(rawPayload.toString())
return {
  eventId:   parsed.eventId   || 'unknown',
  deviceId:  parsed.deviceId  || 'unknown',
  topic:     parsed.topic     || 'default/topic',
  payload:   parsed.payload,
  timestamp: parsed.timestamp || Date.now()
}
```

**Input:** Raw `Buffer` from MQTT message (JSON-encoded)
**Output:** Typed `IoTEvent` object
**Used by:** `apps/api` rule engine to evaluate trigger conditions

---

## File: `package.json`

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "dependencies": {
    "mqtt": "^5.5.0",          ← installed but not yet called in connect()
    "@platform/types": "workspace:*"
  }
}
```

---

## File: `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

---

## MQTT Topic Convention (Future)

| Topic Pattern | Direction | Payload Type |
|---|---|---|
| `platform/screens/{id}/telemetry` | Device → API | `DeviceTelemetry` |
| `platform/screens/{id}/events` | Device → API | `IoTEvent` |
| `platform/commands/{id}` | API → Device | `DeviceCommand` |
| `platform/broadcast` | API → All Devices | `DeviceCommand` |

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → imports | `@platform/types` | DeviceTelemetry, IoTEvent, DeviceCommand shapes |
| ← imported by | `apps/api` | MQTTDeviceManager for MQTT connection |
| ← imported by | `apps/screens` | Future: direct MQTT subscription |
| ↔ communicates | Mosquitto `:1883` | Real-time MQTT messages (future) |
