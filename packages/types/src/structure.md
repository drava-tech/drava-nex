# packages/types/src — Types Source

> **Contains:** The single TypeScript file that defines all shared interfaces.

---

## What Lives Here

```
packages/types/src/        ← YOU ARE HERE
└── index.ts               → all exported TypeScript interfaces
```

---

## File: `index.ts`

**This file is the contract layer for the entire platform.**

Every type exported here is:
- Used by at least 2 different packages or apps
- Enforced at TypeScript compile time everywhere it's used
- Compiled to `../dist/index.js` + `../dist/index.d.ts` on `pnpm build`

---

## Section Map

```
Lines 1-13    CMS/Signage types ──► Screen interface
Lines 15-23                    ──► Content interface
Lines 25-36                    ──► Playlist + PlaylistItem interfaces
Lines 38-46                    ──► Schedule interface
Lines 48-66                    ──► Rule + RuleCondition + RuleAction interfaces

Lines 69-88   IoT types        ──► DeviceTelemetry interface
Lines 82-88                    ──► IoTEvent interface
Lines 90-96                    ──► DeviceCommand interface
```

---

## Data Journey of Each Type

```
Screen
  Created at: PostgreSQL (screens table)
  Fetched by: apps/api → GET /api/screens
  Consumed by: apps/cms (admin view) + apps/screens (player self-identifies)

Content
  Created at: PostgreSQL (content table) via CMS upload
  Fetched by: apps/api → GET /api/content
  Consumed by: apps/cms (content library) + apps/screens (renders it)

Playlist / PlaylistItem
  Assembled by: apps/cms admin
  Stored in:    PostgreSQL (playlists + playlist_items tables)
  Fetched by:   apps/screens on startup (what to play)

Schedule
  Created by:   apps/cms admin (with cron or time range)
  Evaluated by: apps/api scheduler (checks current time → picks playlist)
  Affects:      apps/screens (told which playlist to show)

Rule / RuleCondition / RuleAction
  Written by:   apps/cms admin
  Triggered by: IoT events arriving from MQTT
  Evaluated in: apps/api rule engine
  Result:       DeviceCommand sent to screen via WebSocket

DeviceTelemetry
  Produced by:  Physical sensor (raw JSON over MQTT)
  Normalized:   @platform/iot.normalizeTelemetry(buffer)
  Evaluated:    apps/api rule engine checks metrics
  Example:      metrics.motionDetected === true → trigger rule

IoTEvent
  Produced by:  @platform/iot.normalizeEvent(buffer)
  Consumed by:  apps/api rule engine
  Contains:     eventId, deviceId, topic, payload, timestamp

DeviceCommand
  Produced by:  apps/api rule engine after evaluation
  Published by: @platform/iot.publishCommand(deviceId, command)
  Delivered to: Physical device via Mosquitto broker
```
