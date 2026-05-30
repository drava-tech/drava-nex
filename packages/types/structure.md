# packages/types — Shared TypeScript Types

> **Package name:** `@platform/types`
> **Purpose:** Single source of truth for ALL data shapes in the platform.
> **Depends on:** Nothing
> **Used by:** Every other package and every app

---

## What Lives Here

```
packages/types/            ← YOU ARE HERE
├── src/
│   └── index.ts           → all shared TypeScript interfaces and types
├── package.json           → no runtime deps — types only
└── tsconfig.json          → compiles to dist/
```

---

## Why This Package Is the Most Important

Every piece of data that moves through the platform — a screen record from the DB, a playlist fetched by the player, a telemetry event from a sensor — must be described by a type defined here.

```
Without @platform/types:

  apps/api defines:   interface Screen { id: string; name: string; }
  apps/cms defines:   interface Screen { id: string; title: string; }  ← DRIFT!
  apps/screens uses:  screen.name  ← crashes because cms called it 'title'

With @platform/types:

  packages/types defines:  interface Screen { id, name, status, ... }
  ALL packages import from here → impossible to drift
```

---

## File: `src/index.ts` — Every Exported Type

### `Screen`
```typescript
interface Screen {
  id: string;
  name: string;
  location?: string;
  status: 'online' | 'offline' | 'maintenance';  // union — no typos possible
  lastSeenAt: Date;
  currentPlaylistId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}
```
**Who uses it:** API (serves it), CMS (displays it), Screens (identifies itself)
**Flows:** PostgreSQL → `@platform/db` → `apps/api` → HTTP → `apps/cms` / `apps/screens`

---

### `Content`
```typescript
interface Content {
  id: string;
  title: string;
  type: 'image' | 'video' | 'html' | 'stream' | 'weather';
  url: string;
  duration: number;   // seconds this item stays on screen
  createdAt: Date;
  updatedAt: Date;
}
```
**Who uses it:** API (serves it), CMS (admin creates content), Screens (renders it)
**Flows:** Admin upload → API → DB → Screens fetches → player loop renders for `duration` seconds

---

### `Playlist` + `PlaylistItem`
```typescript
interface Playlist { id, name, items: PlaylistItem[] }
interface PlaylistItem { id, contentId, sequence, duration }
```
**Who uses it:** API, CMS (builds playlists), Screens (plays the ordered sequence)
**Flows:** CMS assembles → stored in DB → Screens fetches → plays item[0], item[1], ...

---

### `Schedule`
```typescript
interface Schedule {
  id, playlistId, screenId?,
  startTime, endTime,
  cronExpression?,    // '0 8 * * MON-FRI' = every weekday 8am
  priority            // higher number = overrides lower priority schedules
}
```
**Who uses it:** API scheduler, CMS (admin sets schedules)
**Flows:** Admin creates → DB stores → API scheduler checks on interval → tells screen what to play

---

### `Rule` + `RuleCondition` + `RuleAction`
```typescript
interface Rule {
  id, name,
  triggerEvent: string,        // 'sensor:motion_detected'
  conditions: RuleCondition[], // [{ field: 'metrics.motionDetected', operator: 'eq', value: true }]
  actions: RuleAction[],       // [{ type: 'play_content', payload: { playlistId: 'promo' } }]
  isActive: boolean
}
```
**Who uses it:** API rule engine, CMS (admin writes rules)
**Flows:** Admin creates rule → DB → API evaluates on each IoT event → triggers action

---

### `DeviceTelemetry` (IoT)
```typescript
interface DeviceTelemetry {
  deviceId: string;
  timestamp: number;
  metrics: {
    cpuUsage?, memoryUsage?, temperature?,
    networkSignal?, screenOnline?, sensorData?
  }
}
```
**Who uses it:** `@platform/iot` (produces it), `apps/api` (evaluates it in rule engine)
**Flows:** Sensor → Mosquitto → `normalizeTelemetry(rawBuffer)` → `DeviceTelemetry` object → rule engine

---

### `IoTEvent`
```typescript
interface IoTEvent {
  eventId, deviceId, topic, payload: unknown, timestamp
}
```
**Flows:** Sensor → Mosquitto → `normalizeEvent(rawBuffer)` → `IoTEvent` object → rule engine → WebSocket push

---

### `DeviceCommand`
```typescript
interface DeviceCommand {
  commandId, deviceId, action, payload?, sentAt
}
```
**Flows:** API rule engine creates → `publishCommand(deviceId, command)` → Mosquitto → Physical Device

---

## File: `package.json`

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

No runtime dependencies — types compile away. The `exports` field tells TypeScript and Node.js exactly which file to load when another package does `import { Screen } from '@platform/types'`.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← imported by | `@platform/db` | DB uses Screen/Content/etc shapes |
| ← imported by | `@platform/iot` | IoT uses DeviceTelemetry/IoTEvent/DeviceCommand |
| ← imported by | `apps/api` | API type-checks all HTTP payloads |
| ← imported by | `apps/cms` | CMS type-checks all API responses |
| ← imported by | `apps/screens` | Screens type-checks playlist/screen data |
