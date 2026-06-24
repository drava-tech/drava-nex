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
WebSocket protocol (the live contracts)
  WsContentType / WsContent      ──► what the gateway delivers to a screen
  StreamFormat                   ──► 'h264' | 'mjpeg' (live-stream wire format)
  WsServerMessage                ──► WELCOME | CONTENT_UPDATE | PING | SCREEN_COMMAND | STREAM_STATUS
  WsClientMessage                ──► REGISTER | CMS_REGISTER | CONTENT_CHANGE_REQUEST |
                                     SCREEN_INTERACTION | STREAM_PUBLISH/SUBSCRIBE/UNSUBSCRIBE | PONG
  WsCmsMessage                   ──► SCREEN_UPDATED | ACTIVE_SCREENS_LIST
  BroadcastRequest               ──► body of POST /api/internal/broadcast

Legacy signage / IoT interfaces (some historical)
  Screen, Content, Playlist, Schedule, Rule
  DeviceTelemetry, IoTEvent, DeviceCommand   (used by @platform/iot)
```

---

## Data Journey of the Live Contracts

```
WsContent
  Built by:    @platform/db getScreenContent() (join screen → experience/media)
  Pushed by:   apps/api gateway as WELCOME / CONTENT_UPDATE
  Rendered by: apps/screens ContentRenderer (by type / templateKey)

WsClientMessage / WsServerMessage
  Spoken by:   screens (REGISTER, CONTENT_CHANGE_REQUEST, STREAM_SUBSCRIBE),
               CMS tabs (CMS_REGISTER), publishers (STREAM_PUBLISH + binary frames)
  Routed by:   apps/api/src/ws/gateway.ts (per-screen rooms + stream relay)

BroadcastRequest
  Sent by:     apps/cms broadcastWsContentDirect → POST /api/internal/broadcast
  Auth:        x-broadcast-secret == BROADCAST_SECRET
  Effect:      gateway broadcast() → CONTENT_UPDATE to the screen's room
```

> The IoT types still back `@platform/iot`; the `Playlist`/`Schedule`/`Rule` interfaces remain
> for compatibility but are not part of the current experience/template flow.
