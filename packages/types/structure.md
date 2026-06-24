# packages/types — Shared TypeScript Types

> **Package name:** `@platform/types`
> **Purpose:** the single source of truth for the data shapes shared across apps.
> **Depends on:** nothing
> **Used by:** every package and app

---

## What Lives Here

```
packages/types/src/
└── index.ts   → all shared interfaces & types (compiles to dist/, types only)
```

---

## What's In It (today)

The most important shapes are the **WebSocket protocol contracts** the gateway, screens, and
CMS all speak. Defining them once makes drift impossible.

### Content the gateway delivers
```typescript
type WsContentType = 'video' | 'image' | 'html' | 'stream' | 'experience';
interface WsContent {
  id; type: WsContentType; source: string;
  loop?; muted?; title?;
  templateKey?;                 // e.g. 'portfolio' | 'live-stream'
  templateContent?: Record<string, unknown>;  // per-template authored content
}
type StreamFormat = 'h264' | 'mjpeg';   // live-stream wire format
```

### Messages (gateway ↔ clients)
```typescript
WsServerMessage  // WELCOME | CONTENT_UPDATE | PING | SCREEN_COMMAND | STREAM_STATUS
WsClientMessage  // REGISTER | CMS_REGISTER | CONTENT_CHANGE_REQUEST | SCREEN_INTERACTION
                 // | STREAM_PUBLISH | STREAM_SUBSCRIBE | STREAM_UNSUBSCRIBE | PONG
WsCmsMessage     // SCREEN_UPDATED | ACTIVE_SCREENS_LIST
BroadcastRequest // { screenId, content, source? }  → POST /api/internal/broadcast
```

### Legacy signage / IoT interfaces
Also present (some now historical): `Screen`, `Content`, `Playlist`, `Schedule`, `Rule`,
`DeviceTelemetry`, `IoTEvent`, `DeviceCommand`. The IoT shapes are used by `@platform/iot`;
the playlist/schedule/rule interfaces are not part of the current experience/template flow.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← imported by | `@platform/db`, `@platform/ui` (dev), `apps/api`, `apps/cms`, `apps/screens` | shared contracts |
| ← imported by | `@platform/iot` | `DeviceTelemetry` / `IoTEvent` / `DeviceCommand` |

No runtime deps — types compile away; the `exports` map points to `dist/index.js` + `.d.ts`.
